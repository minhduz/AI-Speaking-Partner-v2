import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { IsString, IsNumber } from 'class-validator';
import { UsageService } from './usage.service';

class IncrementDto {
  @IsString() user_id: string;
  @IsNumber() tokens_used: number;
}

@Controller()
export class UsageController {
  constructor(private usage: UsageService) {}

  // Public — called by orchestrator billing proxy
  @Get('usage/:user_id')
  getUsage(@Param('user_id') userId: string) {
    return this.usage.getUsage(userId);
  }

  // Internal — called by orchestrator turn guard
  @Get('internal/quota/:user_id')
  checkQuota(@Param('user_id') userId: string) {
    return this.usage.checkQuota(userId);
  }

  // Internal — called by orchestrator after each turn
  @Post('internal/usage/increment')
  increment(@Body() dto: IncrementDto) {
    return this.usage.increment(dto.user_id, dto.tokens_used);
  }
}
