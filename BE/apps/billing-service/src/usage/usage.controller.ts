import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { IsString, IsNumber } from 'class-validator';
import { UsageService } from './usage.service';

class IncrementDto {
  @IsString() user_id: string;
  @IsNumber() tokens_used: number;
}

class IncrementSessionDto {
  @IsString() user_id: string;
}

@Controller()
export class UsageController {
  constructor(private usage: UsageService) {}

  // Public — usage summary for the user dashboard
  @Get('usage/:user_id')
  getUsage(@Param('user_id') userId: string) {
    return this.usage.getUsage(userId);
  }

  // Internal — returns session/token limits based on plan
  @Get('internal/limits/:user_id')
  getLimits(@Param('user_id') userId: string) {
    return this.usage.getLimits(userId);
  }

  // Internal — called by turn-agent after each turn
  @Post('internal/usage/increment')
  increment(@Body() dto: IncrementDto) {
    return this.usage.increment(dto.user_id, dto.tokens_used);
  }

  // Internal — called by orchestrator on session start
  @Post('internal/usage/increment-session')
  incrementSession(@Body() dto: IncrementSessionDto) {
    return this.usage.incrementSession(dto.user_id);
  }
}
