import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AddonPackage } from './addon-package.entity';
import { UserAddon } from './user-addon.entity';
import { PaymentOrder } from '../payment/entities/payment-order.entity';

@Injectable()
export class AddonService {
  constructor(
    @InjectRepository(AddonPackage) private readonly packageRepo: Repository<AddonPackage>,
    @InjectRepository(UserAddon) private readonly addonRepo: Repository<UserAddon>,
    @InjectRepository(PaymentOrder) private readonly orderRepo: Repository<PaymentOrder>,
    private readonly cfg: ConfigService,
  ) {}

  listPackages() {
    return this.packageRepo.find({ where: { isActive: true }, order: { priceVnd: 'ASC' } });
  }

  async createCheckout(userId: string, addonPackageId: string) {
    const pkg = await this.packageRepo.findOne({ where: { id: addonPackageId, isActive: true } });
    if (!pkg) throw new NotFoundException('Addon package not found');

    const contentCode  = this._generateCode(userId);
    const expiryMins   = +this.cfg.get('PAYMENT_EXPIRY_MINUTES') || 15;
    const expiresAt    = new Date(Date.now() + expiryMins * 60 * 1000);

    const order = this.orderRepo.create({
      userId,
      planId:          null,
      addonPackageId:  pkg.id,
      amountVnd:       pkg.priceVnd,
      contentCode,
      expiresAt,
      status:          'pending',
      orderType:       'addon',
    });
    await this.orderRepo.save(order);

    return {
      order_id:       order.id,
      bank_name:      this.cfg.get('SEPAY_BANK_NAME'),
      account_number: this.cfg.get('SEPAY_ACCOUNT_NUMBER'),
      account_name:   this.cfg.get('SEPAY_ACCOUNT_NAME'),
      amount_vnd:     pkg.priceVnd,
      content_code:   contentCode,
      qr_url:         this._buildQrUrl(pkg.priceVnd, contentCode),
      expires_at:     expiresAt,
      package:        { id: pkg.id, name: pkg.name, token_amount: pkg.tokenAmount },
    };
  }

  async activate(userId: string, addonPackageId: string, paymentOrderId: string) {
    const pkg = await this.packageRepo.findOne({ where: { id: addonPackageId } });
    if (!pkg) throw new NotFoundException('Addon package not found');

    const addon = this.addonRepo.create({
      userId,
      addonPackageId,
      tokensPurchased: pkg.tokenAmount,
      tokensRemaining: pkg.tokenAmount,
      paymentOrderId,
    });
    await this.addonRepo.save(addon);
    console.log(`[Addon] Activated ${pkg.name} (${pkg.tokenAmount} tokens) for user ${userId}`);
    return addon;
  }

  async getBalance(userId: string): Promise<number> {
    const result = await this.addonRepo
      .createQueryBuilder('ua')
      .select('COALESCE(SUM(ua.tokensRemaining), 0)', 'total')
      .where('ua.userId = :userId', { userId })
      .andWhere('ua.tokensRemaining > 0')
      .andWhere('(ua.expiresAt IS NULL OR ua.expiresAt > NOW())')
      .getRawOne<{ total: string }>();
    return parseInt(result?.total ?? '0', 10);
  }

  async deductTokens(userId: string, tokens: number): Promise<void> {
    const addons = await this.addonRepo.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });

    let remaining = tokens;
    for (const addon of addons) {
      if (remaining <= 0) break;
      if (Number(addon.tokensRemaining) <= 0) continue;
      if (addon.expiresAt && addon.expiresAt < new Date()) continue;

      const deduct = Math.min(Number(addon.tokensRemaining), remaining);
      await this.addonRepo.update(addon.id, { tokensRemaining: Number(addon.tokensRemaining) - deduct });
      remaining -= deduct;
    }
  }

  async getAddonSummary(userId: string) {
    const addons = await this.addonRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    const balance = addons
      .filter(a => Number(a.tokensRemaining) > 0 && (!a.expiresAt || a.expiresAt > new Date()))
      .reduce((sum, a) => sum + Number(a.tokensRemaining), 0);
    return { balance, addons };
  }

  private _generateCode(userId: string): string {
    const userPart = userId.replace(/-/g, '').slice(0, 6).toUpperCase();
    const random   = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `TOPUP${userPart}${random}`;
  }

  private _buildQrUrl(amount: number, content: string): string {
    const account = this.cfg.get('SEPAY_ACCOUNT_NUMBER');
    const bank    = this.cfg.get('SEPAY_BANK_NAME');
    return `https://qr.sepay.vn/img?acc=${account}&bank=${bank}&amount=${amount}&des=${content}`;
  }
}
