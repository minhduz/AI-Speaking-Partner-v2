import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Minimal demo-grade gate for the teacher-review endpoints.
 *
 * No role system exists yet. To keep learners out of the reviewer surface
 * without standing up RBAC, we require BOTH:
 *   - a logged-in user (the surrounding JwtAuthGuard still runs first), and
 *   - a request header `x-teacher-review-token` whose value matches the
 *     server-side `TEACHER_REVIEW_TOKEN` env var.
 *
 * If `TEACHER_REVIEW_TOKEN` is unset/empty, every request is refused — fail
 * closed so a misconfigured deployment cannot accidentally expose the queue.
 *
 * Apply at the controller level (`@UseGuards(JwtAuthGuard, TeacherReviewGuard)`).
 * Do NOT apply to LessonController — learner endpoints must stay open to
 * authenticated users without the reviewer token.
 */
@Injectable()
export class TeacherReviewGuard implements CanActivate {
  constructor(private readonly cfg: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = (this.cfg.get<string>('TEACHER_REVIEW_TOKEN') || '').trim();
    if (!expected) {
      // Fail closed when the token isn't configured — we never want a fresh
      // deploy to open the reviewer queue to anyone with a JWT.
      throw new ForbiddenException('Teacher review is not enabled on this deployment');
    }
    const req = context.switchToHttp().getRequest();
    const headerValue = req?.headers?.['x-teacher-review-token'];
    const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (typeof provided !== 'string' || provided.trim() !== expected) {
      throw new ForbiddenException('Missing or invalid teacher-review token');
    }
    return true;
  }
}
