import { Controller, Post, Body, Headers, HttpCode } from '@nestjs/common';
import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhook: WebhookService) {}

  // Called directly by SePay — no JWT
  @Post('sepay')
  @HttpCode(200)
  sepay(@Body() body: any, @Headers('authorization') auth?: string) {
    return this.webhook.handleSepay(body, auth);
  }
}
