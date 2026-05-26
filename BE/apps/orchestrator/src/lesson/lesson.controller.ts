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
<<<<<<< HEAD
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../user/user-role.enum';
=======
import { TeacherReviewGuard } from './guards/teacher-review.guard';
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
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

<<<<<<< HEAD
class ReviewFeedbackDto {
  @IsInt() @Min(1) @Max(5) rating: number;
  @IsOptional() @IsString() comment?: string;
}

=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
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

<<<<<<< HEAD
  // POST /lessons/attempts/:attemptId/request-review — learner sends their own
  // completed attempt to teacher review (idempotent; never resets progress).
  @Post('attempts/:attemptId/request-review')
  @HttpCode(200)
  requestReview(@Req() req, @Param('attemptId') attemptId: string) {
    return this.lessons.requestTeacherReview(req.user.id, attemptId);
  }

  // POST /lessons/reviews/:id/feedback — learner rates a COMPLETED teacher
  // review (1..5 + optional comment). Upsert; ownership enforced in the service.
  // Declared before `/:id` so "reviews" isn't parsed as a lesson UUID.
  @Post('reviews/:id/feedback')
  @HttpCode(200)
  reviewFeedback(@Req() req, @Param('id') id: string, @Body() dto: ReviewFeedbackDto) {
    return this.lessons.submitReviewFeedback(req.user.id, id, {
      rating: dto.rating,
      comment: dto.comment,
    });
  }

=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
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

<<<<<<< HEAD
// Reviewer surface — requires a logged-in user whose role is TEACHER or ADMIN.
// JwtAuthGuard populates request.user (incl. role); RolesGuard enforces @Roles.
// Learners (role=student) get 403.
@Controller('teacher-review')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TEACHER, UserRole.ADMIN)
=======
// Reviewer surface — requires a JWT (must be logged in) AND a static reviewer
// token via x-teacher-review-token header. Guard runs after JwtAuthGuard so a
// missing/invalid token always returns 403 (never reveals 401-vs-403 to learners
// without auth). Token comes from TEACHER_REVIEW_TOKEN env; if unset, the guard
// fails closed and every request gets 403.
@Controller('teacher-review')
@UseGuards(JwtAuthGuard, TeacherReviewGuard)
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
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
