import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { LessonAttempt } from '../lesson/entities/lesson-attempt.entity';
import { Lesson } from '../lesson/entities/lesson.entity';
import { TeacherReview } from '../lesson/entities/teacher-review.entity';
import { Session } from '../session/entities/session.entity';
import { User } from '../user/entities/user.entity';
import { UserRole } from '../user/user-role.enum';
import { LessonService } from '../lesson/lesson.service';

type UsageSummary = {
  session_count: number;
  total_tokens: number;
  last_active_at: Date | null;
};

const OPEN_REVIEW_STATUSES = ['pending', 'assigned', 'escalated'];
const CLOSED_REVIEW_STATUSES = ['completed', 'cancelled'];

function toBaseAdminView(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    level: u.level,
    createdAt: u.createdAt,
  };
}

function asNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Session) private sessionRepo: Repository<Session>,
    @InjectRepository(Lesson) private lessonRepo: Repository<Lesson>,
    @InjectRepository(LessonAttempt) private attemptRepo: Repository<LessonAttempt>,
    @InjectRepository(TeacherReview) private reviewRepo: Repository<TeacherReview>,
    private config: ConfigService,
    private lessons: LessonService,
  ) {}

  private ratePer1kTokensUsd() {
    const parsed = Number(this.config.get<string>('ADMIN_LLM_COST_PER_1K_TOKENS_USD') ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private estimatedCostUsd(tokens: number) {
    return Number(((tokens / 1000) * this.ratePer1kTokensUsd()).toFixed(6));
  }

  private withUsage(user: User, usage?: UsageSummary) {
    const totalTokens = usage?.total_tokens ?? 0;
    return {
      ...toBaseAdminView(user),
      session_count: usage?.session_count ?? 0,
      total_tokens: totalTokens,
      estimated_cost_usd: this.estimatedCostUsd(totalTokens),
      last_active_at: usage?.last_active_at ?? null,
    };
  }

  private async usageByUserIds(userIds: string[]) {
    if (!userIds.length) return new Map<string, UsageSummary>();
    const rows = await this.sessionRepo
      .createQueryBuilder('s')
      .select('s.user_id', 'user_id')
      .addSelect('COUNT(*)', 'session_count')
      .addSelect('COALESCE(SUM(s.total_tokens), 0)', 'total_tokens')
      .addSelect('COALESCE(MAX(s.last_activity_at), MAX(s.started_at))', 'last_active_at')
      .where('s.user_id IN (:...userIds)', { userIds })
      .groupBy('s.user_id')
      .getRawMany();

    return new Map(
      rows.map((row) => [
        row.user_id,
        {
          session_count: asNumber(row.session_count),
          total_tokens: asNumber(row.total_tokens),
          last_active_at: row.last_active_at ? new Date(row.last_active_at) : null,
        },
      ]),
    );
  }

  private async usersByIds(userIds: string[]) {
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    if (!ids.length) return new Map<string, User>();
    const users = await this.userRepo.find({ where: { id: In(ids) } });
    return new Map(users.map((u) => [u.id, u]));
  }

  private async lessonsByIds(lessonIds: string[]) {
    const ids = Array.from(new Set(lessonIds.filter(Boolean)));
    if (!ids.length) return new Map<string, Lesson>();
    const lessons = await this.lessonRepo.find({ where: { id: In(ids) } });
    return new Map(lessons.map((l) => [l.id, l]));
  }

  private async attemptsByIds(attemptIds: string[]) {
    const ids = Array.from(new Set(attemptIds.filter(Boolean)));
    if (!ids.length) return new Map<string, LessonAttempt>();
    const attempts = await this.attemptRepo.find({ where: { id: In(ids) } });
    return new Map(attempts.map((a) => [a.id, a]));
  }

  private scoreFromSnapshot(snapshot: Record<string, unknown> | null) {
    if (!snapshot) return null;
    for (const key of ['total', 'score', 'final_score', 'ai_score']) {
      const value = snapshot[key];
      if (typeof value === 'number') return value;
    }
    return null;
  }

  async dashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const now = new Date();

    const [
      totalUsers,
      students,
      teachers,
      admins,
      sessionsToday,
      sessionsMonth,
      pendingReviews,
      assignedReviews,
      completedReviews,
      overdueReviews,
      tokenRow,
    ] = await Promise.all([
      this.userRepo.count(),
      this.userRepo.count({ where: { role: UserRole.STUDENT } }),
      this.userRepo.count({ where: { role: UserRole.TEACHER } }),
      this.userRepo.count({ where: { role: UserRole.ADMIN } }),
      this.sessionRepo.count({ where: { startedAt: MoreThanOrEqual(today) } }),
      this.sessionRepo.count({ where: { startedAt: MoreThanOrEqual(monthStart) } }),
      this.reviewRepo.count({ where: { taskStatus: 'pending' } }),
      this.reviewRepo.count({ where: { taskStatus: 'assigned' } }),
      this.reviewRepo.count({ where: { taskStatus: 'completed' } }),
      this.reviewRepo.count({
        where: { taskStatus: In(OPEN_REVIEW_STATUSES), dueAt: LessThan(now) },
      }),
      this.sessionRepo
        .createQueryBuilder('s')
        .select('COALESCE(SUM(s.total_tokens), 0)', 'total_tokens')
        .addSelect('COUNT(*)', 'session_count')
        .getRawOne(),
    ]);

    const totalTokens = asNumber(tokenRow?.total_tokens);
    return {
      users: { total: totalUsers, students, teachers, admins },
      sessions: {
        total: asNumber(tokenRow?.session_count),
        today: sessionsToday,
        month: sessionsMonth,
      },
      reviews: {
        pending: pendingReviews,
        assigned: assignedReviews,
        completed: completedReviews,
        overdue: overdueReviews,
      },
      usage: {
        total_tokens: totalTokens,
        rate_per_1k_tokens_usd: this.ratePer1kTokensUsd(),
        estimated_cost_usd: this.estimatedCostUsd(totalTokens),
      },
    };
  }

  async listUsers(role?: string, q?: string) {
    const where: Record<string, unknown>[] = [];
    const base = role ? { role } : {};
    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      where.push({ ...base, email: ILike(term) }, { ...base, name: ILike(term) });
    }
    const users = await this.userRepo.find({
      where: where.length ? where : base,
      order: { createdAt: 'DESC' },
      take: 200,
    });
    const usage = await this.usageByUserIds(users.map((u) => u.id));
    return users.map((u) => this.withUsage(u, usage.get(u.id)));
  }

  async getUserDetail(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const [usage, sessions, attempts] = await Promise.all([
      this.usageByUserIds([id]),
      this.sessionRepo.find({
        where: { userId: id },
        order: { startedAt: 'DESC' },
        take: 20,
      }),
      this.attemptRepo.find({
        where: { userId: id },
        order: { startedAt: 'DESC' },
        take: 20,
      }),
    ]);

    const attemptIds = attempts.map((a) => a.id);
    const reviews = await this.reviewRepo.find({
      where: attemptIds.length
        ? [{ studentId: id }, { lessonAttemptId: In(attemptIds) }]
        : [{ studentId: id }],
      order: { createdAt: 'DESC' },
      take: 50,
    });
    const lessons = await this.lessonsByIds([
      ...attempts.map((a) => a.lessonId),
      ...(reviews.map((r) => r.lessonId).filter(Boolean) as string[]),
    ]);
    const teachers = await this.usersByIds(
      reviews.map((r) => r.assignedTo ?? r.reviewerId).filter(Boolean) as string[],
    );

    return {
      user: this.withUsage(user, usage.get(id)),
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        mode: s.mode,
        total_tokens: s.totalTokens,
        lesson_attempt_id: s.lessonAttemptId,
        started_at: s.startedAt,
        ended_at: s.endedAt,
        last_activity_at: s.lastActivityAt,
      })),
      attempts: attempts.map((a) => {
        const lesson = lessons.get(a.lessonId);
        return {
          id: a.id,
          session_id: a.sessionId,
          lesson_id: a.lessonId,
          lesson_title: lesson?.title ?? null,
          status: a.status,
          score: a.score,
          final_score: a.finalScore,
          scoring_status: a.scoringStatus,
          review_required: a.reviewRequired,
          started_at: a.startedAt,
          completed_at: a.completedAt,
          finalized_at: a.finalizedAt,
        };
      }),
      reviews: reviews.map((r) => {
        const teacher = teachers.get(r.assignedTo ?? r.reviewerId ?? '');
        const lesson = r.lessonId ? lessons.get(r.lessonId) : null;
        return {
          id: r.id,
          task_status: r.taskStatus,
          status: r.status,
          task_type: r.taskType,
          priority: r.priority,
          due_at: r.dueAt,
          review_reason: r.reviewReason,
          lesson_title: lesson?.title ?? null,
          assigned_teacher: teacher
            ? { id: teacher.id, name: teacher.name, email: teacher.email, role: teacher.role }
            : null,
          final_score: r.finalScore ?? r.humanScore,
          created_at: r.createdAt,
          completed_at: r.completedAt,
        };
      }),
    };
  }

  async createUser(dto: { email: string; password: string; name: string; role: UserRole }) {
    const exists = await this.userRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already registered');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
      role: dto.role,
    });
    await this.userRepo.save(user);
    return this.withUsage(user);
  }

  async updateRole(id: string, role: UserRole) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    user.role = role;
    await this.userRepo.save(user);
    const usage = await this.usageByUserIds([id]);
    return this.withUsage(user, usage.get(id));
  }

  async listTeachers() {
    const teachers = await this.userRepo.find({
      where: { role: In([UserRole.TEACHER, UserRole.ADMIN]) },
      order: { createdAt: 'DESC' },
    });
    const ids = teachers.map((t) => t.id);
    if (!ids.length) return [];

    const [assignedRows, completedRows, usage, ratings, periodCounts] = await Promise.all([
      this.reviewRepo
        .createQueryBuilder('r')
        .select('r.assigned_to', 'teacher_id')
        .addSelect('COUNT(*)', 'open_reviews')
        .addSelect(
          "COUNT(*) FILTER (WHERE r.due_at IS NOT NULL AND r.due_at < NOW())",
          'overdue_reviews',
        )
        .where('r.assigned_to IN (:...ids)', { ids })
        .andWhere('r.task_status IN (:...statuses)', { statuses: OPEN_REVIEW_STATUSES })
        .groupBy('r.assigned_to')
        .getRawMany(),
      this.reviewRepo
        .createQueryBuilder('r')
        .select('r.reviewer_id', 'teacher_id')
        .addSelect('COUNT(*)', 'completed_reviews')
        .where('r.reviewer_id IN (:...ids)', { ids })
        .andWhere('r.task_status = :status', { status: 'completed' })
        .groupBy('r.reviewer_id')
        .getRawMany(),
      this.usageByUserIds(ids),
      this.lessons.teacherRatingAggregates(ids),
      this.lessons.teacherCompletedCounts(ids),
    ]);

    const assigned = new Map(assignedRows.map((r) => [r.teacher_id, r]));
    const completed = new Map(completedRows.map((r) => [r.teacher_id, r]));
    return teachers.map((teacher) => {
      const assignedRow = assigned.get(teacher.id);
      const completedRow = completed.get(teacher.id);
      const rating = ratings.get(teacher.id);
      const periods = periodCounts.get(teacher.id);
      return {
        ...this.withUsage(teacher, usage.get(teacher.id)),
        open_reviews: asNumber(assignedRow?.open_reviews),
        overdue_reviews: asNumber(assignedRow?.overdue_reviews),
        completed_reviews: asNumber(completedRow?.completed_reviews),
        average_rating: rating?.average_rating ?? 0,
        rating_count: rating?.rating_count ?? 0,
        completed_today: periods?.completed_today ?? 0,
        completed_this_month: periods?.completed_this_month ?? 0,
        completed_this_year: periods?.completed_this_year ?? 0,
      };
    });
  }

  /**
   * Full teacher detail for admin: profile + queue/stats + completed history +
   * student feedback. Delegates to the shared LessonService analytics so the
   * teacher's own dashboard and the admin view never drift apart.
   */
  async getTeacherDetail(id: string) {
    const teacher = await this.userRepo.findOne({ where: { id } });
    if (!teacher) throw new NotFoundException('Teacher not found');
    if (![UserRole.TEACHER, UserRole.ADMIN].includes(teacher.role as UserRole)) {
      throw new BadRequestException('User is not a teacher or admin');
    }
    const [dashboard, history, feedback] = await Promise.all([
      this.lessons.getTeacherDashboard(id),
      this.lessons.getTeacherReviewHistory(id, { limit: 50 }),
      this.lessons.getTeacherFeedback(id, { limit: 50 }),
    ]);
    const usage = await this.usageByUserIds([id]);
    return {
      teacher: this.withUsage(teacher, usage.get(id)),
      queue: dashboard.queue,
      stats: dashboard.stats,
      history: history.items,
      feedback: feedback.items,
    };
  }

  async listReviewTasks() {
    const reviews = await this.reviewRepo.find({
      order: { createdAt: 'DESC' },
      take: 250,
    });
    const attempts = await this.attemptsByIds(reviews.map((r) => r.lessonAttemptId));
    const lessons = await this.lessonsByIds([
      ...(reviews.map((r) => r.lessonId).filter(Boolean) as string[]),
      ...Array.from(attempts.values()).map((a) => a.lessonId),
    ]);
    const users = await this.usersByIds([
      ...(reviews.map((r) => r.studentId).filter(Boolean) as string[]),
      ...(reviews.map((r) => r.assignedTo).filter(Boolean) as string[]),
      ...(reviews.map((r) => r.reviewerId).filter(Boolean) as string[]),
      ...Array.from(attempts.values()).map((a) => a.userId),
    ]);

    return reviews.map((r) => {
      const attempt = attempts.get(r.lessonAttemptId);
      const lesson = (r.lessonId && lessons.get(r.lessonId)) || (attempt && lessons.get(attempt.lessonId));
      const student = users.get(r.studentId ?? attempt?.userId ?? '');
      const assignedTeacher = users.get(r.assignedTo ?? '');
      const reviewer = users.get(r.reviewerId ?? '');
      const aiScore = this.scoreFromSnapshot(r.aiScoreSnapshot) ?? attempt?.aiScore ?? attempt?.score ?? null;
      // Display-level consistency (no DB mutation): a row that carries an
      // assigned_to but is still 'pending' is, for the admin board's purposes,
      // assigned. Closed states (completed/cancelled) are never reinterpreted.
      const taskStatus =
        r.assignedTo && r.taskStatus === 'pending' ? 'assigned' : r.taskStatus;
      return {
        id: r.id,
        task_status: taskStatus,
        status: r.status,
        task_type: r.taskType,
        priority: r.priority,
        due_at: r.dueAt,
        review_reason: r.reviewReason,
        created_at: r.createdAt,
        completed_at: r.completedAt,
        assigned_to: r.assignedTo,
        reviewer_id: r.reviewerId,
        student: student
          ? { id: student.id, name: student.name, email: student.email }
          : { id: r.studentId ?? attempt?.userId ?? null, name: null, email: null },
        assigned_teacher: assignedTeacher
          ? {
              id: assignedTeacher.id,
              name: assignedTeacher.name,
              email: assignedTeacher.email,
              role: assignedTeacher.role,
            }
          : null,
        reviewer: reviewer
          ? { id: reviewer.id, name: reviewer.name, email: reviewer.email, role: reviewer.role }
          : null,
        lesson: lesson
          ? {
              id: lesson.id,
              title: lesson.title,
              level: lesson.level,
              topic: lesson.topic,
              task_type: lesson.taskType,
              pass_score: lesson.passScore,
            }
          : null,
        attempt: attempt
          ? {
              id: attempt.id,
              session_id: attempt.sessionId,
              status: attempt.status,
              scoring_status: attempt.scoringStatus,
              score: attempt.score,
              ai_score: attempt.aiScore,
              final_score: attempt.finalScore,
              finalized_at: attempt.finalizedAt,
            }
          : null,
        ai_score: aiScore,
        final_score: r.finalScore ?? r.humanScore ?? attempt?.finalScore ?? null,
      };
    });
  }

  async assignReviewTask(id: string, teacherId: string | null) {
    const review = await this.reviewRepo.findOne({ where: { id } });
    if (!review) throw new NotFoundException('Review task not found');
    if (CLOSED_REVIEW_STATUSES.includes(review.taskStatus)) {
      throw new ConflictException('Closed review tasks cannot be reassigned');
    }

    if (!teacherId) {
      review.assignedTo = null;
      if (review.taskStatus === 'assigned') review.taskStatus = 'pending';
      await this.reviewRepo.save(review);
      return this.listReviewTasks();
    }

    const teacher = await this.userRepo.findOne({ where: { id: teacherId } });
    if (!teacher || ![UserRole.TEACHER, UserRole.ADMIN].includes(teacher.role as UserRole)) {
      throw new BadRequestException('Assigned user must be a teacher or admin');
    }

    review.assignedTo = teacher.id;
    review.taskStatus = 'assigned';
    await this.reviewRepo.save(review);
    return this.listReviewTasks();
  }

  async usage() {
    // Summary is a global aggregate over ALL sessions; the table below is only
    // the top 100 users by tokens. Computing the summary from the top-100 rows
    // would understate total spend once there are >100 users with sessions.
    const [totalRow, rows] = await Promise.all([
      this.sessionRepo
        .createQueryBuilder('s')
        .select('COALESCE(SUM(s.total_tokens), 0)', 'total_tokens')
        .getRawOne(),
      this.sessionRepo
        .createQueryBuilder('s')
        .select('s.user_id', 'user_id')
        .addSelect('COUNT(*)', 'session_count')
        .addSelect('COALESCE(SUM(s.total_tokens), 0)', 'total_tokens')
        .addSelect('COALESCE(MAX(s.last_activity_at), MAX(s.started_at))', 'last_active_at')
        .groupBy('s.user_id')
        .orderBy('COALESCE(SUM(s.total_tokens), 0)', 'DESC')
        .limit(100)
        .getRawMany(),
    ]);

    const users = await this.usersByIds(rows.map((r) => r.user_id));
    const totalTokens = asNumber(totalRow?.total_tokens);
    return {
      summary: {
        total_tokens: totalTokens,
        rate_per_1k_tokens_usd: this.ratePer1kTokensUsd(),
        estimated_cost_usd: this.estimatedCostUsd(totalTokens),
      },
      users: rows.map((row) => {
        const user = users.get(row.user_id);
        const totalTokensForUser = asNumber(row.total_tokens);
        return {
          user: user ? toBaseAdminView(user) : { id: row.user_id, email: null, name: null, role: null },
          session_count: asNumber(row.session_count),
          total_tokens: totalTokensForUser,
          estimated_cost_usd: this.estimatedCostUsd(totalTokensForUser),
          last_active_at: row.last_active_at ? new Date(row.last_active_at) : null,
        };
      }),
    };
  }
}
