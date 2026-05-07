import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { IsString } from 'class-validator';
import { PaymentService } from './payment.service';

class CreateOrderDto {
  @IsString() user_id: string;
  @IsString() plan_id: string;
}

@Controller('payment')
export class PaymentController {
  constructor(private payment: PaymentService) {}

  @Post('create')
  create(@Body() dto: CreateOrderDto) {
    return this.payment.createOrder(dto.user_id, dto.plan_id);
  }

  @Get(':order_id')
  status(@Param('order_id') orderId: string) {
    return this.payment.getOrderStatus(orderId);
  }
}
