import { Controller, Post, Get, Param, Query, Body, Res } from '@nestjs/common';
import { Response } from 'express';
import { IsString } from 'class-validator';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { PaymentService } from './payment.service';

class CreateOrderDto {
  @IsString() user_id: string;
  @IsString() plan_id: string;
}

@Controller('payment')
export class PaymentController {
  constructor(
    private readonly payment: PaymentService,
    private readonly eventEmitter: EventEmitter2,
    private readonly cfg: ConfigService,
  ) {}

  @Post('create')
  create(@Body() dto: CreateOrderDto) {
    return this.payment.createOrder(dto.user_id, dto.plan_id);
  }

  @Get('history')
  history(@Query('user_id') userId: string) {
    return this.payment.getHistory(userId);
  }

  @Get(':order_id')
  status(@Param('order_id') orderId: string) {
    return this.payment.getOrderStatus(orderId);
  }

  // SSE stream — frontend subscribes after showing QR; backend pushes when SePay webhook fires
  @Get(':order_id/stream')
  async streamStatus(@Param('order_id') orderId: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    // Short-circuit if order already in terminal state
    try {
      const current = await this.payment.getOrderStatus(orderId);
      if (current.status === 'paid') { send({ type: 'payment.paid' }); return res.end(); }
      if (current.status === 'expired') { send({ type: 'payment.expired' }); return res.end(); }
    } catch {
      send({ type: 'error', message: 'Order not found' });
      return res.end();
    }

    const handler = (data: { orderId: string }) => {
      if (data.orderId !== orderId) return;
      send({ type: 'payment.paid' });
      this.eventEmitter.off('payment.paid', handler);
      clearTimeout(timeout);
      res.end();
    };
    this.eventEmitter.on('payment.paid', handler);

    const expiryMs = (+this.cfg.get('PAYMENT_EXPIRY_MINUTES') || 15) * 60 * 1000;
    const timeout  = setTimeout(() => {
      this.eventEmitter.off('payment.paid', handler);
      send({ type: 'payment.expired' });
      res.end();
    }, expiryMs);

    res.on('close', () => {
      this.eventEmitter.off('payment.paid', handler);
      clearTimeout(timeout);
    });
  }
}
