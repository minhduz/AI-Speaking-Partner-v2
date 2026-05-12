import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { PaymentModule } from '../payment/payment.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { AddonModule } from '../addon/addon.module';
import { BillingEvent } from '../billing-event/billing-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([BillingEvent]),
    PaymentModule,
    SubscriptionModule,
    AddonModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
