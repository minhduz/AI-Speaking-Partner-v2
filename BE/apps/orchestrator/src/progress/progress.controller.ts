import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProgressService } from './progress.service';

@Controller('progress')
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private progress: ProgressService) {}

  @Get()
  overall(@Req() req) { return this.progress.getOverall(req.user.id); }

  @Get('sessions')
  sessions(@Req() req, @Query('page') page = '1', @Query('limit') limit = '20') {
    return this.progress.getSessionBreakdown(req.user.id, +page, +limit);
  }

  @Get('dashboard')
  dashboard(@Req() req) { return this.progress.getDashboard(req.user.id); }
}
