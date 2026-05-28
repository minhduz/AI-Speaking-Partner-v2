<<<<<<< HEAD
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
=======
import { Injectable, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import { Lesson } from './entities/lesson.entity';
import { LessonCard, ARCHIVED_CARD_ORDER_OFFSET } from './entities/lesson-card.entity';
import {
  UserLessonProgress,
  LessonProgressState,
} from './entities/user-lesson-progress.entity';
import {
  LessonAttempt,
  LessonAttemptStatus,
  LessonNextAction,
} from './entities/lesson-attempt.entity';
import { CardAttempt } from './entities/card-attempt.entity';
import { TeacherReview, TeacherReviewStatus } from './entities/teacher-review.entity';
<<<<<<< HEAD
import { TeacherReviewFeedback } from './entities/teacher-review-feedback.entity';
import { UserSkillMastery } from './entities/user-skill-mastery.entity';
import { Session } from '../session/entities/session.entity';
import { User } from '../user/entities/user.entity';
import { UserRole } from '../user/user-role.enum';
import { TurnAudioService } from '../turn/turn-audio.service';
import {
  ScoringStatus,
  TaskType,
  ReviewTaskStatus,
  SkillKey,
  ALL_SKILLS,
  MASTERY_WEIGHT,
  TASK_PRIORITY,
  SLA_HOURS,
  ReviewReason,
} from './scoring/scoring.constants';
import {
  decideScoringOutcome,
  computeLessonOutcome,
  lessonRetryReasonText,
  compareReviewTasks,
  type LessonOutcome,
} from './scoring/scoring-decision';
=======
import { Session } from '../session/entities/session.entity';
import { User } from '../user/entities/user.entity';
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)

// Goals that the curriculum personalizes scenario text for. Anything else
// (including "other" and missing) maps to "general" (no scenario prefix).
export type LearningGoalNormalized =
  | 'career'
  | 'travel'
  | 'education'
  | 'connect'
  | 'fun'
  | 'general';

// Card types whose task templates are scenario-heavy enough to benefit from a
// short goal-specific prefix. Other types stay verbatim.
const PERSONALIZABLE_CARD_TYPES = new Set(['roleplay', 'real_situation', 'final_boss']);
// Vocabulary cards get an optional, very short prefix — only when the goal
// actually suggests a natural framing.
const LIGHT_PERSONALIZE_CARD_TYPES = new Set(['vocabulary_in_context']);

interface RuntimeCard {
  id: string;
  type: string;
  title: string;
  task: string;
  success_criteria: string[];
  expected_duration_seconds: number;
  retry_allowed: boolean;
  status: string;
  attempts: number;
  result: string | null;
  feedback: string | null;
  ui_hint: string | null;
  lesson_card_id?: string | null;
}

export interface RuntimeDeck {
  id: string;
  session_id: string;
  session_type: string;
  lesson_id: string;
  lesson_attempt_id: string;
  lesson_title: string;
  pass_score: number;
  mission: string;
  mission_source: string;
  reason: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'ended_early' | 'abandoned';
  current_card_index: number;
  cards: RuntimeCard[];
  end_reason: string | null;
  is_continuation: boolean;
}

interface CardScoreInput {
  status: string | null | undefined;
  result: string | null | undefined;
  attempts: number | null | undefined;
}

@Injectable()
export class LessonService {
  constructor(
    @InjectRepository(Lesson) private lessons: Repository<Lesson>,
    @InjectRepository(LessonCard) private cards: Repository<LessonCard>,
    @InjectRepository(UserLessonProgress) private progress: Repository<UserLessonProgress>,
    @InjectRepository(LessonAttempt) private attempts: Repository<LessonAttempt>,
    @InjectRepository(CardAttempt) private cardAttempts: Repository<CardAttempt>,
    @InjectRepository(TeacherReview) private reviews: Repository<TeacherReview>,
<<<<<<< HEAD
    @InjectRepository(TeacherReviewFeedback) private reviewFeedback: Repository<TeacherReviewFeedback>,
    @InjectRepository(UserSkillMastery) private mastery: Repository<UserSkillMastery>,
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
    @InjectRepository(Session) private sessions: Repository<Session>,
    @InjectRepository(User) private users: Repository<User>,
    private http: HttpService,
    private cfg: ConfigService,
<<<<<<< HEAD
    private turnAudio: TurnAudioService,
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
  ) {}

  // ── Path / detail ────────────────────────────────────────────────────────

  async getPath(userId: string) {
    const allLessons = await this.lessons.find({
      where: { isPublished: true },
      order: { level: 'ASC', topic: 'ASC', orderIndex: 'ASC' },
    });
    const progressRows = await this.progress.find({ where: { userId } });
    const progressByLesson = new Map(progressRows.map((p) => [p.lessonId, p]));

    // Ensure each lesson has a progress row. The first lesson of the path
    // unlocks automatically; everything else stays locked until completion.
    await this.ensureInitialUnlock(userId, allLessons, progressByLesson);
<<<<<<< HEAD
    const bestScoresByLesson = await this.finalizedBestScoresByLesson(
      userId,
      allLessons.map((l) => l.id),
    );
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)

    type Item = {
      lesson_id: string;
      title: string;
      level: string;
      topic: string;
      unit: string;
      order_index: number;
      objective: string;
      is_review: boolean;
      pass_score: number;
      state: LessonProgressState;
      best_score: number | null;
      last_attempt_id: string | null;
      next_lesson_id: string | null;
    };

<<<<<<< HEAD
    const lastAttemptIds = progressRows.map((p) => p.lastAttemptId).filter(Boolean) as string[];
    const reviewHoldAttempts = lastAttemptIds.length
      ? await this.attempts.find({
          where: { id: In(lastAttemptIds), userId, status: 'under_review' },
        })
      : [];
    const reviewHoldAttemptIds = new Set(reviewHoldAttempts.map((a) => a.id));

