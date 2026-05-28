import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../user/user-role.enum';
import { LessonService } from './lesson.service';

// Per-skill human scores; each is an optional int 0..100 so a malformed value
// (e.g. pronunciation: 999) is rejected before it can dirty mastery/path.
class ScoreBreakdownDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) task_completion?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) grammar?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) vocabulary?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) pronunciation?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) fluency?: number;
}

class SubmitReviewDto {
  @IsOptional() @ValidateNested() @Type(() => ScoreBreakdownDto) score_breakdown?: ScoreBreakdownDto;
  @IsOptional() @IsInt() @Min(0) @Max(100) final_score?: number;
  @IsOptional() @IsIn(['approved', 'revised', 'rejected']) decision?: 'approved' | 'revised' | 'rejected';
  @IsOptional() @IsString() note?: string;
}

class EscalateDto {
  @IsString() reason: string;
}

// Reviewer workflow — teachers/admins only.
@Controller('review-tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TEACHER, UserRole.ADMIN)
export class ReviewTaskController {
  constructor(private lessons: LessonService) {}

  // A teacher always sees their own data; an admin may inspect any teacher via
  // ?teacher_id=. Never lets a teacher read another teacher's data.
  private resolveTeacherId(req, teacherId?: string): string {
    if (teacherId && req.user.role === UserRole.ADMIN) return teacherId;
    return req.user.id;
  }

  // GET /review-tasks/next — the next task this rater should work on.
  @Get('next')
  next(@Req() req) {
    return this.lessons.getNextReviewTask(req.user.id);
  }

  // GET /review-tasks/dashboard — profile + queue summary + stats + recent
  // history + recent feedback. Admin may pass ?teacher_id to inspect a teacher.
  @Get('dashboard')
  dashboard(@Req() req, @Query('teacher_id') teacherId?: string) {
    return this.lessons.getTeacherDashboard(this.resolveTeacherId(req, teacherId));
  }

  // GET /review-tasks/history?period=day|month|year|all&page=&limit=
  @Get('history')
  history(
    @Req() req,
    @Query('period') period?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('teacher_id') teacherId?: string,
  ) {
    return this.lessons.getTeacherReviewHistory(this.resolveTeacherId(req, teacherId), {
      period,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // GET /review-tasks/feedback?period=&page=&limit= — student ratings received.
  @Get('feedback')
  feedback(
    @Req() req,
    @Query('period') period?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('teacher_id') teacherId?: string,
  ) {
    return this.lessons.getTeacherFeedback(this.resolveTeacherId(req, teacherId), {
      period,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // GET /review-tasks/stats — daily/monthly/yearly counts + rating distribution.
  @Get('stats')
  stats(@Req() req, @Query('teacher_id') teacherId?: string) {
    return this.lessons.getTeacherStats(this.resolveTeacherId(req, teacherId));
  }

  // POST /review-tasks/:id/assign — claim a task.
  @Post(':id/assign')
  @HttpCode(200)
  assign(@Req() req, @Param('id') id: string) {
    return this.lessons.assignReviewTask(id, req.user.id);
  }

  // POST /review-tasks/:id/submit — submit the human score (finalizes attempt).
  @Post(':id/submit')
  @HttpCode(200)
  submit(@Req() req, @Param('id') id: string, @Body() dto: SubmitReviewDto) {
    return this.lessons.submitHumanReview(id, req.user.id, {
      scoreBreakdown: dto.score_breakdown as Record<string, number> | undefined,
      finalScore: dto.final_score,
      decision: dto.decision,
      note: dto.note,
    });
  }

  // POST /review-tasks/:id/escalate — bump priority / flag for attention.
  @Post(':id/escalate')
  @HttpCode(200)
  escalate(@Param('id') id: string, @Body() dto: EscalateDto) {
    return this.lessons.escalateReviewTask(id, dto.reason);
  }
}
