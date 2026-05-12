import { Controller, Get, Post, Body, Param, Req, Res, UseGuards, HttpCode } from '@nestjs/common';
import { Response } from 'express';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('billing')
export class BillingProxyController {
  constructor(private readonly http: HttpService, private readonly cfg: ConfigService) {}

  private get url() { return this.cfg.get('BILLING_SERVICE_URL'); }

  // ── Public ──────────────────────────────────────────────────────────────────

  @Get('plans')
  plans() {
    return firstValueFrom(this.http.get(`${this.url}/plans`)).then(r => r.data);
  }

  @Get('addon-packages')
  addonPackages() {
    return firstValueFrom(this.http.get(`${this.url}/addon-packages`)).then(r => r.data);
  }

  // SePay calls this directly — no JWT
  @Post('sepay/webhook')
  @HttpCode(200)
  webhook(@Body() body: any) {
    return firstValueFrom(this.http.post(`${this.url}/webhook/sepay`, body)).then(r => r.data);
  }

  // ── Protected ───────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  checkout(@Body() body: { plan_id: string }, @Req() req) {
    return firstValueFrom(
      this.http.post(`${this.url}/payment/create`, { ...body, user_id: req.user.id }),
    ).then(r => r.data);
  }

  @UseGuards(JwtAuthGuard)
  @Post('addon/checkout')
  addonCheckout(@Body() body: { addon_package_id: string }, @Req() req) {
    return firstValueFrom(
      this.http.post(`${this.url}/addon/checkout`, { ...body, user_id: req.user.id }),
    ).then(r => r.data);
  }

  @UseGuards(JwtAuthGuard)
  @Get('addon/balance')
  addonBalance(@Req() req) {
    return firstValueFrom(
      this.http.get(`${this.url}/internal/addon/balance/${req.user.id}`),
    ).then(r => r.data);
  }

  @UseGuards(JwtAuthGuard)
  @Get('payment/:order_id')
  paymentStatus(@Param('order_id') orderId: string) {
    return firstValueFrom(this.http.get(`${this.url}/payment/${orderId}`)).then(r => r.data);
  }

  // SSE — pipe billing-service stream through orchestrator so the frontend can use auth headers
  @UseGuards(JwtAuthGuard)
  @Get('payment/:order_id/stream')
  streamPayment(@Param('order_id') orderId: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    this.http.axiosRef
      .get(`${this.url}/payment/${orderId}/stream`, { responseType: 'stream' })
      .then(upstream => upstream.data.pipe(res))
      .catch(() => {
        res.write('data: {"type":"error","message":"stream failed"}\n\n');
        res.end();
      });
  }

  @UseGuards(JwtAuthGuard)
  @Get('subscription')
  subscription(@Req() req) {
    return firstValueFrom(this.http.get(`${this.url}/subscription/${req.user.id}`)).then(r => r.data);
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscription/cancel')
  @HttpCode(200)
  cancel(@Req() req) {
    return firstValueFrom(this.http.post(`${this.url}/subscription/${req.user.id}/cancel`)).then(r => r.data);
  }

  @UseGuards(JwtAuthGuard)
  @Get('usage')
  usage(@Req() req) {
    return firstValueFrom(this.http.get(`${this.url}/usage/${req.user.id}`)).then(r => r.data);
  }

  @UseGuards(JwtAuthGuard)
  @Get('history')
  history(@Req() req) {
    return firstValueFrom(
      this.http.get(`${this.url}/payment/history?user_id=${req.user.id}`),
    ).then(r => r.data);
  }
}
