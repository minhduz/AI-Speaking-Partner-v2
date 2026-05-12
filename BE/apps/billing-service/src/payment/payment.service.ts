import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PaymentOrder } from './entities/payment-order.entity';
import { PlansService } from '../plans/plans.service';
import { AddonPackage } from '../addon/addon-package.entity';

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(PaymentOrder) private repo: Repository<PaymentOrder>,
    @InjectRepository(AddonPackage) private addonPackageRepo: Repository<AddonPackage>,
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

  async getHistory(userId: string) {
    const orders = await this.repo.find({
      where: { userId, status: 'paid' },
      order: { paidAt: 'DESC' },
      take: 20,
    });

    return Promise.all(orders.map(async (order) => {
      let description = '';
      if (order.orderType === 'subscription' && order.planId) {
        const plan = await this.plans.findById(order.planId);
        if (plan) description = plan.interval === 'month' ? 'Pro Monthly' : 'Pro Yearly';
        else description = 'Subscription';
      } else if (order.orderType === 'addon' && order.addonPackageId) {
        const pkg = await this.addonPackageRepo.findOne({ where: { id: order.addonPackageId } });
        description = pkg ? pkg.name : 'Token Pack';
      }
      return {
        id:          order.id,
        order_type:  order.orderType,
        description,
        amount_vnd:  order.amountVnd,
        paid_at:     order.paidAt,
      };
    }));
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
