import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
  constructor(private webhook: WebhookService) {}

  // Called directly by SePay — no JWT
  @Post('sepay')
  @HttpCode(200)
  sepay(@Body() body: any) {
    return this.webhook.handleSepay(body);
  }
}
