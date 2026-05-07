import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HistoryService } from './history.service';

@Controller('history')
@UseGuards(JwtAuthGuard)
export class HistoryController {
  constructor(private history: HistoryService) {}

  @Get()
  getSessions(@Req() req, @Query('page') page = '1', @Query('limit') limit = '20') {
    return this.history.getSessions(req.user.id, +page, +limit);
  }

  @Get(':session_id')
  getSession(@Param('session_id') sessionId: string, @Req() req) {
    return this.history.getSession(sessionId, req.user.id);
  }
}
