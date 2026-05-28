import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, LessThan } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Session } from './entities/session.entity';
import { Turn } from '../turn/entities/turn.entity';
import { UserService } from '../user/user.service';
import { LessonService } from '../lesson/lesson.service';

/**
 * Translate the session-level end reason into the deck-level end_reason vocab
 * expected by ExerciseDeckService.mark_deck_ended. Kept as a free function so
 * it stays trivially testable and reusable from the controller too.
 */
function mapSessionReasonToDeckEnd(
  reason: 'user_clicked' | 'voice_intent' | 'idle_timeout' | 'tab_close' | 'orphan',
): string {
  switch (reason) {
    case 'user_clicked':  return 'user_clicked_end';
    case 'voice_intent':  return 'voice_end_intent';
    case 'idle_timeout':  return 'idle_timeout';
    case 'tab_close':     return 'idle_timeout';   // silent disappearance → abandoned
    case 'orphan':        return 'idle_timeout';
  }
}

@Injectable()
export class SessionService {
  private readonly toolboxCache = new Map<string, { expiresAt: number; value: any }>();
  private readonly toolboxCacheTtlMs = 1000 * 60 * 60 * 2;
  private readonly toolboxCacheVersion = 'toolbox-v4';

  constructor(
    @InjectRepository(Session) private repo: Repository<Session>,
    @InjectRepository(Turn) private turnRepo: Repository<Turn>,
    private http: HttpService,
    private cfg: ConfigService,
    private userService: UserService,
    // Circular: LessonService → SessionRepository (via TypeOrmModule.forFeature)
    // but does not depend on SessionService itself. The forwardRef is defensive —
    // it keeps Nest's DI happy if LessonModule later starts to depend on us.
    @Inject(forwardRef(() => LessonService)) private lessonService: LessonService,
  ) {}

