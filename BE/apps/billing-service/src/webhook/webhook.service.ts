// webhook.service.ts
import { Injectable } from '@nestjs/common';
import { PaymentService } from '../payment/payment.service';
import { SubscriptionService } from '../subscription/subscription.service';

@Injectable()
export class WebhookService {
  constructor(
    private payment: PaymentService,
    private subscription: SubscriptionService,
  ) {}

  async handleSepay(payload: any) {
    /*
      SePay webhook payload shape:
      {
        id: number,
        gateway: string,
        transactionDate: string,
        accountNumber: string,
        content: string,        ← match against content_code
        transferType: 'in',
        transferAmount: number,
        accumulated: number,
        referenceCode: string,
        description: string,
        transferAt: string,
      }
    */
    const content       = payload.content as string;
    const transactionId = String(payload.id);
    const amount        = payload.transferAmount as number;

    if (!content || !transactionId) {
      console.warn('[Webhook] Missing content or transactionId');
      return { success: false };
    }

    // Mark order as paid — validates content code, expiry, and amount
    const order = await this.payment.markPaid(content.trim(), transactionId, amount);
    if (!order) {
      console.warn('[Webhook] No matching pending order for content:', content);
      return { success: false, reason: 'order_not_found' };
    }

    // Activate subscription for the user
    await this.subscription.activate(order.userId, order.planId);
    console.log(`[Webhook] Activated plan ${order.planId} for user ${order.userId}`);

    return { success: true, user_id: order.userId, plan_id: order.planId };
  }
}
