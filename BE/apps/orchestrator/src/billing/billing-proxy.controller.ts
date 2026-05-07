import { Controller, Get, Post, Body, Param, Req, Res, UseGuards, HttpCode } from '@nestjs/common';
import { Response } from 'express';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('billing')
export class BillingProxyController {
  constructor(private http: HttpService, private cfg: ConfigService) {}

  private get url() { return this.cfg.get('BILLING_SERVICE_URL'); }

  // Public — no auth needed
  @Get('plans')
  plans() {
    return firstValueFrom(this.http.get(`${this.url}/plans`)).then(r => r.data);
  }

  // Webhook — called by SePay directly, no JWT
  @Post('sepay/webhook')
  @HttpCode(200)
  webhook(@Body() body: any) {
    return firstValueFrom(this.http.post(`${this.url}/webhook/sepay`, body)).then(r => r.data);
  }

  // Protected — requires JWT
  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  checkout(@Body() body: { plan_id: string }, @Req() req) {
    return firstValueFrom(
      this.http.post(`${this.url}/payment/create`, { ...body, user_id: req.user.id }),
    ).then(r => r.data);
  }

  @UseGuards(JwtAuthGuard)
  @Get('payment/:order_id')
  paymentStatus(@Param('order_id') orderId: string) {
    return firstValueFrom(this.http.get(`${this.url}/payment/${orderId}`)).then(r => r.data);
  }

  @UseGuards(JwtAuthGuard)
  @Get('subscription')
  subscription(@Req() req) {
    return firstValueFrom(this.http.get(`${this.url}/subscription/${req.user.id}`)).then(r => r.data);
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscription/cancel') @HttpCode(200)
  cancel(@Req() req) {
    return firstValueFrom(this.http.post(`${this.url}/subscription/${req.user.id}/cancel`)).then(r => r.data);
  }

  @UseGuards(JwtAuthGuard)
  @Get('usage')
  usage(@Req() req) {
    return firstValueFrom(this.http.get(`${this.url}/usage/${req.user.id}`)).then(r => r.data);
  }
}
