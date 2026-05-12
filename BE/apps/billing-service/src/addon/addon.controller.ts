import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { IsString } from 'class-validator';
import { AddonService } from './addon.service';

class AddonCheckoutDto {
  @IsString() user_id: string;
  @IsString() addon_package_id: string;
}

@Controller()
export class AddonController {
  constructor(private readonly addon: AddonService) {}

  // Public — list available add-on packages
  @Get('addon-packages')
  listPackages() {
    return this.addon.listPackages();
  }

  // Called by orchestrator billing proxy (JWT validated upstream)
  @Post('addon/checkout')
  checkout(@Body() dto: AddonCheckoutDto) {
    return this.addon.createCheckout(dto.user_id, dto.addon_package_id);
  }

  // Internal — called by orchestrator billing proxy
  @Get('internal/addon/balance/:user_id')
  getBalance(@Param('user_id') userId: string) {
    return this.addon.getAddonSummary(userId);
  }
}
