import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PaymentOrder } from './entities/payment-order.entity';
import { PlansService } from '../plans/plans.service';

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(PaymentOrder) private repo: Repository<PaymentOrder>,
    private plans: PlansService,
    private cfg: ConfigService,
  ) {}

  async createOrder(userId: string, planId: string) {
    const plan = await this.plans.findById(planId);
    if (!plan) throw new NotFoundException('Plan not found');

    const contentCode = this._generateContentCode(userId);
    const expiryMins  = +this.cfg.get('PAYMENT_EXPIRY_MINUTES') || 15;
    const expiresAt   = new Date(Date.now() + expiryMins * 60 * 1000);

    const order = this.repo.create({
      userId,
      planId,
      amountVnd:   plan.priceVnd,
      contentCode,
      expiresAt,
      status:      'pending',
    });
    await this.repo.save(order);

    return {
      order_id:       order.id,
      bank_name:      this.cfg.get('SEPAY_BANK_NAME'),
      account_number: this.cfg.get('SEPAY_ACCOUNT_NUMBER'),
      account_name:   this.cfg.get('SEPAY_ACCOUNT_NAME'),
      amount_vnd:     plan.priceVnd,
      content_code:   contentCode,
      qr_url:         this._buildQrUrl(plan.priceVnd, contentCode),
      expires_at:     expiresAt,
    };
  }

  async getOrderStatus(orderId: string) {
    const order = await this.repo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    // Auto-expire overdue pending orders
    if (order.status === 'pending' && new Date() > order.expiresAt) {
      await this.repo.update(orderId, { status: 'expired' });
      return { status: 'expired' };
    }

    return {
      status:          order.status,
      paid_at:         order.paidAt ?? null,
      plan_activated:  order.status === 'paid',
    };
  }

  async markPaid(contentCode: string, transactionId: string, transferAmount: number): Promise<PaymentOrder | null> {
    const order = await this.repo.findOne({ where: { contentCode, status: 'pending' } });
    if (!order) return null;
    if (new Date() > order.expiresAt) {
      await this.repo.update(order.id, { status: 'expired' });
      return null;
    }
    if (transferAmount < order.amountVnd) {
      console.warn(`[Payment] Insufficient amount: received ${transferAmount}, expected ${order.amountVnd}`);
      return null;
    }
    await this.repo.update(order.id, {
      status: 'paid',
      transactionId,
      paidAt: new Date(),
    });
    return { ...order, status: 'paid', transactionId, paidAt: new Date() };
  }

  private _generateContentCode(userId: string): string {
    const prefix   = 'SPEAK';
    const userPart = userId.replace(/-/g, '').slice(0, 6).toUpperCase();
    const random   = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}${userPart}${random}`;
  }

  private _buildQrUrl(amount: number, content: string): string {
    const account = this.cfg.get('SEPAY_ACCOUNT_NUMBER');
    const bank    = this.cfg.get('SEPAY_BANK_NAME');
    return `https://qr.sepay.vn/img?acc=${account}&bank=${bank}&amount=${amount}&des=${content}`;
  }
}
