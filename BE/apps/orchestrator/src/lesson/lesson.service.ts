import { Injectable, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
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
import { Session } from '../session/entities/session.entity';
import { User } from '../user/entities/user.entity';

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
    @InjectRepository(Session) private sessions: Repository<Session>,
    @InjectRepository(User) private users: Repository<User>,
    private http: HttpService,
    private cfg: ConfigService,
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

    const items: Item[] = allLessons.map((l) => {
      const p = progressByLesson.get(l.id);
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
        state: p?.state ?? 'locked',
        best_score: p?.bestScore ?? null,
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

    // Recommended next: first unlocked-but-not-completed, then any in_progress.
    const recommended =
      items.find((i) => i.state === 'in_progress') ??
      items.find((i) => i.state === 'unlocked') ??
      items.find((i) => i.state === 'needs_retry') ??
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
        state: progress.state,
        best_score: progress.bestScore,
        last_attempt_id: progress.lastAttemptId,
      },
      in_progress_attempt_id: inProgressAttempt?.id ?? null,
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
    const review = await this.reviews.findOne({
      where: { lessonAttemptId: attemptId },
      order: { createdAt: 'DESC' },
    });

    const completed = cards.filter((c) => c.status === 'completed').length;

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
        return {
          review_id: r.id,
          lesson_attempt_id: r.lessonAttemptId,
          status: r.status,
          created_at: r.createdAt,
          user_id: a?.userId ?? null,
          score: a?.score ?? null,
          lesson: l
            ? { id: l.id, title: l.title, level: l.level, topic: l.topic, unit: l.unit }
            : null,
        };
      }),
    };
  }

  async updateTeacherReview(
    reviewId: string,
    reviewerId: string,
    update: { status?: TeacherReviewStatus; final_score?: number | null; comment?: string | null },
  ) {
    const review = await this.reviews.findOne({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');
    const status = update.status ?? review.status;
    review.status = status;
    review.reviewerId = reviewerId;
    if (typeof update.final_score === 'number') review.finalScore = update.final_score;
    if (update.comment !== undefined) review.comment = update.comment;
    if (status !== 'pending') review.reviewedAt = new Date();
    await this.reviews.save(review);

    await this.attempts.update({ id: review.lessonAttemptId }, { teacherReviewStatus: status });
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
      // Already finalized — return the persisted shape.
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

    const finalScore =
      cardScores.length > 0
        ? Math.round(cardScores.reduce((sum, c) => sum + c.score, 0) / cardScores.length)
        : 0;
    const lastCard = cardScores[cardScores.length - 1];
    const lastPassed = lastCard?.result === 'passed';

    const isAbandoned =
      params.sessionEndReason === 'idle_timeout' ||
      params.sessionEndReason === 'tab_close' ||
      params.deck?.status === 'abandoned' ||
      params.deck?.end_reason === 'idle_timeout';

    const completedAny = cardScores.some((c) => c.status === 'completed');

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
