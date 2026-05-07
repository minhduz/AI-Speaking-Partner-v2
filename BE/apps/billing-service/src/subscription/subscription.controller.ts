import { Controller, Get, Post, Param, HttpCode } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';

@Controller('subscription')
export class SubscriptionController {
  constructor(private svc: SubscriptionService) {}

  @Get(':user_id')
  get(@Param('user_id') userId: string) {
    return this.svc.getForUser(userId);
  }

  @Post(':user_id/cancel') @HttpCode(200)
  cancel(@Param('user_id') userId: string) {
    return this.svc.cancel(userId);
  }

  // Internal — called by orchestrator after user registration
  @Post('internal/subscription/init-free/:user_id') @HttpCode(201)
  initFree(@Param('user_id') userId: string) {
    return this.svc.initFree(userId);
  }
}
