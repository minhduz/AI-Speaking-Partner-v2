// webhook.module.ts
import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { PaymentModule } from '../payment/payment.module';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [PaymentModule, SubscriptionModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