  /**
   * Start of "today" in the user's own timezone, returned as a UTC instant so it
   * compares correctly against started_at. Server-local midnight is wrong for
   * non-UTC users: on a UTC server the day would only roll over at 07:00 in
   * Vietnam (UTC+7), so the daily session quota would reset hours late.
   */
  private startOfTodayInTz(timeZone: string): Date {
    const now = new Date();
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(now).map((p) => [p.type, p.value]),
    ) as Record<string, string>;
    const wallNowAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const tzOffsetMs = wallNowAsUtc - now.getTime();
    const wallMidnightAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, 0, 0, 0);
    return new Date(wallMidnightAsUtc - tzOffsetMs);
  }

  async countTodaySessions(userId: string): Promise<number> {
    const user = await this.userService.findById(userId).catch(() => null);
    const startOfToday = this.startOfTodayInTz(user?.timezone || 'Asia/Ho_Chi_Minh');
    return this.repo.count({ where: { userId, startedAt: MoreThanOrEqual(startOfToday) } });
  }

  async getQuota(userId: string) {
    // Demo build: quota is deliberately out of the core learning path.
    // Keep the endpoint shape so old FE callers can ask for first-session state,
    // but always allow session start.
    const sessionsUsed = await this.countTodaySessions(userId);
    return {
      is_unlimited: true,
      daily_session_limit: -1,
      session_token_limit: Number.MAX_SAFE_INTEGER,
      sessions_used: sessionsUsed,
      can_start: true,
      is_first_session: await this.isFirstSession(userId),
    };
  }

  /**
   * Returns true for pre-session onboarding greetings.
   * A single active orphan can happen on refresh before the user really speaks;
   * keep that as onboarding. Once the user has any persisted turn, it is a real
   * session even if token accounting stayed at 0.
   * Used by the greeting route BEFORE a session exists (no sessionId available).
   * Counts all sessions including orphaned/ended ones to stay deterministic.
   */
  async isFirstSession(userId: string): Promise<boolean> {
    const [total, completedOrAbandoned, onlySession] = await Promise.all([
      this.repo.count({ where: { userId } }),
      // Both 'ended' and 'abandoned' count as real past sessions
      this.repo.count({ where: [{ userId, status: 'ended' }, { userId, status: 'abandoned' }] }),
      this.repo.findOne({
        where: { userId },
        order: { startedAt: 'ASC' },
        select: ['id', 'status', 'totalTokens'],
      }),
    ]);
    const onlySessionHasTurns = onlySession
      ? (await this.turnRepo.count({ where: { sessionId: onlySession.id } })) > 0
      : false;
    return total === 0 || (
      total === 1
      && completedOrAbandoned === 0
      && !onlySessionHasTurns
    );
  }

  /**
   * Returns true when the given session is the user's first real session.
   * Preferred over isFirstSession when a sessionId is in hand (greeting tied to id,
   * turn routing) because it can ignore zero-turn refresh orphans.
   */
  async isOnboardingSession(userId: string, sessionId: string): Promise<boolean> {
    if (!sessionId) return false;
    const session = await this.repo.findOne({ where: { id: sessionId, userId } });
    if (!session) return false;
    const earlier = await this.repo.find({
      where: { userId, startedAt: LessThan(session.startedAt) },
      select: ['id', 'status', 'endReason'],
    });
    for (const prior of earlier) {
      const hasTurns = (await this.turnRepo.count({ where: { sessionId: prior.id } })) > 0;
      if (hasTurns || prior.status === 'ended' || (prior.status === 'abandoned' && prior.endReason !== 'orphan')) {
        return false;
      }
    }
    return true;
  }

  async getGreetingSessionMeta(userId: string, sessionId: string): Promise<Pick<Session, 'id' | 'mode' | 'lessonAttemptId' | 'title'> | null> {
    return this.repo.findOne({
      where: { id: sessionId, userId },
      select: ['id', 'mode', 'lessonAttemptId', 'title'],
    }).catch(() => null);
  }

  async start(userId: string, mode: 'guided_learning' | 'free_talk' = 'guided_learning') {
    const [sessionsBeforeStart, completedOrAbandonedBefore, onlySessionBeforeStart] = await Promise.all([
      this.repo.count({ where: { userId } }),
      this.repo.count({ where: [{ userId, status: 'ended' }, { userId, status: 'abandoned' }] }),
      this.repo.findOne({
        where: { userId },
        order: { startedAt: 'ASC' },
        select: ['id', 'status', 'totalTokens'],
      }),
    ]);
    const onlySessionBeforeStartHasTurns = onlySessionBeforeStart
      ? (await this.turnRepo.count({ where: { sessionId: onlySessionBeforeStart.id } })) > 0
      : false;

    // Close any orphaned active sessions (e.g. page refresh without clicking "New Chat").
    // Mark as 'abandoned' (not 'ended') since the user didn't consciously close them.
    // Still trigger consolidation so memory is not lost.
    const orphaned = await this.repo.find({ where: { userId, status: 'active' }, select: ['id'] });
    if (orphaned.length > 0) {
      console.log(`[Session] abandoning ${orphaned.length} orphaned session(s) for user ${userId}`);
      await this.repo.update(
        orphaned.map((s) => s.id),
        { status: 'abandoned', endedAt: new Date(), endReason: 'orphan' },
      );
      for (const s of orphaned) {
        this.triggerConsolidation(userId, s.id).catch(console.error);
      }
    }

    // First-session detection: preserve refresh/orphan behavior. If the only
    // prior row has no turns and no session has ever ended, this is still the
    // first real speaking session. A zero-token session with turns is real.
    const isFirstSession = sessionsBeforeStart === 0
      || (
        sessionsBeforeStart === 1
        && completedOrAbandonedBefore === 0
        && !onlySessionBeforeStartHasTurns
      );

    // Onboarding gate: the very first session MUST run guided onboarding so we
    // can build a user profile (level, weak areas, preferred topics). Free Talk
    // before any guided exposure leaves the AI guessing tone/level — bad UX.
    const effectiveMode: 'guided_learning' | 'free_talk' =
      isFirstSession ? 'guided_learning' : mode;
    if (isFirstSession && mode === 'free_talk') {
      console.log(`[Session] user=${userId} requested free_talk on first session → forcing guided_learning for onboarding`);
    }

    const session = this.repo.create({ userId, status: 'active', mode: effectiveMode });
    await this.repo.save(session);

    // Curriculum-first: legacy /session/start no longer auto-builds a deck.
    // Lesson decks come from POST /lessons/:id/start which mints its own
    // session + deck. Generic Start Session is now a Free-Talk fast path —
    // honor an explicit free_talk request, otherwise downgrade guided_learning
    // to free_talk for this generic entrypoint so memory cannot fabricate a
    // mission deck behind a lesson's back. Lessons are the only path that
    // creates a guided deck now.
    const resolvedMode: 'guided_learning' | 'free_talk' = effectiveMode === 'free_talk' ? 'free_talk' : 'free_talk';
    if (resolvedMode !== effectiveMode) {
      await this.repo.update(session.id, { mode: resolvedMode });
      session.mode = resolvedMode;
    }
    console.log(`[Session] generic /session/start session=${session.id} → mode=${resolvedMode} (no auto deck)`);

    return { session_id: session.id, is_first_session: isFirstSession, mode: resolvedMode };
  }

  /**
   * End a session, recording *why* it ended so memory/consolidation can
   * behave differently for 'abandoned' vs deliberate 'ended' sessions.
   *
   * reason:
   *   user_clicked  – End button clicked in UI
   *   voice_intent  – AI detected closing intent in user speech
   *   idle_timeout  – Client-side 15-min idle timer fired
   *   tab_close     – beforeunload / beacon fired
   *   orphan        – cleaned up on next session start (set internally)
   */
  async end(
    sessionId: string,
    userId: string,
    reason: 'user_clicked' | 'voice_intent' | 'idle_timeout' | 'tab_close' | 'orphan' = 'user_clicked',
  ) {
    // Deliberate ends → 'ended'; silent disappearances → 'abandoned'
    const isAbandoned = reason === 'idle_timeout' || reason === 'tab_close';
    const newStatus = isAbandoned ? 'abandoned' : 'ended';

    // Snapshot the session so we know whether it was a lesson session before
    // we touch the row. Needed because finalizeAttempt reads card state from
    // the deck blob, which we mark ended just below.
    const sessionRow = await this.repo.findOne({
      where: { id: sessionId, userId },
      select: ['id', 'lessonAttemptId'],
    });

    await this.repo.update(
      { id: sessionId, userId },
      { status: newStatus, endedAt: new Date(), endReason: reason },
    );

    // Phase 6 — mark deck with the right end_reason BEFORE consolidation, so
    // the deck blob in Redis reflects how the session ended. mark_deck_ended
    // is idempotent and a no-op when no deck exists.
    const deckEndReason = mapSessionReasonToDeckEnd(reason);
    await this.endDeck(sessionId, deckEndReason);

    // Curriculum-first: score the lesson attempt from the just-ended deck.
    // Done synchronously (cheap DB work) so the FE's /lessons/attempts/:id
    // poll right after sees the final status/score/next_action.
    let lessonResult: Awaited<ReturnType<LessonService['finalizeAttempt']>> | null = null;
    if (sessionRow?.lessonAttemptId) {
      try {
        const deck = await this.getDeck(sessionId).catch(() => null);
        lessonResult = await this.lessonService.finalizeAttempt({
          attemptId: sessionRow.lessonAttemptId,
          userId,
          deck,
          sessionEndReason: reason,
        });
      } catch (err: any) {
        console.error(`[Session][end] finalize lesson attempt failed session=${sessionId}:`, err?.message);
      }
    }

    // Trigger consolidation async — fire and forget. Consolidation reads the
    // deck blob itself (rather than us passing the whole thing through HTTP)
    // so it always sees the freshly-stamped end_reason.
    this.triggerConsolidation(userId, sessionId).catch(console.error);
    return {
      session_id: sessionId,
      status: newStatus,
      reason,
      lesson_attempt_id: sessionRow?.lessonAttemptId ?? null,
      lesson_result: lessonResult,
    };
  }

  /**
   * Update last_activity_at on every turn so the idle-timeout scheduler can
   * identify sessions where the user has disappeared.
   */
  async updateLastActivity(sessionId: string, userId: string): Promise<void> {
    await this.repo.update({ id: sessionId, userId }, { lastActivityAt: new Date() });
  }

  /**
   * Generate an AI closing message via LLM for a given session.
   * Returns the text and audio_b64 (TTS).
   * This is called by the close endpoint BEFORE the hard end.
   *
   * Phase 6 — closing tone branches on deck completion:
   *   completed   → celebratory recap of all N exercises
   *   ended_early → warm acknowledgement of partial progress, no pressure
   *   abandoned   → returns empty text (caller skips TTS/UI for silent close)
   *   no deck     → existing free-form closing
   */
  async generateClosingMessage(
    userId: string,
    sessionId: string,
  ): Promise<{ text: string; audio_b64: string | null }> {
    // Fetch context in parallel — saves 2-4s vs sequential calls. The closing
    // is now short (detail lives in the evaluation board), so we no longer pull
    // the recent-context snippet here.
    const [insight, deck, user, sessionRow] = await Promise.all([
      this.getSessionInsight(userId),
      this.getDeck(sessionId).catch(() => null),
      this.userService.findById(userId).catch(() => null),
      this.repo.findOne({ where: { id: sessionId }, select: ['id', 'mode'] }).catch(() => null),
    ]);

    const struggled  = insight?.struggled_with ?? null;
    const firstName  = (user?.name ?? '').trim().split(/\s+/)[0] || '';
    const targetLang = user?.targetLanguage ?? 'English';
    const sessionMode = sessionRow?.mode ?? 'guided_learning';

    // Free Talk closing — no deck, no evaluation board. Just a warm sign-off.
    // Different prompt entirely: don't point to a non-existent breakdown.
    if (sessionMode === 'free_talk') {
      const freeTalkPrompt = [
        `You are an AI speaking partner. The user just ended a Free Talk session.`,
        `Speak ONLY in ${targetLang}. Never switch to the user's native language.`,
        `Write a VERY SHORT sign-off: ONE sentence, warm and casual — like a friend ending a call.`,
        ``,
        `Rules:`,
        `1. NO emojis. NO "great session" / "great job" — this wasn't a lesson.`,
        `2. NO mention of breakdowns, evaluations, exercises, or "let's practice X next time".`,
        `3. Sound natural, not coachy. e.g. "Nice chatting${firstName ? ', ' + firstName : ''}. Talk soon."`,
        `4. HARD LIMIT: 1 sentence, ≤ 14 words.`,
      ].filter(Boolean).join('\n');

      try {
        const llmRes = await this.http.axiosRef.post(`${this.cfg.get('LLM_GATEWAY_URL')}/complete`, {
          system: freeTalkPrompt,
          messages: [{ role: 'user', content: 'Generate the closing message now.' }],
        });
        const text: string = llmRes.data?.response_text?.trim() ?? '';
        if (!text) return { text: '', audio_b64: null };
        let audio_b64: string | null = null;
        try {
          const ttsRes = await this.http.axiosRef.post(`${this.cfg.get('SPEECH_SERVICE_URL')}/tts`, { text });
          audio_b64 = ttsRes.data?.audio_b64 ?? null;
        } catch (ttsErr: any) {
          console.error('[Session][closing][free_talk] TTS failed:', ttsErr?.message);
        }
        return { text, audio_b64 };
      } catch (err: any) {
        console.error('[Session][closing][free_talk] LLM failed:', err?.message);
        return { text: '', audio_b64: null };
      }
    }

    // Derive deck completion shape — undefined if no deck this session.
    const cards   = Array.isArray(deck?.cards) ? deck.cards : [];
    const total   = cards.length;
    const done    = cards.filter((c: any) => c?.status === 'completed').length;
    const skipped = cards.filter((c: any) => c?.status === 'skipped').length;
    const deckStatus: string | null = deck?.status ?? null;
    const endReason: string | null  = deck?.end_reason ?? null;

    // Silent close — idle timeout abandonment should not lecture the user.
    if (deckStatus === 'abandoned' || endReason === 'idle_timeout') {
      console.log(`[Session][closing] silent close session=${sessionId}  reason=${endReason}`);
      return { text: '', audio_b64: null };
    }

    let deckBlock = '';
    if (total > 0 && deckStatus === 'completed') {
      const practiced = cards
        .filter((c: any) => c?.status === 'completed')
        .map((c: any) => c?.title || c?.type)
        .filter(Boolean)
        .slice(0, 3)
        .join(', ');
      deckBlock = [
        `Today's session was a structured deck and the user COMPLETED all ${total} exercises.`,
        practiced ? `They practiced: ${practiced}.` : '',
        `Template to follow (adapt naturally, do not copy verbatim):`,
        `  "Nice work${firstName ? ', ' + firstName : ''}. Today you completed all ${total} exercises. ` +
          `You practiced <one specific skill>. Next time, we'll practice <related next skill>."`,
        `Tone: warm congratulation, no over-praise, end with one concrete next direction.`,
      ].filter(Boolean).join('\n');
    } else if (total > 0 && deckStatus === 'ended_early') {
      deckBlock = [
        `Today's session was a structured deck and the user ENDED EARLY.`,
        `They completed ${done} of ${total} exercises${skipped ? ` (skipped ${skipped})` : ''}.`,
        `Template to follow (adapt naturally):`,
        `  "Ok${firstName ? ' ' + firstName : ''}, we'll stop here. ` +
          `You still practiced the first part: <what they completed>. ` +
          `No need to finish everything today. Next time, we can continue or keep it lighter."`,
        `Tone: warm, no pressure, no language like "failed" or "incomplete". Use "paused" or "continue next time".`,
      ].join('\n');
    }

    // Closing is now intentionally SHORT — the detailed breakdown (what they
    // practiced, what to improve, stats) lives in the visual evaluation board
    // the user can open after this message. The spoken close is just a warm
    // one-line sign-off that points there.
    const prompt = [
      `You are an AI speaking coach. The user just ended today's session.`,
      `Speak ONLY in ${targetLang}. Never switch to the user's native language, even if they use it first.`,
      `Write a VERY SHORT closing message: ONE or TWO sentences, warm and natural.`,
      ``,
      `Rules:`,
      `1. Warmly acknowledge the effort in one short clause — do NOT list details or improvements (a visual breakdown shows those).`,
      `2. End by pointing them to it, e.g. "Tap below to see your session breakdown." or "Your breakdown's ready below."`,
      `3. NO emojis. NO generic openers like "Great job!". Start directly.`,
      `4. Never say "failed" or "incomplete" — use "paused" or "continue next time".`,
      `5. HARD LIMIT: 2 sentences. Do not exceed.`,
      `6. If any template or example above is not in ${targetLang}, adapt the meaning into ${targetLang}; do not copy it verbatim.`,
      ``,
      deckBlock ? `Context (for tone only, do NOT recite): ${deckBlock.split('\n')[0]}` : '',
      struggled ? `(internal) struggled with: ${struggled}` : '',
    ].filter(Boolean).join('\n');

    try {
      const llmRes = await this.http.axiosRef.post(`${this.cfg.get('LLM_GATEWAY_URL')}/complete`, {
        system: prompt,
        messages: [{ role: 'user', content: 'Generate the closing message now.' }],
      });
      const text: string = llmRes.data?.response_text?.trim() ?? '';
      if (!text) return { text: '', audio_b64: null };

      // TTS — run after LLM (needs the text)
      let audio_b64: string | null = null;
      try {
        const ttsRes = await this.http.axiosRef.post(`${this.cfg.get('SPEECH_SERVICE_URL')}/tts`, { text });
        audio_b64 = ttsRes.data?.audio_b64 ?? null;
      } catch (ttsErr: any) {
        console.error('[Session][closing] TTS failed:', ttsErr?.message);
      }

      return { text, audio_b64 };
    } catch (err: any) {
      console.error('[Session][closing] LLM failed:', err?.message);
      return { text: '', audio_b64: null };
    }
  }

  async getGreetingContext(userId: string): Promise<string> {
    const prefix = `[Greeting][getGreetingContext] user=${userId}`;
    // Slim greeting: prefer concrete short-term facts (appointments, deadlines)
    // over the synthetic SESSION_INSIGHT blob so the greeting can reference
    // urgent real-world context like "your 1 PM interview" naturally.
    // Heavy context (insight, mission, today_challenge) now lives in the
    // turn-agent's per-turn system prompt — not here.
    const payload = {
      query: 'recent conversation context',
      session_id: '',
      limit: 5,
      layers: ['short_term'],
    };
    console.log(`${prefix} → POST /retrieve layers=${JSON.stringify(payload.layers)}`);
    try {
      const res = await firstValueFrom(
        this.http.post(`${this.cfg.get('MEMORY_SERVICE_URL')}/retrieve/${userId}`, payload),
      );
      const chunks: any[] = res.data?.chunks ?? [];
      console.log(`${prefix} ← ${chunks.length} chunks returned:`);
      chunks.forEach((c, i) =>
        console.log(`  [${i}] source=${c.source} score=${c.score?.toFixed(3)} text="${String(c.text).slice(0, 80)}"`)
      );
      const concrete = chunks.filter((c) => !String(c.text ?? '').startsWith('SESSION_INSIGHT:'));
      const selected = concrete.length > 0 ? concrete.slice(0, 2) : chunks.slice(0, 1);
      const context = selected.map((c) => c.text).join('\n');
      console.log(`${prefix} context=${context ? `"${context.slice(0, 120)}..."` : 'empty'}`);
      return context;
    } catch (err: any) {
      console.error(`${prefix} ✖ failed:`, err?.message);
      return '';
    }
  }

  async getSessionInsight(userId: string): Promise<any> {
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/session-insight/${userId}`;
    try {
      const { data } = await firstValueFrom<any>(this.http.get<any>(url));
      return data;
    } catch (err: any) {
      console.error(`[Session] session-insight fetch failed:`, err?.message);
      return { has_insight: false };
    }
  }

  async getTodayChallenge(userId: string): Promise<string | null> {
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/today-challenge/${userId}`;
    try {
      const { data } = await firstValueFrom<any>(this.http.get<any>(url));
      const mission = data?.active_mission;
      return typeof mission === 'string' && mission.trim() ? mission.trim() : null;
    } catch (err: any) {
      console.error(`[Session] today-challenge fetch failed:`, err?.message);
      return null;
    }
  }

  async setTodayChallenge(userId: string, challenge: string): Promise<any> {
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/today-challenge/${userId}`;
    try {
      const { data } = await firstValueFrom<any>(this.http.put<any>(url, { challenge }));
      return data;
    } catch (err: any) {
      console.error(`[Session] today-challenge save failed:`, err?.message);
      return { active_mission: null, source: 'none' };
    }
  }

  async getOnboardingState(userId: string): Promise<any> {
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/onboarding-state/${userId}`;
    try {
      const { data } = await firstValueFrom<any>(this.http.get<any>(url));
      // Memory-service returns {} when no state — pass it through; the FE
      // treats an empty object as "no insight yet".
      return data ?? {};
    } catch (err: any) {
      console.error(`[Session] onboarding-state fetch failed:`, err?.message);
      return {};
    }
  }

  /**
   * Curriculum-first: arbitrary "regenerate deck from a topic" is no longer
   * supported as a learning path — lessons are the only durable curriculum
   * source. The method is kept so legacy FE callers don't 404, but it short-
   * circuits for lesson sessions and is a no-op otherwise (no random missions).
   */
  async regenerateDeckFromTopic(_userId: string, sessionId: string, _topic: string): Promise<void> {
    const session = await this.repo.findOne({
      where: { id: sessionId },
      select: ['id', 'mode', 'lessonAttemptId'],
    }).catch(() => null);
    if (session?.lessonAttemptId) {
      console.log(`[Deck] regenerate-from-topic blocked — lesson session=${sessionId}`);
      return;
    }
    // Legacy free-form deck regeneration removed by the curriculum pivot.
    console.log(`[Deck] regenerate-from-topic ignored (no auto deck in curriculum-first model)`);
  }

  async getSessionType(
    userId: string,
    isOnboarding: boolean,
  ): Promise<'onboarding_diagnostic' | 'personalized_training' | 'adaptive_training'> {
    if (isOnboarding) return 'onboarding_diagnostic';
    const completedOrAbandoned = await this.repo.count({
      where: [{ userId, status: 'ended' }, { userId, status: 'abandoned' }],
    });
    return completedOrAbandoned <= 1 ? 'personalized_training' : 'adaptive_training';
  }

  async generateDeck(
    userId: string,
    sessionId: string,
    user: any,
    insight: any,
    activeMission: string | null,
    isOnboarding: boolean,
  ): Promise<void> {
    if (await this.isFreeTalkSession(sessionId)) {
      console.log(`[Deck] skip generation for free_talk session=${sessionId}`);
      return;
    }
    // Curriculum-first guard #1: a session bound to a lesson attempt must not
    // be touched by the memory-driven auto-deck. The lesson deck is the only
    // truth for this session.
    const session = await this.repo.findOne({
      where: { id: sessionId },
      select: ['id', 'lessonAttemptId'],
    }).catch(() => null);
    if (session?.lessonAttemptId) {
      console.log(`[Deck] auto-generate blocked — lesson session=${sessionId} attempt=${session.lessonAttemptId}`);
      return;
    }
    // Curriculum-first guard #2: don't overwrite an existing deck (lesson or
    // otherwise). The greeting fire-and-forget used to race the lesson deck
    // and clobber it; checking presence in Redis closes that race regardless
    // of who created the deck.
    const existing = await this.getDeck(sessionId).catch(() => null);
    if (existing && existing.status && existing.status !== 'none') {
      console.log(`[Deck] auto-generate blocked — deck already exists for session=${sessionId} (status=${existing.status})`);
      return;
    }
    // Legacy memory-driven decks have been removed from the product flow.
    // Returning here means: no random missions, no LLM card pool, no fallback.
    // Free-form practice = Free Talk; structured practice = a Lesson.
    console.log(`[Deck] auto-generate disabled (curriculum-first) — session=${sessionId}`);
    void userId; void user; void insight; void activeMission; void isOnboarding;
  }

  // The legacy free-form deck generator and its helpers (buildOnboardingCards,
  // getRecentCardTasks, generateCardsWithLLM, missionToLearnerGoal,
  // buildFallbackCards) have been removed by the curriculum-first pivot.
  // Decks are now built from Lessons (LessonService.startLesson) and any
  // session not bound to a lesson runs as Free Talk (no deck).

  /**
   * Generate LLM-backed toolbox content (vocab / phrase patterns / sample response)
   * scoped to the current lesson card context.
   *
   * Called by GET /session/:id/toolbox — the tab param selects which of the
   * three content types to generate, keeping LLM cost low (one call per tab open).
   */
  async generateToolboxContent(
    userId: string,
    ctx: { sessionId?: string; topic: string; level: string; task: string; tab: 'vocab' | 'phrases' | 'sample' },
  ): Promise<any> {
    const user = await this.userService.findById(userId).catch(() => null);
    const targetLang = user?.targetLanguage ?? 'English';
    const nativeLang = user?.nativeLanguage ?? 'Vietnamese';
    const { sessionId, topic, level, task, tab } = ctx;
    const cacheKey = this.getToolboxCacheKey(userId, {
      sessionId,
      tab,
      topic,
      level,
      task,
      targetLang,
      nativeLang,
    });
    const cached = this.getToolboxCache(cacheKey);
<<<<<<< HEAD
    // Skip stale fallback entries so the LLM gets a fresh chance.
    if (cached && !cached.fallback && (tab !== 'phrases' || cached.deterministic === true)) return cached;
=======
    if (cached && (tab !== 'phrases' || cached.deterministic === true)) return cached;
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)

    const levelLabel = level === 'beginner' ? 'A1–A2 (Beginner)'
      : level === 'elementary' ? 'A2–B1 (Elementary)'
      : level === 'intermediate' ? 'B1–B2 (Intermediate)'
      : level === 'upper_intermediate' ? 'B2–C1 (Upper Intermediate)'
      : level === 'advanced' ? 'C1–C2 (Advanced)'
      : level;
    const goalContext = this.getToolboxGoalContext(task);

    // Phrase patterns should be stable and lesson-shaped. Letting the LLM
    // generate this tab made the toolbox drift into generic classroom English.
    if (tab === 'phrases') {
      const result = {
        tab,
        topic,
        level,
        task,
        deterministic: true,
        ...this.buildToolboxFallback(tab, targetLang, nativeLang, task, topic),
      };
      this.setToolboxCache(cacheKey, result);
      return result;
    }

    let systemPrompt: string;
    let userMessage: string;

    if (tab === 'vocab') {
      systemPrompt = [
        `You are a ${targetLang} language tutor. Generate a JSON object with a "vocab" array of exactly 5 vocabulary items.`,
        `Each item must have: "word" (string), "pronunciation" (IPA string), "meaning" (Vietnamese translation), "example" (one short example sentence in ${targetLang}), "example_vi" (Vietnamese translation of the example).`,
        ``,
        `Context:`,
        `- Lesson topic: ${topic || 'general conversation'}`,
        `- Learner level: ${levelLabel}`,
        goalContext ? `- Personalized goal context: ${goalContext}` : '',
        task ? `- Current exercise task: "${task}"` : '',
        ``,
        `Rules:`,
        `- Choose words directly relevant to the task or topic above.`,
        goalContext ? `- Include at least 2 words that fit the personalized goal context, without contradicting the lesson topic.` : '',
        `- Use vocabulary appropriate for ${levelLabel} learners — not too easy, not too advanced.`,
        `- Example sentences must be short (under 12 words) and clearly illustrate the word's meaning.`,
        `- The "meaning" and "example_vi" fields MUST be in Vietnamese.`,
        `- Output ONLY valid JSON. No markdown, no explanation outside the JSON.`,
        ``,
        `Format:`,
        `{"vocab":[{"word":"...","pronunciation":"...","meaning":"...","example":"...","example_vi":"..."},...]}`,
      ].filter(Boolean).join('\n');
      userMessage = 'Generate the vocabulary list now.';
    } else {
      // sample
      systemPrompt = [
        `You are a ${targetLang} language tutor. Generate a JSON object with "sample_response" and "sample_response_vi" strings.`,
        `The sample_response is a model spoken answer to the exercise task, written in ${targetLang}. The sample_response_vi is a natural Vietnamese translation of the full answer.`,
        ``,
        `Context:`,
        `- Lesson topic: ${topic || 'general conversation'}`,
        `- Learner level: ${levelLabel}`,
        goalContext ? `- Personalized goal context: ${goalContext}` : '',
        task ? `- Exercise task: "${task}"` : '',
        ``,
        `Rules:`,
        `- The sample_response must directly answer the task above.`,
        goalContext ? `- The answer MUST naturally reflect the personalized goal context in the first or second sentence. Do not copy the label text.` : '',
        `- Length: 3–5 natural spoken sentences appropriate for ${levelLabel} learners.`,
        `- Use vocabulary and grammar fitting for ${levelLabel}.`,
        `- Write in first person ("I", "My...") as if the learner is speaking.`,
        `- The sample_response field must contain ONLY ${targetLang}.`,
        `- The sample_response_vi field must contain ONLY Vietnamese.`,
        `- Do NOT add commentary, notes, or headers inside either field.`,
        `- Output ONLY valid JSON. No markdown outside the JSON.`,
        ``,
        `Format:`,
        `{"sample_response":"...","sample_response_vi":"..."}`,
      ].filter(Boolean).join('\n');
      userMessage = 'Generate the sample response now.';
    }

    try {
      const llmRes = await this.http.axiosRef.post(`${this.cfg.get('LLM_GATEWAY_URL')}/complete`, {
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      const raw: string = llmRes.data?.response_text?.trim() ?? '{}';
<<<<<<< HEAD
      console.log(`[Toolbox] LLM raw tab=${tab} len=${raw.length} start=${JSON.stringify(raw.slice(0, 80))} end=${JSON.stringify(raw.slice(-80))}`);
      const parsed = this.extractJsonFromLlmResponse(raw);
=======
      // Strip markdown code fences if the LLM wraps output in ```json ... ```
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned);
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
      const result = { tab, topic, level, task, ...parsed };
      this.setToolboxCache(cacheKey, result);
      return result;
    } catch (err: any) {
<<<<<<< HEAD
      console.error(`[Toolbox] generateToolboxContent failed tab=${tab} topic=${topic} task=${task?.slice(0, 60)}:`, err?.message);
      // Do NOT cache fallback — let the next request retry the LLM.
      return {
=======
      console.error(`[Toolbox] generateToolboxContent failed tab=${tab}:`, err?.message);
      const result = {
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
        tab,
        topic,
        level,
        task,
        fallback: true,
        ...this.buildToolboxFallback(tab, targetLang, nativeLang, task, topic),
      };
<<<<<<< HEAD
    }
  }

  async translateToVietnamese(_userId: string, text: string): Promise<{ translation: string }> {
    if (!text.trim()) return { translation: '' };
    try {
      const llmRes = await this.http.axiosRef.post(`${this.cfg.get('LLM_GATEWAY_URL')}/complete`, {
        system: [
          'You are a Vietnamese translator. Your ONLY job is to translate the user\'s text word-for-word into Vietnamese.',
          'Rules:',
          '- Translate literally. Do NOT answer, respond to, or interpret the content.',
          '- Preserve ALL placeholders exactly as-is (e.g. ___, [name], etc.).',
          '- Output ONLY the Vietnamese translation. No explanation, no extra text.',
        ].join('\n'),
        messages: [{ role: 'user', content: `Translate this to Vietnamese:\n${text}` }],
      });
      const translation = (llmRes.data?.response_text ?? '').trim();
      return { translation };
    } catch {
      return { translation: '' };
    }
  }

  private extractJsonFromLlmResponse(raw: string): Record<string, unknown> {
    // 1. Try direct parse
    try { return JSON.parse(raw); } catch { /* continue */ }
    // 2. Find first '{' and walk to its matching '}', respecting strings and escapes
    const firstBrace = raw.indexOf('{');
    if (firstBrace >= 0) {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = firstBrace; i < raw.length; i++) {
        const c = raw[i];
        if (escape) { escape = false; continue; }
        if (c === '\\' && inString) { escape = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (!inString) {
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) {
              try { return JSON.parse(raw.slice(firstBrace, i + 1)); } catch { break; }
            }
          }
        }
      }
    }
    throw new Error('No valid JSON found in LLM response');
  }