    const items: Item[] = allLessons.map((l) => {
      const p = progressByLesson.get(l.id);
      const rawState = p?.state ?? 'locked';
      const state =
        p && rawState !== 'completed' && p.lastAttemptId && reviewHoldAttemptIds.has(p.lastAttemptId)
          ? 'under_review'
          : rawState;
=======
    const items: Item[] = allLessons.map((l) => {
      const p = progressByLesson.get(l.id);
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
      return {
        lesson_id: l.id,
        title: l.title,
        level: l.level,
        topic: l.topic,
        unit: l.unit,
        order_index: l.orderIndex,
        objective: l.objective,
        is_review: l.isReview,
        pass_score: l.passScore,
<<<<<<< HEAD
        state,
        best_score: state === 'under_review' ? null : (bestScoresByLesson.get(l.id) ?? p?.bestScore ?? null),
=======
        state: p?.state ?? 'locked',
        best_score: p?.bestScore ?? null,
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
        last_attempt_id: p?.lastAttemptId ?? null,
        next_lesson_id: l.nextLessonId,
      };
    });

    // Continue: the user's most recent in_progress attempt across the whole path.
    const inProgressAttempt = await this.attempts.findOne({
      where: { userId, status: 'in_progress' },
      order: { startedAt: 'DESC' },
    });
    let continueLesson: Item | null = null;
    if (inProgressAttempt) {
      continueLesson = items.find((i) => i.lesson_id === inProgressAttempt.lessonId) ?? null;
    }

<<<<<<< HEAD
    // Recommended next: actionable lessons first; under-review only if nothing
    // else can be opened, so the UI can explain the waiting state.
=======
    // Recommended next: first unlocked-but-not-completed, then any in_progress.
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
    const recommended =
      items.find((i) => i.state === 'in_progress') ??
      items.find((i) => i.state === 'unlocked') ??
      items.find((i) => i.state === 'needs_retry') ??
<<<<<<< HEAD
      items.find((i) => i.state === 'under_review') ??
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
      null;

    // Group by level/topic/unit for the lesson path UI.
    const groups = new Map<string, { level: string; topic: string; unit: string; lessons: Item[] }>();
    for (const it of items) {
      const key = `${it.level}::${it.topic}::${it.unit}`;
      const g = groups.get(key) ?? { level: it.level, topic: it.topic, unit: it.unit, lessons: [] };
      g.lessons.push(it);
      groups.set(key, g);
    }

    return {
      continue_lesson: continueLesson,
      recommended_lesson: recommended,
      groups: Array.from(groups.values()),
    };
  }

  async getLessonDetail(userId: string, lessonId: string) {
    const lesson = await this.lessons.findOne({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundException('Lesson not found');
    const cards = await this.cards.find({
      where: { lessonId, orderIndex: LessThan(ARCHIVED_CARD_ORDER_OFFSET) },
      order: { orderIndex: 'ASC' },
    });
    const progress = await this.upsertProgress(userId, lessonId);
<<<<<<< HEAD
    const reviewHoldAttempt = progress.lastAttemptId
      ? await this.attempts.findOne({
          where: { id: progress.lastAttemptId, userId, lessonId, status: 'under_review' },
        })
      : null;
    const bestScore = await this.finalizedBestScore(userId, lessonId);
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
    const inProgressAttempt = await this.attempts.findOne({
      where: { userId, lessonId, status: 'in_progress' },
      order: { startedAt: 'DESC' },
    });
    const goal = await this.getUserLearningGoal(userId);
    const personalizedCards = cards.map((c) => {
      const personalizedTask = this.personalizeTaskForGoal(
        c.taskTemplate,
        c.type,
        lesson.title,
        goal,
      );
      return {
        id: c.id,
        order_index: c.orderIndex,
        type: c.type,
        title: c.title,
        task_preview: this.previewTask(personalizedTask),
        expected_duration_seconds: c.expectedDurationSeconds,
        is_personalized: personalizedTask !== c.taskTemplate,
      };
    });
    return {
      lesson: {
        id: lesson.id,
        title: lesson.title,
        level: lesson.level,
        topic: lesson.topic,
        unit: lesson.unit,
        order_index: lesson.orderIndex,
        objective: lesson.objective,
        mini_plan_text: lesson.miniPlanText,
        pass_score: lesson.passScore,
        is_review: lesson.isReview,
        next_lesson_id: lesson.nextLessonId,
      },
      cards: personalizedCards,
      progress: {
<<<<<<< HEAD
        state: reviewHoldAttempt && progress.state !== 'completed' ? 'under_review' : progress.state,
        best_score: reviewHoldAttempt && progress.state !== 'completed' ? null : (bestScore ?? progress.bestScore),
        last_attempt_id: progress.lastAttemptId,
      },
      in_progress_attempt_id: reviewHoldAttempt ? null : (inProgressAttempt?.id ?? null),
=======
        state: progress.state,
        best_score: progress.bestScore,
        last_attempt_id: progress.lastAttemptId,
      },
      in_progress_attempt_id: inProgressAttempt?.id ?? null,
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
      personalized: goal !== 'general' && personalizedCards.some((c) => c.is_personalized),
    };
  }

  // ── Start / continue ─────────────────────────────────────────────────────

  /**
   * Create or reuse an in-progress lesson attempt, create the speaking session
   * tied to that attempt, build the runtime deck from lesson cards (with light
   * memory-driven personalization) and persist it into the memory-service deck
   * store. Returns the IDs the FE needs to navigate into chat.
   */
  async startLesson(userId: string, lessonId: string) {
    const lesson = await this.lessons.findOne({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundException('Lesson not found');

    const progress = await this.upsertProgress(userId, lessonId);
    if (progress.state === 'locked') {
      throw new HttpException(
        { error: 'LESSON_LOCKED', lesson_id: lessonId },
        HttpStatus.FORBIDDEN,
      );
    }
<<<<<<< HEAD
    if (progress.state === 'under_review') {
      throw new ConflictException({
        error: 'LESSON_UNDER_REVIEW',
        message: 'This lesson is waiting for teacher review',
        lesson_id: lessonId,
        attempt_id: progress.lastAttemptId,
      });
    }
    if (progress.lastAttemptId) {
      const reviewHoldAttempt = await this.attempts.findOne({
        where: { id: progress.lastAttemptId, userId, lessonId, status: 'under_review' },
      });
      if (reviewHoldAttempt && progress.state !== 'completed') {
        throw new ConflictException({
          error: 'LESSON_UNDER_REVIEW',
          message: 'This lesson is waiting for teacher review',
          lesson_id: lessonId,
          attempt_id: reviewHoldAttempt.id,
        });
      }
    }
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)

    let attempt = await this.attempts.findOne({
      where: { userId, lessonId, status: 'in_progress' },
      order: { startedAt: 'DESC' },
    });
    if (!attempt) {
      attempt = this.attempts.create({
        userId,
        lessonId,
        status: 'in_progress',
        nextAction: 'none',
      });
      await this.attempts.save(attempt);
    }

    // Bind a session to this attempt — if a session was already started for it
    // but not ended, reuse it so refreshing the lesson card doesn't fork a
    // second session. Otherwise create a fresh session row.
    let session: Session | null = attempt.sessionId
      ? await this.sessions.findOne({ where: { id: attempt.sessionId, userId } })
      : null;
    if (!session || session.status === 'ended' || session.status === 'abandoned') {
      session = this.sessions.create({
        userId,
        status: 'active',
        mode: 'guided_learning',
        lessonAttemptId: attempt.id,
        title: lesson.title,
      });
      await this.sessions.save(session);
      attempt.sessionId = session.id;
      await this.attempts.save(attempt);
    } else if (!session.lessonAttemptId) {
      await this.sessions.update(session.id, { lessonAttemptId: attempt.id, title: lesson.title });
    }

    if (progress.state !== 'in_progress' && progress.state !== 'completed') {
      await this.progress.update({ id: progress.id }, { state: 'in_progress' });
    }

    const lessonCards = await this.cards.find({
      where: { lessonId, orderIndex: LessThan(ARCHIVED_CARD_ORDER_OFFSET) },
      order: { orderIndex: 'ASC' },
    });

    // Reuse the existing runtime deck if one is already in flight for this
    // attempt. Without this, "Continue lesson" from the detail page would
    // build a fresh deck and the memory-service would happily overwrite
    // (same lesson_attempt_id → guard #1 doesn't fire) — user loses
    // attempts/feedback/card progress on card 3 of 4. We only rebuild when
    // there's no deck yet, or when the existing deck is finished/abandoned.
    const existingDeck = await this.fetchExistingDeck(session.id);
    const liveStates = new Set(['not_started', 'in_progress']);
    const canReuse =
      existingDeck &&
      existingDeck.lesson_attempt_id === attempt.id &&
      liveStates.has(existingDeck.status);
    const goal = await this.getUserLearningGoal(userId);
    const deck = canReuse
      ? (existingDeck as RuntimeDeck)
      : this.buildRuntimeDeck(lesson, lessonCards, session.id, attempt.id, goal);
    if (!canReuse) {
      await this.persistDeck(session.id, deck);
    }

    return {
      session_id: session.id,
      lesson_attempt_id: attempt.id,
      lesson: {
        id: lesson.id,
        title: lesson.title,
        objective: lesson.objective,
        pass_score: lesson.passScore,
        mini_plan_text: lesson.miniPlanText,
      },
      deck_summary: {
        cards: deck.cards.length,
        mission: deck.mission,
      },
      resumed: canReuse,
    };
  }

  private async fetchExistingDeck(sessionId: string): Promise<RuntimeDeck | null> {
    const memoryUrl = this.cfg.get<string>('MEMORY_SERVICE_URL');
    try {
      const res = await firstValueFrom(
        this.http.get<any>(`${memoryUrl}/exercise-deck/${sessionId}`),
      );
      const data = res?.data;
      if (!data || data.status === 'none') return null;
      return data as RuntimeDeck;
    } catch {
      return null;
    }
  }

  // ── Attempt details / teacher review ─────────────────────────────────────

  async getAttempt(userId: string, attemptId: string) {
    const attempt = await this.attempts.findOne({ where: { id: attemptId, userId } });
    if (!attempt) throw new NotFoundException('Lesson attempt not found');
    const lesson = await this.lessons.findOne({ where: { id: attempt.lessonId } });
    const cards = await this.cardAttempts.find({
      where: { lessonAttemptId: attemptId },
      order: { createdAt: 'ASC' },
    });
<<<<<<< HEAD
    const completed = cards.filter((c) => c.status === 'completed').length;

    const taskType = this.normalizeTaskType(lesson?.taskType);
    const isFinalized = attempt.scoringStatus === ScoringStatus.FINALIZED;
    // Level-final AI scores are never shown until a human finalizes.
    const aiScoreExposed =
      taskType === TaskType.LEVEL_FINAL && !isFinalized ? null : attempt.aiScore;
    const aiBreakdownExposed =
      taskType === TaskType.LEVEL_FINAL && !isFinalized ? null : (attempt.aiScoreBreakdown ?? null);
    const nodeStatus = this.deriveNodeStatus(attempt);

    // Two independent scoring views: the AI's fast feedback, and the optional
    // human review. The teacher view is deterministic across multiple reviews
    // and NEVER borrows the AI breakdown (see buildTeacherReviewView).
    const teacherReview = await this.buildTeacherReviewView(attemptId, userId);

    // Explain WHY a finalized attempt didn't pass/unlock (e.g. "task completion
    // below required level") so the UI doesn't show "Needs retry" next to a
    // passing-looking best score with no reason.
    let retryReason: string | null = null;
    if (isFinalized && lesson && (attempt.status === 'needs_retry' || attempt.status === 'failed')) {
      const outcome = computeLessonOutcome({
        finalScore: attempt.finalScore ?? 0,
        passScore: lesson.passScore,
        breakdown: (attempt.finalScoreBreakdown ?? {}) as Record<string, number>,
      });
      retryReason = lessonRetryReasonText(outcome.blockReason);
    }

=======
    const review = await this.reviews.findOne({
      where: { lessonAttemptId: attemptId },
      order: { createdAt: 'DESC' },
    });

    const completed = cards.filter((c) => c.status === 'completed').length;

>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
    return {
      attempt: {
        id: attempt.id,
        lesson_id: attempt.lessonId,
        session_id: attempt.sessionId,
        status: attempt.status,
        score: attempt.score,
        next_action: attempt.nextAction,
        teacher_review_status: attempt.teacherReviewStatus,
        ai_feedback: attempt.aiFeedback,
        started_at: attempt.startedAt,
        completed_at: attempt.completedAt,
<<<<<<< HEAD
        // Scoring lifecycle (Hybrid Scoring)
        scoring_status: attempt.scoringStatus,
        review_required: attempt.reviewRequired,
        review_reason: attempt.reviewReason,
        ai_score: aiScoreExposed,
        final_score: isFinalized ? attempt.finalScore : null,
        final_score_breakdown: isFinalized ? attempt.finalScoreBreakdown : null,
        finalized_at: attempt.finalizedAt,
        node_status: nodeStatus,
        retry_reason: retryReason,
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
      },
      lesson: lesson
        ? {
            id: lesson.id,
            title: lesson.title,
            level: lesson.level,
            topic: lesson.topic,
            unit: lesson.unit,
            pass_score: lesson.passScore,
            next_lesson_id: lesson.nextLessonId,
          }
        : null,
      cards: cards.map((c) => ({
        id: c.id,
        lesson_card_id: c.lessonCardId,
        runtime_card_id: c.runtimeCardId,
        status: c.status,
        result: c.result,
        attempts: c.attempts,
        score: c.score,
        feedback: c.feedback,
      })),
      stats: {
        cards_completed: completed,
        cards_total: cards.length,
      },
<<<<<<< HEAD
      // AI feedback is always available; teacher review is the optional human pass.
      ai_review: {
        score: aiScoreExposed,
        breakdown: aiBreakdownExposed,
        feedback: attempt.aiFeedback,
        scoring_status: attempt.scoringStatus,
        finalized_at: attempt.finalizedAt,
      },
      teacher_review: teacherReview,
    };
  }

  /**
   * Build the learner-facing teacher-review view for an attempt. Deterministic
   * when several reviews exist: prefer the most recent COMPLETED review (for the
   * completed display), else the most recent OPEN review (pending/assigned/
   * escalated), else the most recent of whatever remains.
   *
   * The teacher breakdown/score comes ONLY from the human review when completed
   * (humanScoreBreakdown/humanScore). It never falls back to the AI breakdown —
   * so we can't mislabel an AI-finalized score as teacher-reviewed.
   */
  private reviewRecency(r: TeacherReview): number {
    return (r.completedAt ?? r.reviewedAt ?? r.createdAt).getTime();
  }

  private async buildTeacherReviewView(attemptId: string, studentId?: string) {
    const OPEN: string[] = [
      ReviewTaskStatus.PENDING,
      ReviewTaskStatus.ASSIGNED,
      ReviewTaskStatus.ESCALATED,
    ];
    const reviews = await this.reviews.find({
      where: { lessonAttemptId: attemptId },
      order: { createdAt: 'DESC' },
    });
    if (reviews.length === 0) {
      return {
        id: null,
        review_id: null,
        requested: false,
        status: 'not_requested' as const,
        task_status: null,
        decision: null,
        assigned_teacher: null,
        reviewed_by: null,
        score: null,
        final_score: null,
        breakdown: null,
        note: null,
        comment: null,
        review_reason: null,
        requested_at: null,
        created_at: null,
        completed_at: null,
        reviewed_at: null,
        feedback: null,
      };
    }

    const completedReviews = reviews
      .filter((r) => r.taskStatus === ReviewTaskStatus.COMPLETED)
      .sort((a, b) => this.reviewRecency(b) - this.reviewRecency(a));
    const openReviews = reviews.filter((r) => OPEN.includes(r.taskStatus));
    const chosen = completedReviews[0] ?? openReviews[0] ?? reviews[0];

    const isCompleted = chosen.taskStatus === ReviewTaskStatus.COMPLETED;
    const status: 'pending' | 'assigned' | 'completed' | 'rejected' | 'cancelled' | 'escalated' =
      isCompleted
        ? chosen.status === 'rejected'
          ? 'rejected'
          : 'completed'
        : chosen.taskStatus === ReviewTaskStatus.ASSIGNED
          ? 'assigned'
          : chosen.taskStatus === ReviewTaskStatus.ESCALATED
            ? 'escalated'
            : chosen.taskStatus === ReviewTaskStatus.CANCELLED
              ? 'cancelled'
              : 'pending';

    const userIds = [chosen.assignedTo, chosen.reviewerId].filter(Boolean) as string[];
    const userMap = userIds.length
      ? new Map((await this.users.find({ where: { id: In(userIds) } })).map((u) => [u.id, u]))
      : new Map<string, User>();
    const publicUser = (id: string | null) => {
      const u = id ? userMap.get(id) : null;
      return u ? { id: u.id, name: u.name, email: u.email } : null;
    };

    // Human breakdown/score only on a completed human review — never AI data.
    const breakdown = isCompleted ? (chosen.humanScoreBreakdown ?? null) : null;
    const score = isCompleted ? (chosen.humanScore ?? chosen.finalScore ?? null) : null;

    // The viewing student's own rating/feedback on this completed review, so the
    // session breakdown knows whether to show the form or the submitted state.
    let feedback: {
      rating: number;
      comment: string | null;
      created_at: Date;
      updated_at: Date;
    } | null = null;
    if (isCompleted && studentId) {
      const fb = await this.reviewFeedback.findOne({
        where: { teacherReviewId: chosen.id, studentId },
      });
      if (fb) {
        feedback = {
          rating: fb.rating,
          comment: fb.comment ?? null,
          created_at: fb.createdAt,
          updated_at: fb.updatedAt,
        };
      }
    }

    return {
      id: chosen.id,
      review_id: chosen.id,
      requested: true,
      status,
      task_status: chosen.taskStatus,
      decision: chosen.status,
      assigned_teacher: publicUser(chosen.assignedTo),
      reviewed_by: isCompleted ? publicUser(chosen.reviewerId) : null,
      score,
      final_score: score,
      breakdown,
      note: chosen.comment ?? null,
      comment: chosen.comment ?? null,
      review_reason: chosen.reviewReason ?? null,
      requested_at: chosen.createdAt,
      created_at: chosen.createdAt,
      completed_at: chosen.completedAt ?? null,
      reviewed_at: chosen.reviewedAt ?? null,
      feedback,
    };
  }

  async getLessonTitlesForAttempts(userId: string, attemptIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(attemptIds.filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();
    const attempts = await this.attempts.find({
      where: { id: In(uniqueIds), userId },
      select: ['id', 'lessonId'],
    });
    const lessonIds = [...new Set(attempts.map((a) => a.lessonId).filter(Boolean))];
    if (lessonIds.length === 0) return new Map();
    const lessons = await this.lessons.find({
      where: { id: In(lessonIds) },
      select: ['id', 'title'],
    });
    const lessonById = new Map(lessons.map((l) => [l.id, l.title]));
    return new Map(
      attempts
        .map((a) => [a.id, lessonById.get(a.lessonId)] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    );
  }

=======
      teacher_review: review
        ? {
            id: review.id,
            status: review.status,
            final_score: review.finalScore,
            comment: review.comment,
            reviewed_at: review.reviewedAt,
          }
        : null,
    };
  }

>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
  async getTeacherReviewQueue() {
    const rows = await this.reviews.find({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' },
    });
    if (rows.length === 0) return { items: [] };
    const attemptIds = rows.map((r) => r.lessonAttemptId);
    const attempts = await this.attempts.find({ where: { id: In(attemptIds) } });
    const lessons = await this.lessons.find({ where: { id: In(attempts.map((a) => a.lessonId)) } });
    const lessonById = new Map(lessons.map((l) => [l.id, l]));
    const attemptById = new Map(attempts.map((a) => [a.id, a]));
    return {
      items: rows.map((r) => {
        const a = attemptById.get(r.lessonAttemptId);
        const l = a ? lessonById.get(a.lessonId) : undefined;
<<<<<<< HEAD
        // Under-review attempts have attempt.score = null; the AI score lives in
        // the review snapshot (or attempt.aiScore), so surface that for the UI.
        const snapshotAi = (r.aiScoreSnapshot as { ai_score?: number } | null)?.ai_score;
        const aiScore = snapshotAi ?? a?.aiScore ?? a?.score ?? null;
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
        return {
          review_id: r.id,
          lesson_attempt_id: r.lessonAttemptId,
          status: r.status,
<<<<<<< HEAD
          task_status: r.taskStatus,
          task_type: r.taskType,
          priority: r.priority,
          due_at: r.dueAt,
          review_reason: r.reviewReason,
          assigned_to: r.assignedTo,
          created_at: r.createdAt,
          user_id: a?.userId ?? r.studentId ?? null,
          ai_score: aiScore,
          score: aiScore,
=======
          created_at: r.createdAt,
          user_id: a?.userId ?? null,
          score: a?.score ?? null,
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
          lesson: l
            ? { id: l.id, title: l.title, level: l.level, topic: l.topic, unit: l.unit }
            : null,
        };
      }),
    };
  }

<<<<<<< HEAD
  /**
   * Legacy teacher-review PATCH. A real decision (approved/revised/rejected)
   * delegates to submitHumanReview, which requires the task to already be
   * ASSIGNED to this rater — reviewers must claim work via
   * /review-tasks/next → /review-tasks/:id/assign, not self-pick from the queue.
   * A bare 'pending' save (e.g. noting) only updates fields and does not assign.
   */
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
  async updateTeacherReview(
    reviewId: string,
    reviewerId: string,
    update: { status?: TeacherReviewStatus; final_score?: number | null; comment?: string | null },
  ) {
    const review = await this.reviews.findOne({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');
<<<<<<< HEAD

    const status = update.status ?? review.status;
    if (status !== 'pending') {
      const result = await this.submitHumanReview(reviewId, reviewerId, {
        decision: status,
        finalScore: typeof update.final_score === 'number' ? update.final_score : undefined,
        note: update.comment ?? undefined,
      });
      return { review_id: result.review_id, status };
    }

    // Pending save — no finalization, no assignment.
    review.reviewerId = reviewerId;
    if (typeof update.final_score === 'number') review.finalScore = update.final_score;
    if (update.comment !== undefined) review.comment = update.comment;
    await this.reviews.save(review);
=======
    const status = update.status ?? review.status;
    review.status = status;
    review.reviewerId = reviewerId;
    if (typeof update.final_score === 'number') review.finalScore = update.final_score;
    if (update.comment !== undefined) review.comment = update.comment;
    if (status !== 'pending') review.reviewedAt = new Date();
    await this.reviews.save(review);

    await this.attempts.update({ id: review.lessonAttemptId }, { teacherReviewStatus: status });
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
    return { review_id: review.id, status: review.status };
  }

  // ── Scoring + progression (called from SessionService on session.end) ────

  /**
   * Score a lesson attempt against the just-ended runtime deck. Persists
   * card_attempts, updates lesson_attempts, advances user_lesson_progress,
   * and (when product rules require it) opens a TeacherReview row.
   * end_reason / deck_status decide the "abandoned" branch.
   * Idempotent — safe to call twice for the same attempt.
   */
  async finalizeAttempt(params: {
    attemptId: string;
    userId: string;
    deck: {
      cards?: Array<Record<string, unknown>>;
      status?: string;
      end_reason?: string;
    } | null;
    sessionEndReason: string;
  }): Promise<{
    status: LessonAttemptStatus;
    score: number;
    next_action: LessonNextAction;
    teacher_review_status: 'not_required' | 'pending' | 'approved' | 'revised' | 'rejected';
  } | null> {
    const attempt = await this.attempts.findOne({ where: { id: params.attemptId } });
    if (!attempt) return null;
    if (attempt.status !== 'in_progress') {
<<<<<<< HEAD
      // Already finalized / under review — return the persisted shape.
=======
      // Already finalized — return the persisted shape.
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
      return {
        status: attempt.status,
        score: attempt.score ?? 0,
        next_action: attempt.nextAction,
        teacher_review_status: attempt.teacherReviewStatus,
      };
    }
    const lesson = await this.lessons.findOne({ where: { id: attempt.lessonId } });
    if (!lesson) return null;

    const lessonCards = await this.cards.find({
      where: { lessonId: lesson.id, orderIndex: LessThan(ARCHIVED_CARD_ORDER_OFFSET) },
      order: { orderIndex: 'ASC' },
    });
    const cardByOrderId = new Map<string, LessonCard>();
    lessonCards.forEach((c, idx) => cardByOrderId.set(`card-${idx + 1}`, c));

    const runtimeCards = Array.isArray(params.deck?.cards) ? params.deck!.cards : [];
    const cardScores: Array<{
      runtimeCardId: string;
      lessonCardId: string | null;
      status: 'not_started' | 'completed' | 'skipped';
      result: 'passed' | 'failed' | null;
      attempts: number;
      score: number;
      feedback: string | null;
    }> = [];

    for (let i = 0; i < runtimeCards.length; i++) {
      const c = runtimeCards[i] as Record<string, unknown>;
      const runtimeCardId = (c?.id as string) ?? `card-${i + 1}`;
      const lessonCard = cardByOrderId.get(runtimeCardId) ?? lessonCards[i] ?? null;
      const scored = this.scoreCard({
        status: c?.status as string | undefined,
        result: c?.result as string | undefined,
        attempts: (c?.attempts as number | undefined) ?? 0,
      });
      cardScores.push({
        runtimeCardId,
        lessonCardId: lessonCard?.id ?? null,
        status: scored.status,
        result: scored.result,
        attempts: scored.attempts,
        score: scored.score,
        feedback: typeof c?.feedback === 'string' ? (c.feedback as string) : null,
      });
    }

    // Persist per-card attempts (replace any prior rows for idempotency).
    await this.cardAttempts.delete({ lessonAttemptId: attempt.id });
    if (cardScores.length > 0) {
      const rows = cardScores.map((cs) =>
        this.cardAttempts.create({
          lessonAttemptId: attempt.id,
          lessonCardId: cs.lessonCardId,
          runtimeCardId: cs.runtimeCardId,
          status: cs.status,
          result: cs.result,
          attempts: cs.attempts,
          score: cs.score,
          feedback: cs.feedback,
        }),
      );
      await this.cardAttempts.save(rows);
    }

<<<<<<< HEAD
    const aiScore =
      cardScores.length > 0
        ? Math.round(cardScores.reduce((sum, c) => sum + c.score, 0) / cardScores.length)
        : 0;
=======
    const finalScore =
      cardScores.length > 0
        ? Math.round(cardScores.reduce((sum, c) => sum + c.score, 0) / cardScores.length)
        : 0;
    const lastCard = cardScores[cardScores.length - 1];
    const lastPassed = lastCard?.result === 'passed';
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)

    const isAbandoned =
      params.sessionEndReason === 'idle_timeout' ||
      params.sessionEndReason === 'tab_close' ||
      params.deck?.status === 'abandoned' ||
      params.deck?.end_reason === 'idle_timeout';

    const completedAny = cardScores.some((c) => c.status === 'completed');

<<<<<<< HEAD
    // Common AI feedback blob (kept for back-compat with the FE).
=======
    let status: LessonAttemptStatus;
    let nextAction: LessonNextAction;
    if (isAbandoned && !completedAny) {
      status = 'abandoned';
      nextAction = 'continue_later';
    } else if (finalScore >= lesson.passScore && lastPassed) {
      status = 'passed';
      nextAction = lesson.nextLessonId ? 'next_lesson' : 'none';
    } else if (finalScore >= 50) {
      status = 'needs_retry';
      nextAction = 'retry_lesson';
    } else {
      status = 'failed';
      nextAction = 'remedial_drill';
    }

    // Teacher review gating.
    const lastFailedButPassed = lastCard?.result === 'failed' && status === 'passed';
    const aiMissing = !cardScores.length || cardScores.every((c) => c.result === null);
    const needsReview =
      lesson.isReview ||
      (finalScore >= 60 && finalScore <= 75) ||
      lastFailedButPassed ||
      aiMissing;
    const teacherReviewStatus: 'not_required' | 'pending' = needsReview ? 'pending' : 'not_required';

    attempt.status = status;
    attempt.score = finalScore;
    attempt.nextAction = nextAction;
    attempt.teacherReviewStatus = teacherReviewStatus;
    attempt.completedAt = new Date();
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
    attempt.aiFeedback = {
      card_scores: cardScores.map((cs) => ({
        runtime_card_id: cs.runtimeCardId,
        status: cs.status,
        result: cs.result,
        attempts: cs.attempts,
        score: cs.score,
      })),
      deck_status: params.deck?.status ?? null,
      deck_end_reason: params.deck?.end_reason ?? null,
    };
<<<<<<< HEAD
    attempt.completedAt = new Date();

    // Abandoned with nothing completed → don't score, allow resume. Unchanged.
    if (isAbandoned && !completedAny) {
      attempt.status = 'abandoned';
      attempt.nextAction = 'continue_later';
      attempt.scoringStatus = ScoringStatus.SUBMITTED;
      attempt.teacherReviewStatus = 'not_required';
      attempt.score = null;
      await this.attempts.save(attempt);
      const p = await this.upsertProgress(attempt.userId, lesson.id);
      if (p.state !== 'completed') {
        p.state = 'in_progress';
        await this.progress.save(p);
      }
      return {
        status: 'abandoned',
        score: 0,
        next_action: 'continue_later',
        teacher_review_status: 'not_required',
      };
    }

    // ── AI score breakdown + quality signals (best-effort from deck) ────────
    // TODO: replace heuristics with real per-skill scores + confidence/quality
    // from turn-agent / consolidation (sessions.breakdown) once available.
    const aiBreakdown = this.deriveAiScoreBreakdown(cardScores, aiScore);
    const quality = this.deriveQualitySignals(cardScores);
    const taskType = this.normalizeTaskType(lesson.taskType);

    attempt.aiScore = aiScore;
    attempt.aiScoreBreakdown = aiBreakdown;
    attempt.aiConfidence = quality.aiConfidence;
    attempt.transcriptQuality = quality.transcriptQuality;
    attempt.audioQuality = quality.audioQuality;

    const decision = decideScoringOutcome({
      taskType,
      aiScore,
      passScore: lesson.passScore,
      taskCompletion: aiBreakdown[SkillKey.TASK_COMPLETION],
      aiConfidence: quality.aiConfidence,
      transcriptQuality: quality.transcriptQuality,
      audioQuality: quality.audioQuality,
      answerTooShort: quality.answerTooShort,
    });

    // Quality too low to trust → resubmit, no official score, no human review.
    if (decision.qualityResubmit) {
      attempt.scoringStatus = ScoringStatus.AI_SCORED;
      attempt.reviewRequired = false;
      attempt.reviewReason = null;
      attempt.status = 'needs_retry';
      attempt.nextAction = 'retry_lesson';
      attempt.teacherReviewStatus = 'not_required';
      attempt.score = null;
      await this.attempts.save(attempt);
      const p = await this.upsertProgress(attempt.userId, lesson.id);
      if (p.state !== 'completed') {
        p.state = 'needs_retry';
        p.lastAttemptId = attempt.id;
        await this.progress.save(p);
      }
      return {
        status: 'needs_retry',
        score: 0,
        next_action: 'retry_lesson',
        teacher_review_status: 'not_required',
      };
    }

    if (decision.autoFinalize) {
      // final = ai; finalize and run progression + mastery.
      attempt.scoringStatus = ScoringStatus.FINALIZED;
      attempt.finalScore = aiScore;
      attempt.finalScoreBreakdown = aiBreakdown;
      attempt.finalizedAt = new Date();
      attempt.reviewRequired = false;
      attempt.reviewReason = null;
      attempt.teacherReviewStatus = 'not_required';
      attempt.score = aiScore;

      // Pass/unlock is decided by final_score + task_completion + skill floors,
      // NOT by whether the final card itself passed.
      const outcome = computeLessonOutcome({
        finalScore: aiScore,
        passScore: lesson.passScore,
        breakdown: aiBreakdown,
      });
      attempt.status = outcome.status;
      attempt.nextAction = this.lessonNextAction(outcome, lesson);
      await this.attempts.save(attempt);

      await this.applyProgressionAndMastery({
        attempt,
        lesson,
        finalScore: aiScore,
        breakdown: aiBreakdown,
        taskType,
        outcome,
      });

      return {
        status: attempt.status,
        score: aiScore,
        next_action: attempt.nextAction,
        teacher_review_status: 'not_required',
      };
    }

    // ── Needs human review: do NOT finalize, do NOT unlock next ─────────────
    attempt.scoringStatus = ScoringStatus.NEEDS_REVIEW;
    attempt.reviewRequired = true;
    attempt.reviewReason = decision.reviewReasons.join(',');
    attempt.status = 'under_review';
    attempt.nextAction = 'none';
    attempt.teacherReviewStatus = 'pending';
    // Level-final must never expose an AI final score; others stay null until human.
    attempt.finalScore = null;
    attempt.score = null;
    await this.attempts.save(attempt);

    await this.createReviewTaskForSubmission({
      attempt,
      lesson,
      taskType,
      reasons: decision.reviewReasons,
      aiScore,
      aiBreakdown,
    });

    // Progress stays non-completed; record the attempt but keep next locked.
    const progress = await this.upsertProgress(attempt.userId, lesson.id);
    progress.lastAttemptId = attempt.id;
    if (progress.state !== 'completed') progress.state = 'in_progress';
    await this.progress.save(progress);

    return {
      status: 'under_review',
      score: 0,
      next_action: 'none',
      teacher_review_status: 'pending',
    };
  }

  // ── Scoring helpers (Hybrid Scoring) ──────────────────────────────────────

  private normalizeTaskType(raw: string | null | undefined): TaskType {
    if (raw === TaskType.CHECKPOINT) return TaskType.CHECKPOINT;
    if (raw === TaskType.LEVEL_FINAL) return TaskType.LEVEL_FINAL;
    return TaskType.PRACTICE;
  }

  /**
   * Map an attempt's lifecycle to a learner-facing node status:
   * submitted | under_review | passed | needs_practice | retry_required.
   */
  private deriveNodeStatus(
    attempt: LessonAttempt,
  ): 'submitted' | 'under_review' | 'passed' | 'needs_practice' | 'retry_required' {
    if (attempt.scoringStatus === ScoringStatus.NEEDS_REVIEW || attempt.status === 'under_review') {
      return 'under_review';
    }
    if (attempt.scoringStatus === ScoringStatus.FINALIZED) {
      if (attempt.status === 'passed') return 'passed';
      if (attempt.status === 'needs_retry') return 'retry_required';
      if (attempt.status === 'failed') return 'needs_practice';
    }
    return 'submitted';
  }

  /**
   * Best-effort per-skill breakdown from the deck. We can only compute
   * task_completion reliably (completed/passed ratio); the language skills are
   * approximated from the overall AI score until real per-skill signals exist.
   * TODO: source grammar/vocabulary/pronunciation/fluency from turn-agent.
   */
  private deriveAiScoreBreakdown(
    cardScores: Array<{ status: string; result: string | null; score: number }>,
    aiScore: number,
  ): Record<string, number> {
    const total = cardScores.length;
    const passed = cardScores.filter((c) => c.result === 'passed').length;
    const taskCompletion = total > 0 ? Math.round((passed / total) * 100) : 0;
    return {
      [SkillKey.TASK_COMPLETION]: taskCompletion,
      [SkillKey.GRAMMAR]: aiScore,
      [SkillKey.VOCABULARY]: aiScore,
      [SkillKey.PRONUNCIATION]: aiScore,
      [SkillKey.FLUENCY]: aiScore,
      total: aiScore,
    };
  }

  /**
   * Heuristic confidence/quality. We don't have real ASR confidence or audio
   * quality at finalize time, so we infer from deck completeness: missing
   * results or near-empty attempts → low. TODO: real signals from turn-agent.
   */
  private deriveQualitySignals(
    cardScores: Array<{ status: string; result: string | null; attempts: number }>,
  ): { aiConfidence: number; transcriptQuality: number; audioQuality: number; answerTooShort: boolean } {
    const total = cardScores.length;
    const scored = cardScores.filter((c) => c.result !== null).length;
    const anyAttempted = cardScores.some((c) => c.attempts > 0);
    const aiMissing = total === 0 || scored === 0;
    // Confidence scales with how much of the deck the AI actually scored.
    const coverage = total > 0 ? scored / total : 0;
    return {
      aiConfidence: aiMissing ? 0.3 : Math.min(1, 0.6 + coverage * 0.4),
      transcriptQuality: anyAttempted ? 0.9 : 0.4,
      audioQuality: anyAttempted ? 0.9 : 0.4,
      answerTooShort: !anyAttempted,
    };
  }

  /**
   * Map a finalized LessonOutcome to the attempt's next_action. Passing unlocks
   * the next lesson; a critical-skill block routes to remedial; everything else
   * retries.
   */
  private lessonNextAction(outcome: LessonOutcome, lesson: Lesson): LessonNextAction {
    if (outcome.status === 'passed') {
      return lesson.nextLessonId ? 'next_lesson' : 'none';
    }
    if (outcome.blockReason === 'critical_skill' || outcome.status === 'failed') {
      return 'remedial_drill';
    }
    return 'retry_lesson';
  }

  /**
   * Apply lesson progression + per-skill mastery for a FINALIZED attempt.
   * Reused by both AI auto-finalize and human review submission.
   */
  private async applyProgressionAndMastery(params: {
    attempt: LessonAttempt;
    lesson: Lesson;
    finalScore: number;
    breakdown: Record<string, number>;
    taskType: TaskType;
    outcome: { status: LessonAttemptStatus; unlock: boolean };
    recomputeBestScore?: boolean;
  }): Promise<void> {
    const { attempt, lesson, finalScore, breakdown, taskType, outcome, recomputeBestScore } = params;

    const progress = await this.upsertProgress(attempt.userId, lesson.id);
    const wasAlreadyCompleted = progress.state === 'completed';
    progress.lastAttemptId = attempt.id;
    progress.bestScore = recomputeBestScore
      ? await this.finalizedBestScore(attempt.userId, lesson.id)
      : Math.max(progress.bestScore ?? 0, finalScore);

    if (outcome.status === 'passed' && outcome.unlock) {
=======
    await this.attempts.save(attempt);

    if (needsReview) {
      const existing = await this.reviews.findOne({
        where: { lessonAttemptId: attempt.id, status: 'pending' },
      });
      if (!existing) {
        await this.reviews.save(
          this.reviews.create({
            lessonAttemptId: attempt.id,
            status: 'pending',
          }),
        );
      }
    }

    // Progression: update lesson progress + maybe unlock next lesson.
    const progress = await this.upsertProgress(attempt.userId, lesson.id);
    const wasAlreadyCompleted = progress.state === 'completed';
    progress.lastAttemptId = attempt.id;
    progress.bestScore = Math.max(progress.bestScore ?? 0, finalScore);

    if (status === 'passed') {
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
      progress.state = 'completed';
      progress.completedAt = new Date();
      await this.progress.save(progress);
      if (lesson.nextLessonId) {
        const nextProgress = await this.upsertProgress(attempt.userId, lesson.nextLessonId);
        if (nextProgress.state === 'locked') {
          await this.progress.update(
            { id: nextProgress.id },
            { state: 'unlocked', unlockedAt: new Date() },
          );
        }
      }
    } else if (wasAlreadyCompleted) {
      progress.state = 'completed';
      await this.progress.save(progress);
<<<<<<< HEAD
    } else {
      progress.state = 'needs_retry';
      await this.progress.save(progress);
    }

    await this.updateMastery(attempt.userId, breakdown, taskType);
  }

  private async hasOtherPassedAttempt(userId: string, lessonId: string, excludeAttemptId: string) {
    const count = await this.attempts
      .createQueryBuilder('a')
      .where('a.user_id = :userId', { userId })
      .andWhere('a.lesson_id = :lessonId', { lessonId })
      .andWhere('a.id <> :excludeAttemptId', { excludeAttemptId })
      .andWhere('a.status = :status', { status: 'passed' })
      .getCount();
    return count > 0;
  }

  private async finalizedBestScoresByLesson(userId: string, lessonIds: string[]): Promise<Map<string, number>> {
    if (lessonIds.length === 0) return new Map();
    const rows = await this.attempts
      .createQueryBuilder('a')
      .select('a.lesson_id', 'lesson_id')
      .addSelect('MAX(COALESCE(a.final_score, a.score))', 'best_score')
      .where('a.user_id = :userId', { userId })
      .andWhere('a.lesson_id IN (:...lessonIds)', { lessonIds })
      .andWhere('a.finalized_at IS NOT NULL')
      .andWhere('(a.final_score IS NOT NULL OR a.score IS NOT NULL)')
      .groupBy('a.lesson_id')
      .getRawMany<{ lesson_id: string; best_score: string | number | null }>();
    return new Map(
      rows
        .filter((r) => r.best_score != null)
        .map((r) => [r.lesson_id, Number(r.best_score)]),
    );
  }

  private async finalizedBestScore(userId: string, lessonId: string): Promise<number | null> {
    return (await this.finalizedBestScoresByLesson(userId, [lessonId])).get(lessonId) ?? null;
  }

  private async bestFinalScoreExcludingAttempt(
    userId: string,
    lessonId: string,
    excludeAttemptId: string,
  ): Promise<number | null> {
    const row = await this.attempts
      .createQueryBuilder('a')
      .select('MAX(a.score)', 'best_score')
      .where('a.user_id = :userId', { userId })
      .andWhere('a.lesson_id = :lessonId', { lessonId })
      .andWhere('a.id <> :excludeAttemptId', { excludeAttemptId })
      .andWhere('a.finalized_at IS NOT NULL')
      .andWhere('a.score IS NOT NULL')
      .getRawOne<{ best_score: string | number | null }>();
    if (row?.best_score == null) return null;
    return Number(row.best_score);
  }

  /**
   * Option A policy: once a learner explicitly requests teacher review, the AI
   * result is put on hold. The teacher score becomes the final gate, so the
   * current lesson is no longer completed and the next lesson is locked again
   * unless another passed attempt already justifies the unlock.
   */
  private async putAttemptOnTeacherReviewHold(attempt: LessonAttempt, lesson: Lesson) {
    const hasOtherPass = await this.hasOtherPassedAttempt(attempt.userId, lesson.id, attempt.id);
    const bestOtherScore = await this.bestFinalScoreExcludingAttempt(attempt.userId, lesson.id, attempt.id);
    const reasons = new Set(
      (attempt.reviewReason ?? '')
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean),
    );
    reasons.add(ReviewReason.LEARNER_REQUESTED);

    attempt.status = 'under_review';
    attempt.scoringStatus = ScoringStatus.NEEDS_REVIEW;
    attempt.reviewRequired = true;
    attempt.reviewReason = Array.from(reasons).join(',');
    attempt.teacherReviewStatus = 'pending';
    attempt.nextAction = 'none';
    attempt.finalScore = null;
    attempt.finalScoreBreakdown = null;
    attempt.finalizedAt = null;
    attempt.score = null;
    await this.attempts.save(attempt);

    const progress = await this.upsertProgress(attempt.userId, lesson.id);
    progress.lastAttemptId = attempt.id;
    progress.bestScore = bestOtherScore;
    if (!hasOtherPass) {
      progress.state = 'under_review';
      progress.completedAt = null;
    }
    await this.progress.save(progress);

    if (!hasOtherPass && lesson.nextLessonId) {
      const nextProgress = await this.upsertProgress(attempt.userId, lesson.nextLessonId);
      const nextAlreadyPassed = await this.attempts
        .createQueryBuilder('a')
        .where('a.user_id = :userId', { userId: attempt.userId })
        .andWhere('a.lesson_id = :lessonId', { lessonId: lesson.nextLessonId })
        .andWhere('a.status = :status', { status: 'passed' })
        .getCount();
      if (nextAlreadyPassed === 0 && nextProgress.state !== 'locked' && nextProgress.state !== 'completed') {
        nextProgress.state = 'locked';
        nextProgress.unlockedAt = null;
        nextProgress.completedAt = null;
        await this.progress.save(nextProgress);
      }
    }
  }

  /**
   * Update per-skill mastery with a weighted moving average. Weight depends on
   * task type (level-final dominates). evidence_count accumulates the weight.
   */
  private async updateMastery(
    userId: string,
    breakdown: Record<string, number>,
    taskType: TaskType,
  ): Promise<void> {
    const weight = MASTERY_WEIGHT[taskType] ?? 1;
    for (const skill of ALL_SKILLS) {
      const skillScore = breakdown[skill];
      if (typeof skillScore !== 'number') continue;
      let row = await this.mastery.findOne({ where: { userId, skill } });
      if (!row) {
        row = this.mastery.create({ userId, skill, masteryScore: 0, evidenceCount: 0 });
      }
      const newEvidence = row.evidenceCount + weight;
      row.masteryScore =
        Math.round(((row.masteryScore * row.evidenceCount + skillScore * weight) / newEvidence) * 100) / 100;
      row.evidenceCount = newEvidence;
      await this.mastery.save(row);
    }
  }

  // ── Review tasks (human review workflow) ──────────────────────────────────

  /**
   * Open (or refresh) a review task for an attempt that needs a human. Sets
   * task_type, priority + due_at from SLA constants, and denormalizes student/
   * lesson/level/topic so the queue can order without joins. Idempotent.
   */
  private async createReviewTaskForSubmission(params: {
    attempt: LessonAttempt;
    lesson: Lesson;
    taskType: TaskType;
    reasons: string[];
    aiScore: number;
    aiBreakdown: Record<string, number>;
  }): Promise<TeacherReview> {
    const { attempt, lesson, taskType, reasons, aiScore, aiBreakdown } = params;
    const slaHours =
      taskType === TaskType.LEVEL_FINAL ? SLA_HOURS[TaskType.LEVEL_FINAL] : SLA_HOURS[TaskType.CHECKPOINT];
    const dueAt = new Date(Date.now() + slaHours * 3600 * 1000);
    const priority = TASK_PRIORITY[taskType] ?? 0;

    let review = await this.reviews.findOne({
      where: { lessonAttemptId: attempt.id, status: 'pending' },
    });
    if (!review) {
      review = this.reviews.create({ lessonAttemptId: attempt.id, status: 'pending' });
    }
    review.taskStatus = ReviewTaskStatus.PENDING;
    review.taskType = taskType;
    review.priority = priority;
    review.dueAt = dueAt;
    review.reviewReason = reasons.join(',');
    review.studentId = attempt.userId;
    review.lessonId = lesson.id;
    review.level = lesson.level;
    review.topic = lesson.topic;
    review.aiScoreSnapshot = { ai_score: aiScore, breakdown: aiBreakdown };
    return this.reviews.save(review);
  }

  /**
   * The single task this rater is allowed to work on next: the top of the queue
   * across pending+unassigned tasks and tasks already assigned to them. Ordered
   * priority DESC, level_final first, soonest due, oldest.
   * TODO: no rater workload/capability data yet — not load-balanced.
   */
  private async topReviewTaskRow(raterId: string): Promise<TeacherReview | null> {
    const rows = await this.reviews.find({
      where: [
        { taskStatus: ReviewTaskStatus.PENDING, assignedTo: null as any },
        { taskStatus: ReviewTaskStatus.ASSIGNED, assignedTo: raterId },
      ],
    });
    if (rows.length === 0) return null;
    rows.sort((a, b) =>
      compareReviewTasks(
        { priority: a.priority, taskType: this.normalizeTaskType(a.taskType), dueAt: a.dueAt, createdAt: a.createdAt },
        { priority: b.priority, taskType: this.normalizeTaskType(b.taskType), dueAt: b.dueAt, createdAt: b.createdAt },
      ),
    );
    return rows[0];
  }

  async getNextReviewTask(raterId: string) {
    const top = await this.topReviewTaskRow(raterId);
    if (!top) return { task: null };
    const view = this.toReviewTaskView(top);
    // Attach the saved user-turn audio (metadata only — playback uses signed
    // URLs fetched per turn from /turn-audio/:id/play-url).
    const attempt = top.lessonAttemptId
      ? await this.attempts.findOne({ where: { id: top.lessonAttemptId } })
      : null;
    const audioTurns = await this.turnAudio.getAudioTurnsForAttempt(
      top.lessonAttemptId,
      attempt?.sessionId ?? null,
    );
    return { task: { ...view, audio_turns: audioTurns } };
  }

  /**
   * Learner manually sends a completed terminal attempt to teacher review (any
   * auto-finalized practice/checkpoint included). Idempotent: returns the open
   * task if one already exists. The AI result is put on hold; teacher score
   * becomes the final gate and the next lesson is locked until review completes.
   */
  async requestTeacherReview(userId: string, attemptId: string) {
    const attempt = await this.attempts.findOne({ where: { id: attemptId, userId } });
    if (!attempt) throw new NotFoundException('Lesson attempt not found');
    const reviewableTerminal =
      !!attempt.completedAt &&
      attempt.status !== 'in_progress' &&
      attempt.status !== 'abandoned';
    if (!reviewableTerminal) {
      throw new ConflictException({
        error: 'ATTEMPT_NOT_COMPLETED',
        message: 'Finish the lesson attempt before requesting teacher review',
      });
    }
    const lesson = await this.lessons.findOne({ where: { id: attempt.lessonId } });
    if (!lesson) throw new NotFoundException('Lesson not found');

    const open = await this.reviews.findOne({
      where: {
        lessonAttemptId: attemptId,
        taskStatus: In([
          ReviewTaskStatus.PENDING,
          ReviewTaskStatus.ASSIGNED,
          ReviewTaskStatus.ESCALATED,
        ]),
      },
    });
    if (open) {
      await this.putAttemptOnTeacherReviewHold(attempt, lesson);
      return {
        review_id: open.id,
        status: 'already_open',
        task_status: open.taskStatus,
        attempt_status: attempt.status,
        scoring_status: attempt.scoringStatus,
        node_status: this.deriveNodeStatus(attempt),
      };
    }

    const taskType = this.normalizeTaskType(lesson.taskType);
    const review = this.reviews.create({
      lessonAttemptId: attemptId,
      status: 'pending',
      taskStatus: ReviewTaskStatus.PENDING,
      taskType,
      priority: TASK_PRIORITY[taskType] ?? 0,
      dueAt: new Date(Date.now() + SLA_HOURS.dispute * 3600 * 1000),
      reviewReason: ReviewReason.LEARNER_REQUESTED,
      studentId: userId,
      lessonId: lesson.id,
      level: lesson.level,
      topic: lesson.topic,
      aiScoreSnapshot: { ai_score: attempt.aiScore, breakdown: attempt.aiScoreBreakdown },
    });
    await this.reviews.save(review);

    await this.putAttemptOnTeacherReviewHold(attempt, lesson);

    return {
      review_id: review.id,
      status: 'created',
      task_status: review.taskStatus,
      attempt_status: attempt.status,
      scoring_status: attempt.scoringStatus,
      node_status: this.deriveNodeStatus(attempt),
    };
  }

  /**
   * Claim a task. Reviewers can't cherry-pick: the only task assignable is the
   * one getNextReviewTask would hand out (top of the queue). Re-claiming a task
   * already assigned to this rater is idempotent.
   */
  async assignReviewTask(taskId: string, raterId: string) {
    const review = await this.reviews.findOne({ where: { id: taskId } });
    if (!review) throw new NotFoundException('Review task not found');
    if (review.taskStatus === ReviewTaskStatus.COMPLETED || review.taskStatus === ReviewTaskStatus.CANCELLED) {
      throw new ForbiddenException('Review task is already closed');
    }
    if (review.assignedTo && review.assignedTo !== raterId) {
      throw new ForbiddenException('Review task is assigned to another reviewer');
    }

    // Already mine → idempotent.
    if (review.assignedTo !== raterId) {
      // Otherwise it must be the current top-priority task for this rater, so a
      // teacher can't claim an arbitrary unassigned id pulled from the queue.
      const top = await this.topReviewTaskRow(raterId);
      if (!top || top.id !== review.id) {
        throw new ForbiddenException('Claim the next assigned review task instead of choosing one');
      }
    }

    review.assignedTo = raterId;
    review.taskStatus = ReviewTaskStatus.ASSIGNED;
    await this.reviews.save(review);
    return this.toReviewTaskView(review);
  }

  /**
   * A reviewer submits a human score. Canonical finalization path for reviewed
   * attempts: requires the task to be ASSIGNED to this rater, requires a real
   * human score (no AI fallback), then finalizes + runs progression + mastery.
   */
  async submitHumanReview(
    taskId: string,
    raterId: string,
    payload: {
      scoreBreakdown?: Partial<Record<string, number>>;
      finalScore?: number;
      decision?: TeacherReviewStatus;
      note?: string | null;
    },
  ) {
    const review = await this.reviews.findOne({ where: { id: taskId } });
    if (!review) throw new NotFoundException('Review task not found');
    if (review.taskStatus === ReviewTaskStatus.COMPLETED) {
      throw new ForbiddenException('Review task already completed');
    }
    // Reviewers don't pick arbitrary work: a task must be assigned to *this*
    // rater before it can be submitted (assign via getNextReviewTask → assign).
    if (review.taskStatus !== ReviewTaskStatus.ASSIGNED || review.assignedTo !== raterId) {
      throw new ForbiddenException('Assign this review task to yourself before submitting');
    }

    const attempt = await this.attempts.findOne({ where: { id: review.lessonAttemptId } });
    if (!attempt) throw new NotFoundException('Lesson attempt not found');
    const lesson = await this.lessons.findOne({ where: { id: attempt.lessonId } });
    if (!lesson) throw new NotFoundException('Lesson not found');

    // Human score is mandatory (final_score or at least one skill). Never fall
    // back to the AI score — that would let "approve" turn AI into the final.
    const providedSkills = ALL_SKILLS.filter((s) => typeof payload.scoreBreakdown?.[s] === 'number');
    let total: number | null = null;
    if (typeof payload.finalScore === 'number') {
      total = payload.finalScore;
    } else if (providedSkills.length > 0) {
      const vals = providedSkills.map((s) => payload.scoreBreakdown![s] as number);
      total = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }

    const decision: TeacherReviewStatus =
      payload.decision ?? (total !== null && total >= lesson.passScore ? 'approved' : 'revised');

    // Approve/revise must carry a human score; reject may stand alone (= redo).
    if (decision !== 'rejected' && total === null) {
      throw new HttpException(
        { error: 'HUMAN_SCORE_REQUIRED', message: 'Provide final_score or score_breakdown to approve/revise' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Build a fully human-derived breakdown: any skill the reviewer didn't score
    // falls back to the human total (NOT the AI score), so mastery + path are
    // never influenced by AI once a human grades. For 'rejected' with no score,
    // the breakdown stays empty (no mastery, no pass).
    const humanBreakdown: Record<string, number> = {};
    if (total !== null) {
      for (const s of ALL_SKILLS) {
        humanBreakdown[s] = typeof payload.scoreBreakdown?.[s] === 'number'
          ? (payload.scoreBreakdown[s] as number)
          : total;
      }
      humanBreakdown.total = total;
    } else {
      for (const s of providedSkills) humanBreakdown[s] = payload.scoreBreakdown![s] as number;
    }

    const taskType = this.normalizeTaskType(lesson.taskType);

    // Review task row.
    review.reviewerId = raterId;
    review.status = decision;
    review.taskStatus = ReviewTaskStatus.COMPLETED;
    review.humanScore = total;
    review.humanScoreBreakdown = humanBreakdown;
    review.finalScore = total;
    if (payload.note !== undefined) review.comment = payload.note;
    review.reviewedAt = new Date();
    review.completedAt = new Date();
    await this.reviews.save(review);

    // Finalize the attempt from the human score. Reject → retry; otherwise grade
    // with the SAME score/mastery rule as the AI path (no last-card gate).
    let outcome: LessonOutcome;
    if (decision === 'rejected') {
      outcome = { status: 'needs_retry', unlock: false, blockReason: 'below_pass_score' };
    } else {
      // Path decision uses the human breakdown only.
      outcome = computeLessonOutcome({
        finalScore: total as number,
        passScore: lesson.passScore,
        breakdown: humanBreakdown,
      });
    }

    attempt.finalScore = total;
    attempt.finalScoreBreakdown = total !== null ? humanBreakdown : null;
    attempt.scoringStatus = ScoringStatus.FINALIZED;
    attempt.finalizedAt = new Date();
    attempt.reviewRequired = false;
    attempt.status = outcome.status;
    attempt.nextAction = this.lessonNextAction(outcome, lesson);
    attempt.teacherReviewStatus = decision;
    attempt.score = total;
    await this.attempts.save(attempt);

    await this.applyProgressionAndMastery({
      attempt,
      lesson,
      finalScore: total ?? 0,
      // Mastery uses human-scored skills only — AI never pollutes mastery here.
      breakdown: humanBreakdown,
      taskType,
      outcome,
      recomputeBestScore: true,
    });

    return {
      review_id: review.id,
      task_status: review.taskStatus,
      decision,
      final_score: total,
      attempt_status: attempt.status,
      scoring_status: attempt.scoringStatus,
    };
  }

  async escalateReviewTask(taskId: string, reason: string) {
    const review = await this.reviews.findOne({ where: { id: taskId } });
    if (!review) throw new NotFoundException('Review task not found');
    if (review.taskStatus === ReviewTaskStatus.COMPLETED || review.taskStatus === ReviewTaskStatus.CANCELLED) {
      throw new ForbiddenException('Review task is already closed');
    }
    review.taskStatus = ReviewTaskStatus.ESCALATED;
    review.priority = (review.priority ?? 0) + 10;
    review.reviewReason = [review.reviewReason, `escalated:${reason}`].filter(Boolean).join(',');
    await this.reviews.save(review);
    return this.toReviewTaskView(review);
  }

  private toReviewTaskView(r: TeacherReview) {
    return {
      review_id: r.id,
      lesson_attempt_id: r.lessonAttemptId,
      task_status: r.taskStatus,
      task_type: r.taskType,
      priority: r.priority,
      due_at: r.dueAt,
      review_reason: r.reviewReason,
      assigned_to: r.assignedTo,
      student_id: r.studentId,
      lesson_id: r.lessonId,
      level: r.level,
      topic: r.topic,
      ai_score_snapshot: r.aiScoreSnapshot,
      created_at: r.createdAt,
    };
  }

  // ── Teacher feedback + dashboard analytics ────────────────────────────────

  private teacherPublic(u: User | null | undefined) {
    return u ? { id: u.id, name: u.name, email: u.email, role: u.role } : null;
  }

  private periodStart(period?: string): Date | null {
    const now = new Date();
    if (period === 'day') {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
    if (period === 'year') return new Date(now.getFullYear(), 0, 1);
    return null; // 'all' / undefined → no lower bound
  }

  /**
   * Learner rates/feedbacks a COMPLETED teacher review. Upsert by
   * (teacher_review_id, student_id) — one feedback per review per student, but
   * updatable. Validates ownership + completion; never lets a teacher rate self.
   */
  async submitReviewFeedback(
    studentId: string,
    reviewId: string,
    payload: { rating: number; comment?: string | null },
  ) {
    const review = await this.reviews.findOne({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');

    const attempt = await this.attempts.findOne({ where: { id: review.lessonAttemptId } });
    if (!attempt) throw new NotFoundException('Lesson attempt not found');

    // Only the learner who owns the attempt can rate its review.
    if (attempt.userId !== studentId) {
      throw new ForbiddenException('You can only rate your own review');
    }
    if (review.taskStatus !== ReviewTaskStatus.COMPLETED) {
      throw new ConflictException({
        error: 'REVIEW_NOT_COMPLETED',
        message: 'You can only rate a completed teacher review',
      });
    }
    if (!review.reviewerId) {
      throw new ConflictException({
        error: 'REVIEW_HAS_NO_REVIEWER',
        message: 'This review has no reviewer to rate',
      });
    }
    // A teacher reviewing should never rate their own work.
    if (review.reviewerId === studentId) {
      throw new ForbiddenException('You cannot rate your own review');
    }

    const comment = payload.comment?.trim() || null;
    let feedback = await this.reviewFeedback.findOne({
      where: { teacherReviewId: reviewId, studentId },
    });
    if (feedback) {
      feedback.rating = payload.rating;
      feedback.comment = comment;
    } else {
      feedback = this.reviewFeedback.create({
        teacherReviewId: reviewId,
        lessonAttemptId: review.lessonAttemptId,
        studentId,
        teacherId: review.reviewerId,
        rating: payload.rating,
        comment,
      });
    }
    await this.reviewFeedback.save(feedback);
    return {
      review_id: reviewId,
      rating: feedback.rating,
      comment: feedback.comment,
      created_at: feedback.createdAt,
      updated_at: feedback.updatedAt,
    };
  }

  /** average_rating + rating_count per teacher, for admin teacher rows. */
  async teacherRatingAggregates(teacherIds: string[]) {
    const ids = Array.from(new Set(teacherIds.filter(Boolean)));
    const map = new Map<string, { average_rating: number; rating_count: number }>();
    if (!ids.length) return map;
    const rows = await this.reviewFeedback
      .createQueryBuilder('f')
      .select('f.teacher_id', 'teacher_id')
      .addSelect('COALESCE(AVG(f.rating), 0)', 'avg')
      .addSelect('COUNT(*)', 'count')
      .where('f.teacher_id IN (:...ids)', { ids })
      .groupBy('f.teacher_id')
      .getRawMany();
    for (const r of rows) {
      map.set(r.teacher_id, {
        average_rating: Math.round(Number(r.avg) * 100) / 100,
        rating_count: Number(r.count) || 0,
      });
    }
    return map;
  }

  /** completed-review counts (today/month/year) per teacher, for admin rows. */
  async teacherCompletedCounts(teacherIds: string[]) {
    const ids = Array.from(new Set(teacherIds.filter(Boolean)));
    const map = new Map<
      string,
      { completed_today: number; completed_this_month: number; completed_this_year: number }
    >();
    if (!ids.length) return map;
    const rows = await this.reviews
      .createQueryBuilder('r')
      .select('r.reviewer_id', 'teacher_id')
      .addSelect(
        "COUNT(*) FILTER (WHERE r.completed_at >= date_trunc('day', NOW()))",
        'today',
      )
      .addSelect(
        "COUNT(*) FILTER (WHERE r.completed_at >= date_trunc('month', NOW()))",
        'month',
      )
      .addSelect(
        "COUNT(*) FILTER (WHERE r.completed_at >= date_trunc('year', NOW()))",
        'year',
      )
      .where('r.reviewer_id IN (:...ids)', { ids })
      .andWhere("r.task_status = 'completed'")
      .groupBy('r.reviewer_id')
      .getRawMany();
    for (const r of rows) {
      map.set(r.teacher_id, {
        completed_today: Number(r.today) || 0,
        completed_this_month: Number(r.month) || 0,
        completed_this_year: Number(r.year) || 0,
      });
    }
    return map;
  }

  /** Completed-review history for a teacher, with student/lesson/rating joined. */
  async getTeacherReviewHistory(
    teacherId: string,
    opts: { period?: string; page?: number; limit?: number } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
    const page = Math.max(opts.page ?? 1, 1);
    const since = this.periodStart(opts.period);

    const qb = this.reviews
      .createQueryBuilder('r')
      .where('r.reviewer_id = :teacherId', { teacherId })
      .andWhere("r.task_status = 'completed'");
    if (since) qb.andWhere('r.completed_at >= :since', { since });
    const total = await qb.getCount();
    const rows = await qb
      .orderBy('r.completed_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const attemptIds = rows.map((r) => r.lessonAttemptId);
    const attempts = attemptIds.length
      ? await this.attempts.find({ where: { id: In(attemptIds) } })
      : [];
    const attemptById = new Map(attempts.map((a) => [a.id, a]));
    const lessonIds = [
      ...new Set([
        ...attempts.map((a) => a.lessonId),
        ...(rows.map((r) => r.lessonId).filter(Boolean) as string[]),
      ]),
    ];
    const lessons = lessonIds.length
      ? await this.lessons.find({ where: { id: In(lessonIds) } })
      : [];
    const lessonById = new Map(lessons.map((l) => [l.id, l]));
    const studentIds = [
      ...new Set(
        rows
          .map((r) => attemptById.get(r.lessonAttemptId)?.userId ?? r.studentId)
          .filter(Boolean) as string[],
      ),
    ];
    const students = studentIds.length
      ? await this.users.find({ where: { id: In(studentIds) } })
      : [];
    const studentById = new Map(students.map((u) => [u.id, u]));
    const feedbackRows = rows.length
      ? await this.reviewFeedback.find({ where: { teacherReviewId: In(rows.map((r) => r.id)) } })
      : [];
    const feedbackByReview = new Map(feedbackRows.map((f) => [f.teacherReviewId, f]));

    return {
      total,
      page,
      limit,
      items: rows.map((r) => {
        const attempt = attemptById.get(r.lessonAttemptId);
        const lesson =
          (r.lessonId && lessonById.get(r.lessonId)) ||
          (attempt && lessonById.get(attempt.lessonId)) ||
          null;
        const student = studentById.get(attempt?.userId ?? r.studentId ?? '');
        const fb = feedbackByReview.get(r.id);
        return {
          review_id: r.id,
          lesson_attempt_id: r.lessonAttemptId,
          completed_at: r.completedAt,
          reviewed_at: r.reviewedAt,
          task_type: r.taskType,
          decision: r.status,
          final_score: r.finalScore ?? r.humanScore ?? null,
          human_score: r.humanScore ?? null,
          note: r.comment ?? null,
          student: student
            ? { id: student.id, name: student.name, email: student.email }
            : null,
          lesson: lesson
            ? { id: lesson.id, title: lesson.title, level: lesson.level, topic: lesson.topic }
            : null,
          rating: fb?.rating ?? null,
          rating_comment: fb?.comment ?? null,
        };
      }),
    };
  }

  /** Student feedback received by a teacher, newest first. */
  async getTeacherFeedback(
    teacherId: string,
    opts: { period?: string; page?: number; limit?: number } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
    const page = Math.max(opts.page ?? 1, 1);
    const since = this.periodStart(opts.period);

    const qb = this.reviewFeedback
      .createQueryBuilder('f')
      .where('f.teacher_id = :teacherId', { teacherId });
    if (since) qb.andWhere('f.created_at >= :since', { since });
    const total = await qb.getCount();
    const rows = await qb
      .orderBy('f.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const attemptIds = [...new Set(rows.map((f) => f.lessonAttemptId))];
    const attempts = attemptIds.length
      ? await this.attempts.find({ where: { id: In(attemptIds) } })
      : [];
    const attemptById = new Map(attempts.map((a) => [a.id, a]));
    const lessonIds = [...new Set(attempts.map((a) => a.lessonId))];
    const lessons = lessonIds.length
      ? await this.lessons.find({ where: { id: In(lessonIds) } })
      : [];
    const lessonById = new Map(lessons.map((l) => [l.id, l]));
    const studentIds = [...new Set(rows.map((f) => f.studentId))];
    const students = studentIds.length
      ? await this.users.find({ where: { id: In(studentIds) } })
      : [];
    const studentById = new Map(students.map((u) => [u.id, u]));

    return {
      total,
      page,
      limit,
      items: rows.map((f) => {
        const attempt = attemptById.get(f.lessonAttemptId);
        const lesson = attempt ? lessonById.get(attempt.lessonId) : null;
        const student = studentById.get(f.studentId);
        return {
          review_id: f.teacherReviewId,
          rating: f.rating,
          comment: f.comment,
          created_at: f.createdAt,
          updated_at: f.updatedAt,
          student: student
            ? { id: student.id, name: student.name, email: student.email }
            : null,
          lesson: lesson
            ? { id: lesson.id, title: lesson.title, level: lesson.level, topic: lesson.topic }
            : null,
        };
      }),
    };
  }

  /** Daily/monthly/yearly completed counts + rating distribution for a teacher. */
  async getTeacherStats(teacherId: string) {
    const dayWindow = new Date();
    dayWindow.setDate(dayWindow.getDate() - 13);
    dayWindow.setHours(0, 0, 0, 0);
    const monthWindow = new Date();
    monthWindow.setMonth(monthWindow.getMonth() - 11);
    const monthStart = new Date(monthWindow.getFullYear(), monthWindow.getMonth(), 1);

    const bucket = (fmt: string, since: Date) =>
      this.reviews
        .createQueryBuilder('r')
        .select(`to_char(r.completed_at, '${fmt}')`, 'bucket')
        .addSelect('COUNT(*)', 'count')
        .where('r.reviewer_id = :teacherId', { teacherId })
        .andWhere("r.task_status = 'completed'")
        .andWhere('r.completed_at IS NOT NULL')
        .andWhere('r.completed_at >= :since', { since })
        .groupBy('bucket')
        .orderBy('bucket', 'ASC')
        .getRawMany();

    const [daily, monthly, yearly, ratingAgg, distRows] = await Promise.all([
      bucket('YYYY-MM-DD', dayWindow),
      bucket('YYYY-MM', monthStart),
      this.reviews
        .createQueryBuilder('r')
        .select("to_char(r.completed_at, 'YYYY')", 'bucket')
        .addSelect('COUNT(*)', 'count')
        .where('r.reviewer_id = :teacherId', { teacherId })
        .andWhere("r.task_status = 'completed'")
        .andWhere('r.completed_at IS NOT NULL')
        .groupBy('bucket')
        .orderBy('bucket', 'ASC')
        .getRawMany(),
      this.reviewFeedback
        .createQueryBuilder('f')
        .select('COALESCE(AVG(f.rating), 0)', 'avg')
        .addSelect('COUNT(*)', 'count')
        .where('f.teacher_id = :teacherId', { teacherId })
        .getRawOne(),
      this.reviewFeedback
        .createQueryBuilder('f')
        .select('f.rating', 'rating')
        .addSelect('COUNT(*)', 'count')
        .where('f.teacher_id = :teacherId', { teacherId })
        .groupBy('f.rating')
        .getRawMany(),
    ]);

    const rating_distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const row of distRows) {
      const key = String(row.rating);
      if (key in rating_distribution) rating_distribution[key] = Number(row.count) || 0;
    }
    const toSeries = (rows: any[]) =>
      rows.map((r) => ({ bucket: r.bucket as string, count: Number(r.count) || 0 }));

    return {
      daily: toSeries(daily),
      monthly: toSeries(monthly),
      yearly: toSeries(yearly),
      average_rating: Math.round(Number(ratingAgg?.avg ?? 0) * 100) / 100,
      rating_count: Number(ratingAgg?.count ?? 0) || 0,
      rating_distribution,
    };
  }

  /** Queue summary counts for one teacher (assigned/overdue/completed buckets). */
  private async teacherQueueSummary(teacherId: string) {
    const now = new Date();
    const [assignedOpen, pendingAvailable, overdue, completedCounts] = await Promise.all([
      this.reviews.count({
        where: {
          assignedTo: teacherId,
          taskStatus: In([
            ReviewTaskStatus.ASSIGNED,
            ReviewTaskStatus.ESCALATED,
          ]),
        },
      }),
      this.reviews.count({
        where: { taskStatus: ReviewTaskStatus.PENDING, assignedTo: null as any },
      }),
      this.reviews
        .createQueryBuilder('r')
        .where('r.assigned_to = :teacherId', { teacherId })
        .andWhere('r.task_status IN (:...statuses)', {
          statuses: [ReviewTaskStatus.ASSIGNED, ReviewTaskStatus.ESCALATED],
        })
        .andWhere('r.due_at IS NOT NULL AND r.due_at < :now', { now })
        .getCount(),
      this.teacherCompletedCounts([teacherId]),
    ]);
    const counts = completedCounts.get(teacherId) ?? {
      completed_today: 0,
      completed_this_month: 0,
      completed_this_year: 0,
    };
    return {
      assigned_open: assignedOpen,
      pending_available: pendingAvailable,
      overdue,
      ...counts,
    };
  }

  /**
   * Teacher dashboard: profile + queue summary + stats + recent history +
   * recent feedback. Used by the teacher (own id) and by admin (any teacher id).
   */
  async getTeacherDashboard(teacherId: string) {
    const user = await this.users.findOne({ where: { id: teacherId } });
    if (!user) throw new NotFoundException('Teacher not found');
    // Reviewers only — an admin passing a student id (?teacher_id) gets 400, not
    // a student's profile with empty review stats.
    if (![UserRole.TEACHER, UserRole.ADMIN].includes(user.role as UserRole)) {
      throw new BadRequestException('User is not a teacher or admin');
    }

    const [queue, stats, history, feedback] = await Promise.all([
      this.teacherQueueSummary(teacherId),
      this.getTeacherStats(teacherId),
      this.getTeacherReviewHistory(teacherId, { limit: 10 }),
      this.getTeacherFeedback(teacherId, { limit: 10 }),
    ]);

    return {
      teacher: this.teacherPublic(user),
      queue,
      stats,
      recent_history: history.items,
      recent_feedback: feedback.items,
=======
    } else if (status === 'failed' || status === 'needs_retry') {
      progress.state = 'needs_retry';
      await this.progress.save(progress);
    } else if (status === 'abandoned') {
      progress.state = 'in_progress';
      await this.progress.save(progress);
    } else {
      await this.progress.save(progress);
    }

    return {
      status,
      score: finalScore,
      next_action: nextAction,
      teacher_review_status: teacherReviewStatus,
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private previewTask(template: string): string {
    if (!template) return '';
    return template.length > 160 ? template.slice(0, 157) + '…' : template;
  }

  /** Public helper, also used by tests / debug. */
  normalizeLearningGoal(goal?: string | null): LearningGoalNormalized {
    const g = (goal ?? '').toLowerCase().trim();
    if (
      g === 'career' ||
      g === 'travel' ||
      g === 'education' ||
      g === 'connect' ||
      g === 'fun'
    ) {
      return g;
    }
    return 'general';
  }

  private async getUserLearningGoal(userId: string): Promise<LearningGoalNormalized> {
    try {
      const user = await this.users.findOne({ where: { id: userId } });
      return this.normalizeLearningGoal(user?.learningGoal);
    } catch {
      return 'general';
    }
  }

  /**
   * Prefix a card task template with a short, **context-neutral** flavor line
   * drawn from the user's learning goal. The prefix sets a mood for the
   * speaker (e.g. "imagine you're talking with someone new") without
   * overriding the lesson's own roleplay setup, so we don't get nonsense like
   * "team meeting + barista" when career meets the order-food lesson.
   *
   * Only scenario-heavy card types get the prefix; vocabulary_in_context gets
   * a very small tag; everything else returns verbatim. Success criteria,
   * scoring, titles, and objectives are never touched.
   */
  personalizeTaskForGoal(
    task: string,
    cardType: string,
    _lessonTitle: string,
    goal: LearningGoalNormalized,
  ): string {
    if (!task) return task;
    if (goal === 'general') return task;

    // Neutral flavor lines: they hint at the user's motivation without
    // contradicting whatever scenario the lesson card already sets up.
    const flavors: Record<Exclude<LearningGoalNormalized, 'general'>, string> = {
      career: 'Professional context: Imagine this happens during a workday.',
      travel: 'Travel context: Imagine you are using this while away from home.',
      education: 'Study context: Imagine this comes up around class or practice.',
      connect: 'Social context: Imagine you are talking with someone new.',
      fun: 'Casual context: Keep it relaxed and natural.',
    };

    // Vocabulary cards get just a tag — short enough to stay readable next to
    // word-drill instructions.
    const lightTags: Record<Exclude<LearningGoalNormalized, 'general'>, string> = {
      career: 'Work flavor:',
      travel: 'Travel flavor:',
      education: 'Study flavor:',
      connect: 'Social flavor:',
      fun: 'Casual flavor:',
    };

    if (PERSONALIZABLE_CARD_TYPES.has(cardType)) {
      return `${flavors[goal]} ${task}`;
    }
    if (LIGHT_PERSONALIZE_CARD_TYPES.has(cardType)) {
      return `${lightTags[goal]} ${task}`;
    }
    return task;
  }

  /**
   * A lesson is initially unlocked only if no other published lesson points
   * to it via next_lesson_id (i.e. it's a path entrypoint). Tie-break: among
   * multiple entrypoints, only the globally first one (by level/topic/order)
   * is unlocked — later "orphans" stay locked. This enforces a single linear
   * demo path even though the schema would allow multiple roots.
   */
  private async computeInitialUnlockSet(): Promise<Set<string>> {
    const all = await this.lessons.find({
      where: { isPublished: true },
      order: { level: 'ASC', topic: 'ASC', orderIndex: 'ASC' },
    });
    if (all.length === 0) return new Set();
    const pointedTo = new Set<string>();
    for (const l of all) {
      if (l.nextLessonId) pointedTo.add(l.nextLessonId);
    }
    const entrypoints = all.filter((l) => !pointedTo.has(l.id));
    if (entrypoints.length === 0) {
      // Cycle or no published lessons reachable — fall back to the global first.
      return new Set([all[0].id]);
    }
    // Only the first entrypoint (in global order) is initially unlocked.
    return new Set([entrypoints[0].id]);
  }

  private async ensureInitialUnlock(
    userId: string,
    allLessons: Lesson[],
    progressByLesson: Map<string, UserLessonProgress>,
  ): Promise<void> {
    if (allLessons.length === 0) return;
    const initiallyUnlocked = await this.computeInitialUnlockSet();
    const missing = allLessons.filter((l) => !progressByLesson.has(l.id));
    if (missing.length === 0) return;

    const rows = missing.map((l) =>
      this.progress.create({
        userId,
        lessonId: l.id,
        state: initiallyUnlocked.has(l.id) ? 'unlocked' : 'locked',
        unlockedAt: initiallyUnlocked.has(l.id) ? new Date() : null,
      }),
    );
    await this.progress.save(rows);
    rows.forEach((r) => progressByLesson.set(r.lessonId, r));
  }

  private async upsertProgress(userId: string, lessonId: string): Promise<UserLessonProgress> {
    let progress = await this.progress.findOne({ where: { userId, lessonId } });
    if (!progress) {
      // First time the user touches this lesson — unlock only if it's a
      // global entrypoint (no published predecessor links to it). Otherwise
      // it stays locked and start() will refuse.
      const initiallyUnlocked = await this.computeInitialUnlockSet();
      const initialState: LessonProgressState = initiallyUnlocked.has(lessonId)
        ? 'unlocked'
        : 'locked';
      progress = this.progress.create({
        userId,
        lessonId,
        state: initialState,
        unlockedAt: initialState === 'unlocked' ? new Date() : null,
      });
      await this.progress.save(progress);
    }
    return progress;
  }

  private buildRuntimeDeck(
    lesson: Lesson,
    lessonCards: LessonCard[],
    sessionId: string,
    attemptId: string,
    goal: LearningGoalNormalized,
  ): RuntimeDeck {
    const cards: RuntimeCard[] = lessonCards.map((lc, i) => ({
      id: `card-${i + 1}`,
      type: lc.type,
      title: lc.title,
      task: this.personalizeTaskForGoal(lc.taskTemplate, lc.type, lesson.title, goal),
      success_criteria: Array.isArray(lc.successCriteria) ? lc.successCriteria : [],
      expected_duration_seconds: lc.expectedDurationSeconds,
      retry_allowed: lc.retryAllowed,
      status: 'not_started',
      attempts: 0,
      result: null,
      feedback: null,
      ui_hint: null,
      lesson_card_id: lc.id,
    }));

    return {
      id: `deck-${sessionId}`,
      session_id: sessionId,
      session_type: 'lesson_runtime',
      lesson_id: lesson.id,
      lesson_attempt_id: attemptId,
      lesson_title: lesson.title,
      pass_score: lesson.passScore,
      mission: lesson.objective,
      mission_source: 'lesson',
      reason: `Lesson: ${lesson.title}`,
      status: 'not_started',
      current_card_index: 0,
      cards,
      end_reason: null,
      is_continuation: false,
    };
  }

  private async persistDeck(sessionId: string, deck: RuntimeDeck): Promise<void> {
    const memoryUrl = this.cfg.get<string>('MEMORY_SERVICE_URL');
    await firstValueFrom(
      this.http.post(`${memoryUrl}/exercise-deck/${sessionId}`, deck),
    );
  }

  private scoreCard(input: CardScoreInput): {
    status: 'not_started' | 'completed' | 'skipped';
    result: 'passed' | 'failed' | null;
    attempts: number;
    score: number;
  } {
    const attempts = Math.max(0, input.attempts ?? 0);
    if (input.status === 'completed') {
      const passed = input.result === 'passed';
      const baseScore = passed ? 100 : 45;
      const penalty = Math.max(0, attempts - 1) * 5;
      return {
        status: 'completed',
        result: passed ? 'passed' : 'failed',
        attempts,
        score: Math.max(0, baseScore - penalty),
      };
    }
    if (input.status === 'skipped') {
      return { status: 'skipped', result: null, attempts, score: 0 };
    }
    if (attempts > 0) {
      // Attempted but never marked completed → treat as failed attempt.
      const penalty = Math.max(0, attempts - 1) * 5;
      return { status: 'completed', result: 'failed', attempts, score: Math.max(0, 45 - penalty) };
    }
    return { status: 'not_started', result: null, attempts: 0, score: 0 };
  }
}
