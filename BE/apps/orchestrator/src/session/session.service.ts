import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, LessThan } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Session } from './entities/session.entity';
import { Turn } from '../turn/entities/turn.entity';
import { UserService } from '../user/user.service';

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
  constructor(
    @InjectRepository(Session) private repo: Repository<Session>,
    @InjectRepository(Turn) private turnRepo: Repository<Turn>,
    private http: HttpService,
    private cfg: ConfigService,
    private userService: UserService,
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
    const billingUrl = this.cfg.get<string>('BILLING_SERVICE_URL');
    let limits = { is_unlimited: false, daily_session_limit: 10, session_token_limit: 30000 };
    try {
      const { data } = await firstValueFrom(
        this.http.get<any>(`${billingUrl}/internal/limits/${userId}`),
      );
      limits = data;
    } catch { /* fail open if billing unreachable */ }

    try {
      const { data } = await firstValueFrom(
        this.http.get<any>(`${billingUrl}/usage/${userId}`),
      );
      if (typeof data?.daily_session_limit === 'number') {
        limits.daily_session_limit = data.daily_session_limit;
      }
      if (typeof data?.session_token_limit === 'number') {
        limits.session_token_limit = data.session_token_limit;
      }
      if (typeof data?.is_unlimited === 'boolean') {
        limits.is_unlimited = data.is_unlimited;
      }
    } catch { /* fail open if billing usage is unreachable */ }

    // Daily quota is measured strictly against sessions started today (in the
    // user's timezone). Billing's sessions_used is a *monthly* cumulative count
    // for analytics — mixing it in here blocked the user for the rest of the
    // month once they hit 10, instead of resetting each day.
    const sessionsUsed = await this.countTodaySessions(userId);
    return {
      is_unlimited: limits.is_unlimited,
      daily_session_limit: limits.daily_session_limit,
      session_token_limit: limits.session_token_limit,
      sessions_used: sessionsUsed,
      can_start: limits.is_unlimited || sessionsUsed < limits.daily_session_limit,
      is_first_session: await this.isFirstSession(userId),
    };
  }

  /**
   * Returns true for pre-session onboarding greetings.
   * A single active orphan can happen on refresh before the user really speaks;
   * keep that as onboarding. Any ended session means they are returning.
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
    return total === 0 || (
      total === 1
      && completedOrAbandoned === 0
      && (onlySession?.totalTokens ?? 0) === 0
    );
  }

  /**
   * Returns true when the given session is the user's first session ever.
   * Preferred over isFirstSession when a sessionId is in hand (greeting tied to id,
   * turn routing) because it's stable across orphaned-session edge cases.
   */
  async isOnboardingSession(userId: string, sessionId: string): Promise<boolean> {
    if (!sessionId) return false;
    const session = await this.repo.findOne({ where: { id: sessionId, userId } });
    if (!session) return false;
    const earlier = await this.repo.count({
      where: { userId, startedAt: LessThan(session.startedAt) },
    });
    return earlier === 0;
  }

  async start(userId: string, mode: 'guided_learning' | 'free_talk' = 'guided_learning') {
    const billingUrl = this.cfg.get<string>('BILLING_SERVICE_URL');
    const quota = await this.getQuota(userId);

    if (!quota.is_unlimited && !quota.can_start) {
      throw new HttpException(
        { error: 'SESSION_LIMIT_REACHED', limit: quota.daily_session_limit, used: quota.sessions_used },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const [sessionsBeforeStart, completedOrAbandonedBefore, onlySessionBeforeStart] = await Promise.all([
      this.repo.count({ where: { userId } }),
      this.repo.count({ where: [{ userId, status: 'ended' }, { userId, status: 'abandoned' }] }),
      this.repo.findOne({
        where: { userId },
        order: { startedAt: 'ASC' },
        select: ['id', 'status', 'totalTokens'],
      }),
    ]);

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
    // prior row was an active orphan and no session has ever ended, this is still
    // the first real speaking session.
    const isFirstSession = sessionsBeforeStart === 0
      || (
        sessionsBeforeStart === 1
        && completedOrAbandonedBefore === 0
        && (onlySessionBeforeStart?.totalTokens ?? 0) === 0
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

    // Fire-and-forget: record session start in billing analytics
    firstValueFrom(
      this.http.post(`${billingUrl}/internal/usage/increment-session`, { user_id: userId }),
    ).catch((err) => console.error('[Session] failed to increment session count in billing:', err?.message));

    // Deck generation only applies to guided learning. Free Talk skips entirely.
    if (effectiveMode === 'guided_learning') {
      this.generateDeckAfterStart(userId, session.id, isFirstSession).catch(console.error);
    } else {
      console.log(`[Session] mode=free_talk session=${session.id} → skipping deck generation`);
    }

    return { session_id: session.id, is_first_session: isFirstSession, mode: effectiveMode };
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
    await this.repo.update(
      { id: sessionId, userId },
      { status: newStatus, endedAt: new Date(), endReason: reason },
    );

    // Phase 6 — mark deck with the right end_reason BEFORE consolidation, so
    // the deck blob in Redis reflects how the session ended. mark_deck_ended
    // is idempotent and a no-op when no deck exists.
    const deckEndReason = mapSessionReasonToDeckEnd(reason);
    await this.endDeck(sessionId, deckEndReason);

    // Trigger consolidation async — fire and forget. Consolidation reads the
    // deck blob itself (rather than us passing the whole thing through HTTP)
    // so it always sees the freshly-stamped end_reason.
    this.triggerConsolidation(userId, sessionId).catch(console.error);
    return { session_id: sessionId, status: newStatus, reason };
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

  private async generateDeckAfterStart(userId: string, sessionId: string, isFirstSession: boolean): Promise<void> {
    const [user, insight, todayChallenge] = await Promise.all([
      this.userService.findById(userId).catch(() => null),
      this.getSessionInsight(userId),
      this.getTodayChallenge(userId),
    ]);
    const activeMission = [
      todayChallenge,
      typeof insight?.active_mission === 'string' ? insight.active_mission.trim() : '',
      typeof insight?.next_challenge === 'string' ? insight.next_challenge.trim() : '',
    ].find(Boolean) ?? null;
    await this.generateDeck(userId, sessionId, user, insight, activeMission, isFirstSession);
  }

  async regenerateDeckFromTopic(userId: string, sessionId: string, topic: string): Promise<void> {
    const [user, insight] = await Promise.all([
      this.userService.findById(userId).catch(() => null),
      this.getSessionInsight(userId),
    ]);
    const mission = topic.trim();
    await this.generateDeck(userId, sessionId, user, { ...insight, recommended_next_mode: null }, mission, false);
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
    const memoryUrl = this.cfg.get('MEMORY_SERVICE_URL');
    const llmUrl    = this.cfg.get('LLM_GATEWAY_URL');

    const sessionType = await this.getSessionType(userId, isOnboarding);

    // Mission priority: active_mission > session_insight > fallback
    let mission: string;
    let missionSource: string;
    let reason: string;
    if (activeMission) {
      mission       = activeMission;
      missionSource = 'active_mission';
      reason        = "Set as today's active mission";
    } else if (insight?.next_challenge) {
      mission       = insight.next_challenge;
      missionSource = 'session_insight';
      reason        = insight.struggled_with
        ? `Last session you struggled with: ${insight.struggled_with}`
        : 'Recommended from your previous session';
    } else {
      mission       = `Practice speaking ${user?.targetLanguage ?? 'English'} clearly and confidently`;
      missionSource = 'fallback';
      reason        = 'General speaking practice to build confidence';
    }

    console.log(`[Deck] ── generateDeck ─────────────────────────────`);
    console.log(`[Deck]   session     : ${sessionId}`);
    console.log(`[Deck]   sessionType : ${sessionType}`);
    console.log(`[Deck]   mission     : ${mission}`);
    console.log(`[Deck]   missionSrc  : ${missionSource}`);

    let cards: any[];
    let isContinuation = false;

    if (sessionType === 'onboarding_diagnostic') {
      cards = this.buildOnboardingCards(user);
    } else if (
      insight?.recommended_next_mode === 'resume_deck' &&
      Array.isArray(insight?.unfinished_deck_cards) &&
      insight.unfinished_deck_cards.length > 0
    ) {
      // Continuation deck: rebuild cards from the unfinished cards of the last session.
      // Reset each card to not_started so the user can retry them.
      cards = insight.unfinished_deck_cards.map((c: any, i: number) => ({
        id:                       `card-${i + 1}`,
        type:                     c.type ?? 'real_situation',
        title:                    c.title,
        task:                     c.task,
        success_criteria:         c.success_criteria ?? [],
        expected_duration_seconds: c.expected_duration_seconds ?? 60,
        retry_allowed:            true,
        status:                   'not_started',
        attempts:                 0,
        result:                   null,
        feedback:                 null,
        ui_hint:                  null,
      }));
      mission       = (insight.deck_mission || mission).trim();
      missionSource = 'continuation';
      reason        = 'Resuming exercises you skipped in your last session';
      isContinuation = true;
      console.log(`[Deck]   continuation: ${cards.length} unfinished cards from last session`);
    } else {
      // Lighter deck for low energy or if memory recommends it
      const isLightDeck =
        insight?.energy_signal === 'low' ||
        insight?.recommended_next_mode === 'lighter_deck';
      const numCards = isLightDeck ? 3 : 4;

      // Pull the tasks from the user's most recent decks so the generator can
      // avoid handing them the same exercises again — the #1 cause of "every
      // session feels identical" when the mission stays the same for 72h.
      const avoidTasks = await this.getRecentCardTasks(userId, sessionId);
      cards = await this.generateCardsWithLLM(sessionType, mission, insight, user, numCards, llmUrl, avoidTasks);
    }

    const deck = {
      id:                  `deck-${sessionId}`,
      session_id:          sessionId,
      session_type:        sessionType,
      mission,
      mission_source:      missionSource,
      reason,
      status:              'not_started',
      current_card_index:  0,
      cards,
      end_reason:          null,
      is_continuation:     isContinuation,
    };

    try {
      await firstValueFrom(this.http.post(`${memoryUrl}/exercise-deck/${sessionId}`, deck));
      console.log(`[Deck] ✓ saved  session=${sessionId}  type=${sessionType}  cards=${cards.length}`);
    } catch (err: any) {
      console.error(`[Deck] ✖ save failed  session=${sessionId}:`, err?.message);
    }
  }

  private buildOnboardingCards(user: any): any[] {
    const goal = user?.learningGoal
      ? `improve your ${user.targetLanguage ?? 'English'} — specifically: ${user.learningGoal}`
      : `improve your ${user?.targetLanguage ?? 'English'} speaking`;
    return [
      {
        id: 'card-1',
        type: 'baseline_answer',
        title: 'Say it simply',
        task: `Tell me why you want to ${goal} in 1-2 sentences.`,
        success_criteria: ['user gives understandable answer', 'user speaks in target language'],
        expected_duration_seconds: 45,
        retry_allowed: true,
        status: 'not_started',
        attempts: 0,
        result: null,
        feedback: null,
        ui_hint: null,
      },
      {
        id: 'card-2',
        type: 'mini_challenge',
        title: 'Tiny speaking test',
        task: 'Describe one simple idea or recent plan in 2 sentences.',
        success_criteria: ['meaning is clear', 'user attempts simple English'],
        expected_duration_seconds: 60,
        retry_allowed: true,
        status: 'not_started',
        attempts: 0,
        result: null,
        feedback: null,
        ui_hint: null,
      },
    ];
  }

  /**
   * Collect the exercise tasks from the user's last couple of decks so the card
   * generator can steer away from repeating them. Best-effort: any failure just
   * yields an empty list (generation proceeds without the avoid-hint).
   */
  private async getRecentCardTasks(userId: string, currentSessionId: string, maxTasks = 8): Promise<string[]> {
    try {
      const recent = await this.repo.find({
        where: [{ userId, status: 'ended' }, { userId, status: 'abandoned' }],
        order: { startedAt: 'DESC' },
        take: 2,
        select: ['id'],
      });
      const tasks: string[] = [];
      for (const s of recent) {
        if (s.id === currentSessionId) continue;
        const deck = await this.getDeck(s.id).catch(() => null);
        const cards = Array.isArray(deck?.cards) ? deck.cards : [];
        for (const c of cards) {
          const t = (c?.task || '').trim();
          if (t) tasks.push(t);
        }
      }
      return [...new Set(tasks)].slice(0, maxTasks);
    } catch (err: any) {
      console.error(`[Deck] getRecentCardTasks failed user=${userId}:`, err?.message);
      return [];
    }
  }

  private async generateCardsWithLLM(
    sessionType: string,
    mission: string,
    insight: any,
    user: any,
    numCards: number,
    llmUrl: string,
    avoidTasks: string[] = [],
  ): Promise<any[]> {
    const cardPool = [
      { type: 'simple_explanation', desc: 'Warm-up: ask user to explain a basic concept from the mission simply (30-45 sec)' },
      { type: 'opinion',            desc: 'Ask user to state and briefly support an opinion on the mission topic (45 sec)' },
      { type: 'storytelling',       desc: 'Ask user to share a short personal story or anecdote related to the mission (45 sec)' },
      { type: 'comparison',         desc: 'Ask user to compare two things, approaches, or ideas from the mission (45-60 sec)' },
      { type: 'roleplay',           desc: 'Set up a realistic dialogue scenario; user plays one role and must respond naturally (60 sec)' },
      { type: 'real_situation',     desc: 'Give a specific real-life context; user responds as themselves (60 sec)' },
      { type: 'weakness_drill',     desc: 'Targeted drill on a specific weakness from last session or common sticking point (45-60 sec)' },
      { type: 'scenario_response',  desc: 'Surprise the user with an unexpected question or situation and ask them to respond on the spot (45 sec)' },
      { type: 'paraphrase',         desc: 'Give user a sentence or idea; ask them to say the same thing in a completely different way (30-45 sec)' },
      { type: 'vocabulary_in_context', desc: 'Give 3 specific words or phrases; user must use all 3 naturally in connected sentences (45 sec)' },
      { type: 'final_boss',         desc: 'Extended free speech: user synthesizes everything practiced today — must say "speak for 60 seconds" (60-90 sec). ALWAYS the last card.' },
    ];

    const poolDesc = cardPool.map(c => `- ${c.type}: ${c.desc}`).join('\n');

    const avoidBlock = avoidTasks.length
      ? `RECENT TASKS TO AVOID — the user already practiced these in their last session(s). ` +
        `Do NOT reuse, translate, or closely paraphrase any of them; invent clearly different scenarios this time:\n` +
        avoidTasks.map((t) => `- ${t}`).join('\n')
      : '';

    const contextLines = [
      insight?.struggled_with     ? `Struggled with last session: ${insight.struggled_with}`    : '',
      insight?.improved_vs_before ? `Improved on: ${insight.improved_vs_before}`                : '',
      insight?.energy_signal      ? `Energy level: ${insight.energy_signal}`                    : '',
    ].filter(Boolean).join('\n');

    const systemPrompt = [
      `You are an exercise deck planner for a language coaching app.`,
      `Choose and generate exactly ${numCards} speaking exercise cards from the pool below.`,
      ``,
      `Session type: ${sessionType}`,
      `Mission (your INTERNAL coaching goal — never quote or copy it into a task): "${mission}"`,
      `User level: ${user?.level ?? 'beginner'}`,
      `Target language: ${user?.targetLanguage ?? 'English'}`,
      `Native language: ${user?.nativeLanguage ?? 'Vietnamese'}`,
      contextLines ? `Context from last session:\n${contextLines}` : '',
      ``,
      `CARD TYPE POOL — choose the best combination for this mission:`,
      poolDesc,
      ``,
      `SELECTION RULES:`,
      `- Card 1: must be a gentle warm-up (simple_explanation, opinion, or storytelling).`,
      `- Card ${numCards} (last): MUST be final_boss.`,
      `- Middle cards: pick whichever types fit best — vary them, do NOT default to the same pattern each time.`,
      `- Do NOT repeat types unless the pool has no other fit.`,
      `- Match the type to the mission theme: roleplay fits job/social scenarios, storytelling fits personal growth, comparison fits cultural topics, vocabulary_in_context fits language-focused missions, scenario_response fits quick-thinking practice, etc.`,
      ``,
      `CONTENT RULES:`,
      `- Each task: 1-2 clear sentences, specific to the mission — no generic filler.`,
      `- Write every task as a DIRECT instruction TO the learner in second person ("Tell me about...", "Describe a time when...", "Explain how you..."). NEVER phrase it as an instruction ABOUT the learner ("Encourage the user to...", "Ask the user to...", "Get them to...") and never copy the Mission wording verbatim — the Mission is your goal, the task is what the learner actually does.`,
      `- The ${numCards} tasks MUST each cover a DISTINCT scenario or angle. No two cards may ask essentially the same thing or reuse one prompt with minor wording changes.`,
      `- Every task must be SELF-CONTAINED: name the concrete subject explicitly. Never write a vague task like "explain this" or "describe it" with no referent.`,
      `- final_boss task must explicitly say "speak for 60 seconds".`,
      `- Success criteria: 2-3 short measurable statements. Be forgiving — clear meaning counts.`,
      `- Title: 4 words max.`,
      ``,
      avoidBlock,
      ``,
      `Return ONLY a valid JSON array, no markdown fences:`,
      `[{"id":"card-1","type":"<chosen_type>","title":"<title>","task":"<task>","success_criteria":["<c1>","<c2>"],"expected_duration_seconds":<n>,"retry_allowed":true,"status":"not_started","attempts":0,"result":null,"feedback":null,"ui_hint":null}]`,
    ].filter((s) => s !== '').join('\n');

    const fallbackTypes = numCards === 3
      ? ['simple_explanation', 'real_situation', 'final_boss']
      : ['simple_explanation', 'weakness_drill', 'real_situation', 'final_boss'];

    try {
      const res = await firstValueFrom(
        this.http.post(`${llmUrl}/complete`, {
          system: systemPrompt,
          messages: [{ role: 'user', content: `Generate ${numCards} exercise cards for mission: "${mission}"` }],
        }),
      );
      let text: string = res.data?.response_text ?? res.data?.text ?? '';
      if (text) {
        text = text.replace(/```json\n?|\n?```/g, '').trim();
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log(`[Deck] LLM generated ${parsed.length} cards  types=${parsed.map((c: any) => c.type).join(',')}  session=${sessionType}`);
            return parsed.map((card: any, i: number) => ({
              id:                        card.id ?? `card-${i + 1}`,
              type:                      card.type ?? fallbackTypes[i] ?? 'simple_explanation',
              title:                     card.title ?? 'Exercise',
              task:                      card.task ?? 'Practice speaking clearly.',
              success_criteria:          Array.isArray(card.success_criteria) ? card.success_criteria
                                       : Array.isArray(card.successCriteria)  ? card.successCriteria
                                       : ['meaning is clear'],
              expected_duration_seconds: card.expected_duration_seconds ?? card.expectedDurationSeconds ?? 60,
              retry_allowed:             card.retry_allowed ?? card.retryAllowed ?? true,
              status:                    'not_started',
              attempts:                  0,
              result:                    null,
              feedback:                  null,
              ui_hint:                   card.ui_hint ?? card.uiHint ?? null,
            }));
          }
        }
      }
    } catch (err: any) {
      console.error(`[Deck] LLM card generation failed:`, err?.message);
    }

    console.log(`[Deck] using fallback cards for mission="${mission.slice(0, 50)}"`);
    return this.buildFallbackCards(mission, fallbackTypes);
  }

  /**
   * Turn a mission (which is phrased as an instruction to the COACH, e.g.
   * "Encourage the user to describe a moment with their dog") into a learner-facing
   * goal phrase ("describe a moment with your dog") that slots cleanly into a task
   * sentence. Best-effort string surgery — used only by the deterministic fallback.
   */
  private missionToLearnerGoal(mission: string): string {
    let t = (mission || '').trim();
    // Drop the leading coach-directive so what remains is what the learner does.
    t = t.replace(
      /^(encourage|ask|get|help|guide|prompt|invite|have|push|tell|remind)\s+(the\s+)?(user|learner|student|them)\s+(to\s+|into\s+|about\s+)?/i,
      '',
    );
    // Flip third-person references to second person.
    t = t.replace(/\btheir\b/gi, 'your').replace(/\bthem\b/gi, 'you').replace(/\bthemselves\b/gi, 'yourself');
    t = t.replace(/[\s.,;:]+$/, '').trim();
    if (t) t = t.charAt(0).toLowerCase() + t.slice(1);
    return t || 'talk about something that matters to you';
  }

  private buildFallbackCards(mission: string, cardTypes: string[]): any[] {
    const goal = this.missionToLearnerGoal(mission);
    const goalCap = goal.charAt(0).toUpperCase() + goal.slice(1);
    const templates: Record<string, any> = {
      simple_explanation: {
        title: 'Start simple',
        task: `In 2 sentences, ${goal}.`,
        success_criteria: ['meaning is clear', 'uses simple English', 'no long pause'],
        expected_duration_seconds: 45,
      },
      weakness_drill: {
        title: 'Drill it',
        task: `Now ${goal} again, using different and simpler words.`,
        success_criteria: ['uses different vocabulary', 'explanation is clear'],
        expected_duration_seconds: 60,
      },
      real_situation: {
        title: 'Real situation',
        task: `${goalCap}, as if you are explaining it to someone who knows nothing about it.`,
        success_criteria: ['explains clearly for a new listener', 'uses relatable language'],
        expected_duration_seconds: 60,
      },
      final_boss: {
        title: 'Final boss',
        task: `Speak for 60 seconds: ${goal}, with as much detail as you can.`,
        success_criteria: ['speaks for at least 45 seconds', 'covers the main idea', 'mostly target language'],
        expected_duration_seconds: 90,
      },
    };

    return cardTypes.map((type, i) => {
      const t = templates[type] ?? templates['simple_explanation'];
      return { id: `card-${i + 1}`, type, ...t, retry_allowed: true, status: 'not_started', attempts: 0, result: null, feedback: null, ui_hint: null };
    });
  }

  async getDeck(sessionId: string): Promise<any> {
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
        select: ['id', 'breakdown', 'mode', 'startedAt', 'endedAt'],
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
      return { ...session.breakdown, mode: session.mode };
    } catch (err: any) {
      console.error(`[Session] getEvaluation failed session=${sessionId}:`, err?.message);
      return { status: 'pending', session_id: sessionId };
    }
  }

  async advanceDeck(sessionId: string): Promise<any> {
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
      select: ['id', 'title', 'status', 'startedAt', 'mode'],
    });
    return { items, total, page, limit, hasMore: (page - 1) * limit + items.length < total };
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
