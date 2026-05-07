import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { PlansModule }        from './plans/plans.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { PaymentModule }      from './payment/payment.module';
import { UsageModule }        from './usage/usage.module';
import { WebhookModule }      from './webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host: cfg.get('DB_HOST'),
        port: +cfg.get('DB_PORT'),
        username: cfg.get('DB_USER'),
        password: cfg.get('DB_PASS'),
        database: cfg.get('DB_NAME'),
        schema: cfg.get('DB_SCHEMA'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    PlansModule,
    SubscriptionModule,
    PaymentModule,
    UsageModule,
    WebhookModule,
  ],
})
export class AppModule {}
