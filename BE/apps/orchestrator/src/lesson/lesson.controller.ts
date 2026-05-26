import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TeacherReviewGuard } from './guards/teacher-review.guard';
import { LessonService } from './lesson.service';

class UpdateReviewDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'revised', 'rejected'])
  status?: 'pending' | 'approved' | 'revised' | 'rejected';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  final_score?: number;

  @IsOptional()
  @IsString()
  comment?: string;
}

@Controller('lessons')
@UseGuards(JwtAuthGuard)
export class LessonController {
  constructor(private lessons: LessonService) {}

  // GET /lessons/path — full curriculum path + per-user progress + continue/recommend.
  @Get('path')
  path(@Req() req) {
    return this.lessons.getPath(req.user.id);
  }

  // GET /lessons/attempts/:attemptId — durable result + teacher-review status.
  // Must be declared BEFORE the `/:id` route or Nest treats "attempts" as a UUID.
  @Get('attempts/:attemptId')
  attempt(@Req() req, @Param('attemptId') attemptId: string) {
    return this.lessons.getAttempt(req.user.id, attemptId);
  }

  // GET /lessons/:id — lesson detail, cards, current progress, in-progress attempt id.
  @Get(':id')
  detail(@Req() req, @Param('id') id: string) {
    return this.lessons.getLessonDetail(req.user.id, id);
  }

  // POST /lessons/:id/start — create/continue a lesson attempt, mint the speaking
  // session, and build the runtime deck. Response carries session_id so the FE
  // navigates into the existing chat screen.
  @Post(':id/start')
  @HttpCode(200)
  start(@Req() req, @Param('id') id: string) {
    return this.lessons.startLesson(req.user.id, id);
  }
}

// Reviewer surface — requires a JWT (must be logged in) AND a static reviewer
// token via x-teacher-review-token header. Guard runs after JwtAuthGuard so a
// missing/invalid token always returns 403 (never reveals 401-vs-403 to learners
// without auth). Token comes from TEACHER_REVIEW_TOKEN env; if unset, the guard
// fails closed and every request gets 403.
@Controller('teacher-review')
@UseGuards(JwtAuthGuard, TeacherReviewGuard)
export class TeacherReviewController {
  constructor(private lessons: LessonService) {}

  // GET /teacher-review/queue — attempts pending human review.
  @Get('queue')
  queue() {
    return this.lessons.getTeacherReviewQueue();
  }

  // PATCH /teacher-review/:reviewId — reviewer approves/revises/rejects.
  @Patch(':reviewId')
  update(@Req() req, @Param('reviewId') reviewId: string, @Body() body: UpdateReviewDto) {
    return this.lessons.updateTeacherReview(reviewId, req.user.id, {
      status: body.status,
      final_score: body.final_score,
      comment: body.comment,
    });
  }
}