=======
      this.setToolboxCache(cacheKey, result);
      return result;
    }
  }

>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
  private getToolboxCacheKey(userId: string, input: Record<string, unknown>): string {
    return JSON.stringify({
      version: this.toolboxCacheVersion,
      userId,
      sessionId: String(input.sessionId ?? ''),
      tab: String(input.tab ?? ''),
      topic: String(input.topic ?? '').trim(),
      level: String(input.level ?? '').trim(),
      task: String(input.task ?? '').trim(),
      targetLang: String(input.targetLang ?? '').trim(),
      nativeLang: String(input.nativeLang ?? '').trim(),
    });
  }

  private getToolboxCache(key: string): any | null {
    const hit = this.toolboxCache.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.toolboxCache.delete(key);
      return null;
    }
    return hit.value;
  }

  private setToolboxCache(key: string, value: any): void {
    if (this.toolboxCache.size > 500) {
      const firstKey = this.toolboxCache.keys().next().value;
      if (firstKey) this.toolboxCache.delete(firstKey);
    }
    this.toolboxCache.set(key, { expiresAt: Date.now() + this.toolboxCacheTtlMs, value });
  }

  private getToolboxGoalContext(task: string): string | null {
    const normalized = task.toLowerCase();
    if (normalized.includes('travel context:')) return 'travel / away from home';
    if (normalized.includes('professional context:')) return 'work or career';
    if (normalized.includes('study context:')) return 'class, study, or practice';
    if (normalized.includes('social context:')) return 'meeting or talking with someone new';
    if (normalized.includes('casual context:')) return 'relaxed everyday conversation';
    return null;
  }

  private translateToolboxExampleToVietnamese(example: string): string {
    const translations: Record<string, string> = {
      'When I travel, I like walking around.': 'Khi đi du lịch, tôi thích đi dạo xung quanh.',
      'When I travel, I like trying local food.': 'Khi đi du lịch, tôi thích thử đồ ăn địa phương.',
      'In my free time, I usually visit small cafes.': 'Lúc rảnh, tôi thường ghé các quán cà phê nhỏ.',
      'In my free time, I usually take photos.': 'Lúc rảnh, tôi thường chụp ảnh.',
      'I like walking because I can see new places.': 'Tôi thích đi bộ vì tôi có thể thấy những nơi mới.',
      'I like music because it helps me relax.': 'Tôi thích âm nhạc vì nó giúp tôi thư giãn.',
      'It helps me relax.': 'Nó giúp tôi thư giãn.',
      'It helps me learn about the city.': 'Nó giúp tôi hiểu thêm về thành phố.',
      'My name is Linh.': 'Tên tôi là Linh.',
      'My name is Nam.': 'Tên tôi là Nam.',
      "I'm from Hanoi.": 'Tôi đến từ Hà Nội.',
      "I'm from Vietnam.": 'Tôi đến từ Việt Nam.',
      'I live in Da Nang.': 'Tôi sống ở Đà Nẵng.',
      'I live in a small city.': 'Tôi sống ở một thành phố nhỏ.',
      'Hi, nice to meet you.': 'Xin chào, rất vui được gặp bạn.',
      'Nice to meet you too.': 'Tôi cũng rất vui được gặp bạn.',
      'I like coffee.': 'Tôi thích cà phê.',
      'I like football.': 'Tôi thích bóng đá.',
      'I really like music because it helps me relax.': 'Tôi rất thích âm nhạc vì nó giúp tôi thư giãn.',
      'I really like English because it is useful.': 'Tôi rất thích tiếng Anh vì nó hữu ích.',
      'My favorite food is noodles.': 'Món ăn yêu thích của tôi là mì.',
      'My favorite sport is badminton.': 'Môn thể thao yêu thích của tôi là cầu lông.',
      'I like coffee. What do you like?': 'Tôi thích cà phê. Bạn thích gì?',
      'What do you like to do after work?': 'Bạn thích làm gì sau giờ làm?',
      'I usually wake up at seven.': 'Tôi thường thức dậy lúc bảy giờ.',
      'I usually drink coffee.': 'Tôi thường uống cà phê.',
      'In the morning, I go to work.': 'Vào buổi sáng, tôi đi làm.',
      'In the morning, I study English.': 'Vào buổi sáng, tôi học tiếng Anh.',
      'After that, I have breakfast.': 'Sau đó, tôi ăn sáng.',
      'After that, I take a bus.': 'Sau đó, tôi đi xe buýt.',
      'At night, I watch a movie.': 'Buổi tối, tôi xem phim.',
      'At night, I go to bed early.': 'Buổi tối, tôi đi ngủ sớm.',
      'This is my brother.': 'Đây là anh/em trai của tôi.',
      'This is my best friend.': 'Đây là bạn thân nhất của tôi.',
      'She is kind.': 'Cô ấy tốt bụng.',
      'He is very funny.': 'Anh ấy rất hài hước.',
      'We usually eat dinner together.': 'Chúng tôi thường ăn tối cùng nhau.',
      'We usually play games together.': 'Chúng tôi thường chơi trò chơi cùng nhau.',
      'I spend time with my family.': 'Tôi dành thời gian với gia đình.',
      'I spend time with my close friends.': 'Tôi dành thời gian với những người bạn thân.',
      'Could I have a coffee, please?': 'Cho tôi một ly cà phê được không?',
      'Could I have the menu, please?': 'Cho tôi xem thực đơn được không?',
      "I'd like a sandwich.": 'Tôi muốn một cái bánh sandwich.',
      "I'd like a small latte.": 'Tôi muốn một ly latte nhỏ.',
      'Does it come with rice?': 'Món này có kèm cơm không?',
      'Does it come with milk?': 'Món này có kèm sữa không?',
      'For here, please.': 'Dùng tại chỗ ạ.',
      'To go, please.': 'Mang đi ạ.',
      'I work at a small company.': 'Tôi làm việc ở một công ty nhỏ.',
      'I study at a university.': 'Tôi học ở một trường đại học.',
      "I'm a designer.": 'Tôi là nhà thiết kế.',
      "I'm a student.": 'Tôi là sinh viên.',
      'I usually talk to customers there.': 'Tôi thường nói chuyện với khách hàng ở đó.',
      'I usually study English there.': 'Tôi thường học tiếng Anh ở đó.',
      "I'm a student. How about you?": 'Tôi là sinh viên. Còn bạn thì sao?',
      'I work in marketing. How about you?': 'Tôi làm trong ngành marketing. Còn bạn thì sao?',
      'Excuse me, where is the station?': 'Xin lỗi, nhà ga ở đâu?',
      'Excuse me, where is the nearest cafe?': 'Xin lỗi, quán cà phê gần nhất ở đâu?',
      'How do I get to the bus stop?': 'Tôi đi đến trạm xe buýt như thế nào?',
      'How do I get to the hotel?': 'Tôi đi đến khách sạn như thế nào?',
      'Is it near here?': 'Nó có gần đây không?',
      'Is it far from here?': 'Nó có xa đây không?',
      'So I go straight, right?': 'Vậy tôi đi thẳng, đúng không?',
      'So I turn left, right?': 'Vậy tôi rẽ trái, đúng không?',
      'How much is this shirt?': 'Cái áo này giá bao nhiêu?',
      'How much is the small one?': 'Cái nhỏ giá bao nhiêu?',
      'Do you have a smaller size?': 'Bạn có cỡ nhỏ hơn không?',
      'Do you have this in blue?': 'Bạn có cái này màu xanh không?',
      'Can I pay by card?': 'Tôi có thể thanh toán bằng thẻ không?',
      'Can I pay by cash?': 'Tôi có thể trả bằng tiền mặt không?',
      "I'll take it.": 'Tôi lấy cái này.',
      "I'll take this one, please.": 'Tôi lấy cái này ạ.',
      'Do you want to get coffee?': 'Bạn có muốn đi uống cà phê không?',
      'Do you want to meet this weekend?': 'Bạn có muốn gặp vào cuối tuần này không?',
      'How about Saturday?': 'Thứ Bảy thì sao?',
      'How about the cafe near the park?': 'Quán cà phê gần công viên thì sao?',
      "Let's meet at 7 pm.": 'Chúng ta gặp lúc 7 giờ tối nhé.',
      "Let's meet at the coffee shop.": 'Chúng ta gặp ở quán cà phê nhé.',
      'Can we do 8 pm instead?': 'Chúng ta đổi sang 8 giờ tối được không?',
      'Can we meet tomorrow instead?': 'Chúng ta gặp vào ngày mai được không?',
      'I think pizza is great.': 'Tôi nghĩ pizza rất tuyệt.',
      'I think this city is interesting.': 'Tôi nghĩ thành phố này thú vị.',
      'I agree because it is useful.': 'Tôi đồng ý vì nó hữu ích.',
      'I agree because it saves time.': 'Tôi đồng ý vì nó tiết kiệm thời gian.',
      "I don't really agree because it is expensive.": 'Tôi không hẳn đồng ý vì nó đắt.',
      "I don't really agree because it is too far.": 'Tôi không hẳn đồng ý vì nó quá xa.',
      'What do you think?': 'Bạn nghĩ sao?',
      'I like this idea. What do you think?': 'Tôi thích ý tưởng này. Bạn nghĩ sao?',
      'Last weekend, I visited my friend.': 'Cuối tuần trước, tôi đã thăm bạn.',
      'Last night, I watched a movie.': 'Tối qua, tôi đã xem một bộ phim.',
      'I went to a cafe.': 'Tôi đã đến một quán cà phê.',
      'I went to the park.': 'Tôi đã đến công viên.',
      'It was fun.': 'Nó rất vui.',
      'It was a little tiring.': 'Nó hơi mệt.',
      'I was with my family.': 'Tôi đã ở cùng gia đình.',
      'I was with two friends.': 'Tôi đã ở cùng hai người bạn.',
      "I'm going to study tonight.": 'Tối nay tôi sẽ học.',
      "I'm going to visit my friend.": 'Tôi sẽ thăm bạn của tôi.',
      'I will practice tomorrow.': 'Ngày mai tôi sẽ luyện tập.',
      'I will call my friend.': 'Tôi sẽ gọi cho bạn tôi.',
      "I'm planning to travel next month.": 'Tôi dự định đi du lịch vào tháng tới.',
      "I'm planning to learn more vocabulary.": 'Tôi dự định học thêm từ vựng.',
      'My next step is to practice every day.': 'Bước tiếp theo của tôi là luyện tập mỗi ngày.',
      'My next step is to speak with a friend.': 'Bước tiếp theo của tôi là nói chuyện với một người bạn.',
      'I like coffee because it smells good.': 'Tôi thích cà phê vì nó có mùi thơm.',
      'Could you repeat that?': 'Bạn có thể nhắc lại được không?',
      'Sorry, could you repeat that?': 'Xin lỗi, bạn có thể nhắc lại được không?',
      'I like football. What about you?': 'Tôi thích bóng đá. Còn bạn thì sao?',
    };
    return translations[example] ?? '';
  }

  private buildToolboxFallback(
    tab: 'vocab' | 'phrases' | 'sample',
    targetLang: string,
    nativeLang: string,
    task: string,
    topic: string,
  ): Record<string, unknown> {
    if (tab === 'phrases') {
      const useVietnamese = nativeLang.toLowerCase().includes('vietnam');
      const meaning = (vi: string, en: string) => (useVietnamese ? vi : en);
      const context = `${topic} ${task}`.toLowerCase();
      const phrases = (() => {
        if (context.match(/travel context|away from home/) && context.match(/like|favorite|favourite|free time|hobby/)) {
          return [
            {
              pattern: 'When I travel, I like ___.',
              meaning: meaning('Dùng để nói điều bạn thích làm khi đi xa.', 'Use this to say what you like doing while traveling.'),
              examples: ['When I travel, I like walking around.', 'When I travel, I like trying local food.'],
            },
            {
              pattern: 'In my free time, I usually ___.',
              meaning: meaning('Dùng để nói việc bạn thường làm lúc rảnh.', 'Use this to say what you usually do in your free time.'),
              examples: ['In my free time, I usually visit small cafes.', 'In my free time, I usually take photos.'],
            },
            {
              pattern: 'I like ___ because ___.',
              meaning: meaning('Dùng để nói sở thích và lý do.', 'Use this to say what you like and why.'),
              examples: ['I like walking because I can see new places.', 'I like music because it helps me relax.'],
            },
            {
              pattern: 'It helps me ___.',
              meaning: meaning('Dùng để nói lợi ích của hoạt động đó.', 'Use this to explain how the activity helps you.'),
              examples: ['It helps me relax.', 'It helps me learn about the city.'],
            },
          ];
        }

        if (context.match(/introduce|introduction|self-intro|about me|name|meeting someone new|say "hi"/)) {
          return [
            {
              pattern: 'My name is ___.',
              meaning: meaning('Dùng để giới thiệu tên của bạn.', 'Use this to introduce your name.'),
              examples: ['My name is Linh.', 'My name is Nam.'],
            },
            {
              pattern: "I'm from ___.",
              meaning: meaning('Dùng để nói bạn đến từ đâu.', 'Use this to say where you are from.'),
              examples: ["I'm from Hanoi.", "I'm from Vietnam."],
            },
            {
              pattern: 'I live in ___.',
              meaning: meaning('Dùng để nói nơi bạn đang sống.', 'Use this to say where you live.'),
              examples: ['I live in Da Nang.', 'I live in a small city.'],
            },
            {
              pattern: 'Nice to meet you.',
              meaning: meaning('Dùng khi gặp ai đó lần đầu.', 'Use this when meeting someone for the first time.'),
              examples: ['Hi, nice to meet you.', 'Nice to meet you too.'],
            },
          ];
        }

        if (context.match(/like|favorite|favourite|things you like|hobby|music|food|sport/)) {
          return [
            {
              pattern: 'I like ___.',
              meaning: meaning('Dùng để nói điều bạn thích.', 'Use this to say what you like.'),
              examples: ['I like coffee.', 'I like football.'],
            },
            {
              pattern: 'I really like ___ because ___.',
              meaning: meaning('Dùng để nói bạn rất thích điều gì và thêm lý do.', 'Use this to say you really like something and add a reason.'),
              examples: ['I really like music because it helps me relax.', 'I really like English because it is useful.'],
            },
            {
              pattern: 'My favorite ___ is ___.',
              meaning: meaning('Dùng để nói thứ bạn thích nhất trong một nhóm.', 'Use this to name your favorite thing in a category.'),
              examples: ['My favorite food is noodles.', 'My favorite sport is badminton.'],
            },
            {
              pattern: 'What do you like?',
              meaning: meaning('Dùng để hỏi người kia thích gì.', 'Use this to ask what the other person likes.'),
              examples: ['I like coffee. What do you like?', 'What do you like to do after work?'],
            },
          ];
        }

        if (context.match(/routine|morning|afternoon|evening|daily|today|wake up|go to bed/)) {
          return [
            {
              pattern: 'I usually ___.',
              meaning: meaning('Dùng để nói việc bạn thường làm.', 'Use this to talk about something you often do.'),
              examples: ['I usually wake up at seven.', 'I usually drink coffee.'],
            },
            {
              pattern: 'In the morning, I ___.',
              meaning: meaning('Dùng để kể việc bạn làm vào buổi sáng.', 'Use this to describe your morning.'),
              examples: ['In the morning, I go to work.', 'In the morning, I study English.'],
            },
            {
              pattern: 'After that, I ___.',
              meaning: meaning('Dùng để nối hành động tiếp theo.', 'Use this to connect the next action.'),
              examples: ['After that, I have breakfast.', 'After that, I take a bus.'],
            },
            {
              pattern: 'At night, I ___.',
              meaning: meaning('Dùng để kể việc bạn làm vào buổi tối.', 'Use this to describe your night routine.'),
              examples: ['At night, I watch a movie.', 'At night, I go to bed early.'],
            },
          ];
        }

        if (context.match(/family|friend|friends|person|people|spend time|who do you spend/)) {
          return [
            {
              pattern: 'This is my ___.',
              meaning: meaning('Dùng để giới thiệu một người thân hoặc bạn bè.', 'Use this to introduce a family member or friend.'),
              examples: ['This is my brother.', 'This is my best friend.'],
            },
            {
              pattern: 'He is ___ / She is ___.',
              meaning: meaning('Dùng để mô tả ngắn về một người.', 'Use this to describe someone briefly.'),
              examples: ['She is kind.', 'He is very funny.'],
            },
            {
              pattern: 'We usually ___ together.',
              meaning: meaning('Dùng để nói hai người thường làm gì cùng nhau.', 'Use this to say what you often do together.'),
              examples: ['We usually eat dinner together.', 'We usually play games together.'],
            },
            {
              pattern: 'I spend time with ___.',
              meaning: meaning('Dùng để nói bạn dành thời gian với ai.', 'Use this to say who you spend time with.'),
              examples: ['I spend time with my family.', 'I spend time with my close friends.'],
            },
          ];
        }

        if (context.match(/food|drink|order|barista|cafe|restaurant|coffee/)) {
          return [
            {
              pattern: 'Could I have ___, please?',
              meaning: meaning('Dùng để gọi món hoặc yêu cầu gì đó một cách lịch sự.', 'Use this to order or ask for something politely.'),
              examples: ['Could I have a coffee, please?', 'Could I have the menu, please?'],
            },
            {
              pattern: "I'd like ___",
              meaning: meaning('Dùng để nói món hoặc thứ bạn muốn.', 'Use this to say what you want.'),
              examples: ["I'd like a sandwich.", "I'd like a small latte."],
            },
            {
              pattern: 'Does it come with ___?',
              meaning: meaning('Dùng để hỏi món đó có kèm thứ gì không.', 'Use this to ask what something includes.'),
              examples: ['Does it come with rice?', 'Does it come with milk?'],
            },
            {
              pattern: 'For here or to go?',
              meaning: meaning('Câu hỏi thường gặp khi mua đồ ăn/uống: dùng tại chỗ hay mang đi.', 'A common question for eating there or taking it away.'),
              examples: ['For here, please.', 'To go, please.'],
            },
          ];
        }

        if (context.match(/work|study|school|class|job|student|small talk|what do you do/)) {
          return [
            {
              pattern: 'I work/study at ___.',
              meaning: meaning('Dùng để nói nơi bạn làm việc hoặc học.', 'Use this to say where you work or study.'),
              examples: ['I work at a small company.', 'I study at a university.'],
            },
            {
              pattern: "I'm a ___.",
              meaning: meaning('Dùng để nói nghề nghiệp hoặc vai trò của bạn.', 'Use this to say your job or role.'),
              examples: ["I'm a designer.", "I'm a student."],
            },
            {
              pattern: 'I usually ___ there.',
              meaning: meaning('Dùng để nói việc bạn thường làm ở nơi làm/học.', 'Use this to say what you usually do there.'),
              examples: ['I usually talk to customers there.', 'I usually study English there.'],
            },
            {
              pattern: 'How about you?',
              meaning: meaning('Dùng để hỏi lại người kia sau khi bạn trả lời.', 'Use this to ask the other person back.'),
              examples: ["I'm a student. How about you?", 'I work in marketing. How about you?'],
            },
          ];
        }

        if (context.match(/direction|where|lost|street|station|bus stop|coffee shop|walking/)) {
          return [
            {
              pattern: 'Excuse me, where is ___?',
              meaning: meaning('Dùng để hỏi địa điểm một cách lịch sự.', 'Use this to ask where a place is politely.'),
              examples: ['Excuse me, where is the station?', 'Excuse me, where is the nearest cafe?'],
            },
            {
              pattern: 'How do I get to ___?',
              meaning: meaning('Dùng để hỏi đường đi tới một nơi.', 'Use this to ask how to get somewhere.'),
              examples: ['How do I get to the bus stop?', 'How do I get to the hotel?'],
            },
            {
              pattern: 'Is it near here?',
              meaning: meaning('Dùng để hỏi nơi đó có gần đây không.', 'Use this to ask whether a place is nearby.'),
              examples: ['Is it near here?', 'Is it far from here?'],
            },
            {
              pattern: 'So I go ___, right?',
              meaning: meaning('Dùng để xác nhận lại hướng dẫn đường.', 'Use this to check directions back.'),
              examples: ['So I go straight, right?', 'So I turn left, right?'],
            },
          ];
        }

        if (context.match(/buy|shop|price|pay|card|cash|size|color|t-shirt|bag/)) {
          return [
            {
              pattern: 'How much is ___?',
              meaning: meaning('Dùng để hỏi giá của một món đồ.', 'Use this to ask the price of something.'),
              examples: ['How much is this shirt?', 'How much is the small one?'],
            },
            {
              pattern: 'Do you have ___?',
              meaning: meaning('Dùng để hỏi cửa hàng có lựa chọn bạn cần không.', 'Use this to ask if the shop has an option you need.'),
              examples: ['Do you have a smaller size?', 'Do you have this in blue?'],
            },
            {
              pattern: 'Can I pay by ___?',
              meaning: meaning('Dùng để hỏi cách thanh toán.', 'Use this to ask about payment.'),
              examples: ['Can I pay by card?', 'Can I pay by cash?'],
            },
            {
              pattern: "I'll take it.",
              meaning: meaning('Dùng để nói bạn quyết định mua món đó.', 'Use this when you decide to buy something.'),
              examples: ["I'll take it.", "I'll take this one, please."],
            },
          ];
        }

        if (context.match(/plan|meet|weekend|free|time|place|tonight|tomorrow/)) {
          return [
            {
              pattern: 'Do you want to ___?',
              meaning: meaning('Dùng để rủ ai đó làm gì.', 'Use this to invite someone to do something.'),
              examples: ['Do you want to get coffee?', 'Do you want to meet this weekend?'],
            },
            {
              pattern: 'How about ___?',
              meaning: meaning('Dùng để đề xuất một lựa chọn.', 'Use this to suggest an option.'),
              examples: ['How about Saturday?', 'How about the cafe near the park?'],
            },
            {
              pattern: "Let's meet at ___.",
              meaning: meaning('Dùng để chốt địa điểm hoặc thời gian gặp.', 'Use this to confirm a meeting time or place.'),
              examples: ["Let's meet at 7 pm.", "Let's meet at the coffee shop."],
            },
            {
              pattern: 'Can we do ___ instead?',
              meaning: meaning('Dùng để đổi thời gian hoặc kế hoạch một cách lịch sự.', 'Use this to politely change the plan.'),
              examples: ['Can we do 8 pm instead?', 'Can we meet tomorrow instead?'],
            },
          ];
        }

        if (context.match(/opinion|think|agree|disagree|because|debate/)) {
          return [
            {
              pattern: 'I think ___',
              meaning: meaning('Dùng để nói ý kiến cá nhân đơn giản.', 'Use this to give a simple opinion.'),
              examples: ['I think pizza is great.', 'I think this city is interesting.'],
            },
            {
              pattern: 'I agree because ___',
              meaning: meaning('Dùng để đồng ý và thêm lý do.', 'Use this to agree and add a reason.'),
              examples: ['I agree because it is useful.', 'I agree because it saves time.'],
            },
            {
              pattern: "I don't really agree because ___",
              meaning: meaning('Dùng để không đồng ý một cách mềm và lịch sự.', 'Use this to disagree gently and politely.'),
              examples: ["I don't really agree because it is expensive.", "I don't really agree because it is too far."],
            },
            {
              pattern: 'What do you think?',
              meaning: meaning('Dùng để hỏi lại ý kiến của người kia.', 'Use this to ask for the other person’s opinion.'),
              examples: ['What do you think?', 'I like this idea. What do you think?'],
            },
          ];
        }

        if (context.match(/past|weekend|yesterday|recently|did|went|ate|saw/)) {
          return [
            {
              pattern: 'Last ___, I ___',
              meaning: meaning('Dùng để kể một việc đã xảy ra trong quá khứ.', 'Use this to talk about something in the past.'),
              examples: ['Last weekend, I visited my friend.', 'Last night, I watched a movie.'],
            },
            {
              pattern: 'I went to ___',
              meaning: meaning('Dùng để nói bạn đã đi đâu.', 'Use this to say where you went.'),
              examples: ['I went to a cafe.', 'I went to the park.'],
            },
            {
              pattern: 'It was ___',
              meaning: meaning('Dùng để mô tả cảm giác hoặc trải nghiệm.', 'Use this to describe how something was.'),
              examples: ['It was fun.', 'It was a little tiring.'],
            },
            {
              pattern: 'I was with ___',
              meaning: meaning('Dùng để nói bạn đã đi/làm việc đó cùng ai.', 'Use this to say who you were with.'),
              examples: ['I was with my family.', 'I was with two friends.'],
            },
          ];
        }

        if (context.match(/future|going to|will|planning|goal|next week|this month/)) {
          return [
            {
              pattern: "I'm going to ___",
              meaning: meaning('Dùng để nói một kế hoạch sắp làm.', 'Use this to talk about a plan.'),
              examples: ["I'm going to study tonight.", "I'm going to visit my friend."],
            },
            {
              pattern: 'I will ___',
              meaning: meaning('Dùng để nói điều bạn sẽ làm.', 'Use this to say what you will do.'),
              examples: ['I will practice tomorrow.', 'I will call my friend.'],
            },
            {
              pattern: "I'm planning to ___",
              meaning: meaning('Dùng để nói kế hoạch đang dự định.', 'Use this to talk about something you are planning.'),
              examples: ["I'm planning to travel next month.", "I'm planning to learn more vocabulary."],
            },
            {
              pattern: 'My next step is ___',
              meaning: meaning('Dùng để nói bước tiếp theo để đạt mục tiêu.', 'Use this to describe the next step toward a goal.'),
              examples: ['My next step is to practice every day.', 'My next step is to speak with a friend.'],
            },
          ];
        }

        return [
          {
            pattern: "I'm from ___",
            meaning: meaning('Dùng để nói bạn đến từ đâu.', 'Use this to say where you are from.'),
            examples: ["I'm from Hanoi.", "I'm from Vietnam."],
          },
          {
            pattern: 'I like ___ because ___',
            meaning: meaning('Dùng để nói điều bạn thích và lý do.', 'Use this to say what you like and why.'),
            examples: ['I like coffee because it smells good.', 'I like music because it helps me relax.'],
          },
          {
            pattern: 'Could you repeat that?',
            meaning: meaning('Dùng khi bạn muốn người khác nhắc lại.', 'Use this when you want someone to repeat.'),
            examples: ['Could you repeat that?', 'Sorry, could you repeat that?'],
          },
          {
            pattern: 'What about you?',
            meaning: meaning('Dùng để hỏi lại người kia và giữ cuộc trò chuyện tiếp tục.', 'Use this to ask back and keep the conversation going.'),
            examples: ['I like football. What about you?', "I'm a student. What about you?"],
          },
        ];
      })();

      return {
        phrases: phrases.map((item: any) => ({
          ...item,
          meaning_vi: item.meaning_vi ?? item.meaning,
          examples_vi: Array.isArray(item.examples)
            ? item.examples.map((example: string) => this.translateToolboxExampleToVietnamese(example))
            : [],
        })),
      };
    }

    if (tab === 'vocab') {
      return {
        vocab: [
          { word: 'help', pronunciation: '/help/', meaning: 'giúp đỡ', example: 'Can you help me?', example_vi: 'Bạn có thể giúp tôi không?' },
          { word: 'please', pronunciation: '/pliːz/', meaning: 'làm ơn / cho lịch sự khi yêu cầu', example: 'A coffee, please.', example_vi: 'Cho tôi một ly cà phê ạ.' },
          { word: 'because', pronunciation: '/bɪˈkəz/', meaning: 'bởi vì', example: 'I like it because it is easy.', example_vi: 'Tôi thích nó vì nó dễ.' },
          { word: 'near', pronunciation: '/nɪr/', meaning: 'gần', example: 'Is it near here?', example_vi: 'Nó có gần đây không?' },
          { word: 'again', pronunciation: '/əˈɡen/', meaning: 'lại / một lần nữa', example: 'Please say it again.', example_vi: 'Làm ơn nói lại lần nữa.' },
        ],
      };
    }

    const focus = task || topic || 'this situation';
    const goalContext = this.getToolboxGoalContext(task);
    if (goalContext === 'travel / away from home' && `${topic} ${task}`.toLowerCase().match(/like|free time|hobby/)) {
      return {
        sample_response:
          'When I am away from home, I like to walk around the city in my free time. I enjoy it because I can see new places and feel relaxed. Sometimes I also like to sit in a small cafe and listen to music.',
        sample_response_vi:
          'Khi tôi đi xa nhà, tôi thích đi dạo quanh thành phố vào lúc rảnh. Tôi thích điều đó vì tôi có thể nhìn thấy những nơi mới và cảm thấy thư giãn. Đôi khi tôi cũng thích ngồi ở một quán cà phê nhỏ và nghe nhạc.',
      };
    }
    if (goalContext === 'work or career' && `${topic} ${task}`.toLowerCase().match(/like|free time|hobby/)) {
      return {
        sample_response:
          'After work, I like to listen to music in my free time. I enjoy it because it helps me relax and clear my mind. Sometimes I also read a short book before bed.',
        sample_response_vi:
          'Sau giờ làm, tôi thích nghe nhạc vào lúc rảnh. Tôi thích điều đó vì nó giúp tôi thư giãn và đầu óc nhẹ hơn. Đôi khi tôi cũng đọc một cuốn sách ngắn trước khi ngủ.',
      };
    }
    return {
      sample_response:
        `I want to practice ${focus}. I will try to speak clearly and use simple words. If I make a mistake, I can try again. I think this will help me feel more confident.`,
      sample_response_vi:
        `Tôi muốn luyện tập tình huống này. Tôi sẽ cố gắng nói rõ ràng và dùng từ đơn giản. Nếu mắc lỗi, tôi có thể thử lại. Tôi nghĩ điều này sẽ giúp tôi tự tin hơn.`,
    };
  }

  async getDeck(sessionId: string): Promise<any> {
    if (await this.isFreeTalkSession(sessionId)) {
      return { status: 'none', session_id: sessionId, cards: [] };
    }
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/exercise-deck/${sessionId}`;
    try {
      const { data } = await firstValueFrom<any>(this.http.get<any>(url));
      return data;
    } catch (err: any) {
      console.error(`[Session] getDeck failed session=${sessionId}:`, err?.message);
      return { status: 'none', session_id: sessionId };
    }
  }

  async createDeck(sessionId: string, body: { mission_source?: string; cards?: any[] }): Promise<any> {
    if (await this.isFreeTalkSession(sessionId)) {
      console.log(`[Deck] skip create for free_talk session=${sessionId}`);
      return { status: 'none', session_id: sessionId, cards: [] };
    }
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/exercise-deck/${sessionId}`;
    try {
      const { data } = await firstValueFrom<any>(this.http.post<any>(url, body));
      return data;
    } catch (err: any) {
      console.error(`[Session] createDeck failed session=${sessionId}:`, err?.message);
      return { status: 'none', session_id: sessionId };
    }
  }

  /**
   * Fetch the user-facing session evaluation report from the session row.
   * The consolidation worker persists it to `sessions.breakdown` on session
   * end; returns {status:'pending'} until it's there so the FE can poll
   * (post-session) or show "not available" (old History sessions).
   */
  async getEvaluation(sessionId: string, userId: string): Promise<any> {
    try {
      const session = await this.repo.findOne({
        where: { id: sessionId, userId },
        select: ['id', 'breakdown', 'mode', 'startedAt', 'endedAt', 'lessonAttemptId'],
      });
      if (!session) return { status: 'pending', session_id: sessionId };
      // Free Talk sessions never get a full breakdown — surface a lightweight
      // "free_talk" marker so the FE can render its Free Talk recap card
      // instead of polling forever for a skill_radar that will never arrive.
      if (session.mode === 'free_talk') {
        const turns = await this.turnRepo.find({
          where: { sessionId, userId },
          order: { turnIndex: 'ASC' },
          select: ['id', 'turnIndex', 'data', 'createdAt'],
        });
        const fallbackEnd = turns.at(-1)?.createdAt ?? session.endedAt ?? new Date();
        const durationMs = session.startedAt
          ? Math.max(0, fallbackEnd.getTime() - session.startedAt.getTime())
          : 0;
        const minutes = durationMs > 0 ? Math.max(1, Math.round(durationMs / 60000)) : null;
        const spokenSamples = turns
          .map((t) => (typeof t.data?.transcript === 'string' ? t.data.transcript.trim() : ''))
          .filter(Boolean)
          .slice(0, 3);
        return {
          status: 'ready',
          mode: 'free_talk',
          session_id: sessionId,
          generated_at: new Date().toISOString(),
          summary: 'You kept it casual and open-ended.',
          highlights: [],
          growth_areas: [],
          next_focus: '',
          energy: 'free_talk',
          cards: [],
          spoken_samples: spokenSamples,
          stats: {
            user_turns: turns.length,
            cards_completed: 0,
            cards_total: 0,
            cards_skipped: 0,
            duration_minutes: minutes,
          },
          ...(session.breakdown ?? {}),
        };
      }
      if (!session.breakdown) {
        return { status: 'pending', session_id: sessionId };
      }
      const lessonResult = session.lessonAttemptId
        ? await this.lessonService.getAttempt(userId, session.lessonAttemptId).catch(() => null)
        : null;
      return {
        ...session.breakdown,
        mode: session.mode,
        lesson_result: lessonResult
          ? {
              attempt_id: lessonResult.attempt.id,
              lesson_title: lessonResult.lesson?.title ?? null,
              status: lessonResult.attempt.status,
              score: lessonResult.attempt.score,
              final_score: lessonResult.attempt.final_score,
              pass_score: lessonResult.lesson?.pass_score ?? null,
              teacher_review_status: lessonResult.attempt.teacher_review_status,
              reviewed_at: lessonResult.teacher_review?.reviewed_at ?? null,
              // Both scoring views so the breakdown panel can offer AI/Teacher tabs.
              ai_review: lessonResult.ai_review,
              teacher_review: lessonResult.teacher_review,
            }
          : null,
      };
    } catch (err: any) {
      console.error(`[Session] getEvaluation failed session=${sessionId}:`, err?.message);
      return { status: 'pending', session_id: sessionId };
    }
  }

  async advanceDeck(sessionId: string): Promise<any> {
    if (await this.isFreeTalkSession(sessionId)) return { status: 'none', session_id: sessionId, cards: [] };
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/exercise-deck/${sessionId}/next`;
    try {
      const { data } = await firstValueFrom<any>(this.http.put<any>(url, {}));
      return data;
    } catch (err: any) {
      console.error(`[Session] advanceDeck failed session=${sessionId}:`, err?.message);
      return { status: 'none', session_id: sessionId };
    }
  }

  async skipDeckCard(sessionId: string): Promise<any> {
    if (await this.isFreeTalkSession(sessionId)) return { status: 'none', session_id: sessionId, cards: [] };
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/exercise-deck/${sessionId}/skip`;
    try {
      const { data } = await firstValueFrom<any>(this.http.put<any>(url, {}));
      return data;
    } catch (err: any) {
      console.error(`[Session] skipDeckCard failed session=${sessionId}:`, err?.message);
      return { status: 'none', session_id: sessionId };
    }
  }

  async updateDeckCard(sessionId: string, body: any): Promise<any> {
    if (await this.isFreeTalkSession(sessionId)) return { status: 'none', session_id: sessionId, cards: [] };
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/exercise-deck/${sessionId}/card`;
    try {
      const { data } = await firstValueFrom<any>(this.http.put<any>(url, body));
      return data;
    } catch (err: any) {
      console.error(`[Session] updateDeckCard failed session=${sessionId}:`, err?.message);
      return { status: 'none', session_id: sessionId };
    }
  }

  async updateDeckStatus(sessionId: string, status: string): Promise<any> {
    if (await this.isFreeTalkSession(sessionId)) return { status: 'none', session_id: sessionId, cards: [] };
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/exercise-deck/${sessionId}/status`;
    try {
      const { data } = await firstValueFrom<any>(this.http.put<any>(url, { status }));
      return data;
    } catch (err: any) {
      console.error(`[Session] updateDeckStatus failed session=${sessionId}:`, err?.message);
      return { status: 'none', session_id: sessionId };
    }
  }

  async endDeck(sessionId: string, endReason = 'user_clicked_end'): Promise<any> {
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/exercise-deck/${sessionId}/end`;
    try {
      const { data } = await firstValueFrom<any>(this.http.put<any>(url, { end_reason: endReason }));
      if (endReason === 'user_chose_free_talk') {
        await this.repo.update(sessionId, { mode: 'free_talk' });
      }
      return data;
    } catch (err: any) {
      console.error(`[Session] endDeck failed session=${sessionId}:`, err?.message);
      return { status: 'none', session_id: sessionId };
    }
  }

  async list(userId: string, page: number, limit: number) {
    const [items, total] = await this.repo.findAndCount({
      where: { userId, isArchived: false },
      order: { startedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      select: ['id', 'title', 'status', 'startedAt', 'mode', 'lessonAttemptId'],
    });
    const lessonTitleByAttempt = await this.lessonService.getLessonTitlesForAttempts(
      userId,
      items.map((s) => s.lessonAttemptId).filter((id): id is string => Boolean(id)),
    );
    return {
      items: items.map((s) => ({
        ...s,
        title: s.lessonAttemptId ? (lessonTitleByAttempt.get(s.lessonAttemptId) ?? s.title) : s.title,
      })),
      total,
      page,
      limit,
      hasMore: (page - 1) * limit + items.length < total,
    };
  }

  private async isFreeTalkSession(sessionId: string): Promise<boolean> {
    const session = await this.repo.findOne({
      where: { id: sessionId },
      select: ['id', 'mode'],
    }).catch(() => null);
    return session?.mode === 'free_talk';
  }

  private async triggerConsolidation(userId: string, sessionId: string) {
    console.log(`[Consolidation] ── triggering ───────────────────────`);
    console.log(`[Consolidation]   user    : ${userId}`);
    console.log(`[Consolidation]   session : ${sessionId}`);
    const user = await this.userService.findById(userId).catch(() => null);
    const userTimezone = user?.timezone || 'UTC';
    console.log(`[Consolidation]   timezone: ${userTimezone}`);
    try {
      const res = await firstValueFrom(
        this.http.post(`${this.cfg.get('MEMORY_SERVICE_URL')}/consolidate/${userId}`, {
          session_id: sessionId,
          user_timezone: userTimezone,
        }),
      );
      console.log(`[Consolidation] queued → memory-service responded:`, res.data);
    } catch (err: any) {
      console.error(`[Consolidation] ✖ failed to queue — memory-service unreachable:`, err?.message);
    }
  }
}
