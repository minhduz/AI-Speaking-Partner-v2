import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { PaymentService } from '../payment/payment.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { AddonService } from '../addon/addon.service';
import { BillingEvent } from '../billing-event/billing-event.entity';

@Injectable()
export class WebhookService {
  constructor(
    private readonly payment: PaymentService,
    private readonly subscription: SubscriptionService,
    private readonly addon: AddonService,
    private readonly eventEmitter: EventEmitter2,
    private readonly cfg: ConfigService,
    @InjectRepository(BillingEvent) private readonly eventRepo: Repository<BillingEvent>,
  ) {}

  // Validate SePay token (Bearer token in Authorization header)
  private validateToken(authHeader: string | undefined): boolean {
    const secret = this.cfg.get<string>('SEPAY_WEBHOOK_TOKEN');
    if (!secret) return true; // Token not configured → skip (development only)
    if (!authHeader) return false;
    return authHeader.replace(/^Bearer\s+/i, '').trim() === secret;
  }

  async handleSepay(payload: any, authHeader?: string) {
    // 1. Token validation
    if (!this.validateToken(authHeader)) {
      console.warn('[Webhook] Unauthorized request — invalid token');
      return { success: false, reason: 'unauthorized' };
    }

    // 2. Only process incoming transfers
    if (payload.transferType !== 'in') {
      return { success: true };
    }

    const sepayId     = payload.id as number;
    const content     = (payload.content as string)?.trim();
    const amount      = payload.transferAmount as number;
    const refCode     = payload.referenceCode as string;

    if (!content || !sepayId) {
      console.warn('[Webhook] Missing required fields: content or id');
      return { success: false, reason: 'missing_fields' };
    }

    // 3. Idempotency — skip if already processed
    const duplicate = await this.eventRepo.findOne({ where: { sepayTransactionId: sepayId } });
    if (duplicate) {
      console.log(`[Webhook] Duplicate event id=${sepayId}, skipping`);
      return { success: true };
    }

    // 4. Find and mark order as paid
    const order = await this.payment.markPaid(content, String(sepayId), amount);
    if (!order) {
      console.warn('[Webhook] No matching pending order for content:', content);
      await this.eventRepo.save(this.eventRepo.create({
        sepayTransactionId: sepayId,
        eventType:          'payment.unmatched',
        referenceCode:      refCode,
        payload,
      }));
      return { success: false, reason: 'order_not_found' };
    }

    // 5. Activate subscription or add-on
    if (order.orderType === 'addon' && order.addonPackageId) {
      await this.addon.activate(order.userId, order.addonPackageId, order.id);
    } else if (order.planId) {
      await this.subscription.activate(order.userId, order.planId);
      console.log(`[Webhook] Activated plan ${order.planId} for user ${order.userId}`);
    }

    // 6. Persist audit event
    await this.eventRepo.save(this.eventRepo.create({
      sepayTransactionId: sepayId,
      userId:             order.userId,
      eventType:          'payment.paid',
      referenceCode:      refCode,
      payload,
    }));

    // 7. Push to any waiting SSE streams
    this.eventEmitter.emit('payment.paid', { orderId: order.id, userId: order.userId });

    return { success: true, user_id: order.userId };
  }
}
