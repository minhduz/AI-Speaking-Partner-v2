// billing-proxy.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BillingProxyController } from './billing-proxy.controller';

@Module({ imports: [HttpModule], controllers: [BillingProxyController] })
export class BillingProxyModule {}
