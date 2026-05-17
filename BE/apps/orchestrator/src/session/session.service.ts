import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, LessThan } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Session } from './entities/session.entity';

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(Session) private repo: Repository<Session>,
    private http: HttpService,
    private cfg: ConfigService,
  ) {}

  async countTodaySessions(userId: string): Promise<number> {
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    return this.repo.count({ where: { userId, startedAt: MoreThanOrEqual(todayMidnight) } });
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

  async start(userId: string) {
    const billingUrl = this.cfg.get<string>('BILLING_SERVICE_URL');
    let limits = { is_unlimited: false, daily_session_limit: 10, session_token_limit: 30000 };
    try {
      const { data } = await firstValueFrom(
        this.http.get<any>(`${billingUrl}/internal/limits/${userId}`),
      );
      limits = data;
    } catch { /* fail open if billing unreachable */ }

    if (!limits.is_unlimited) {
      const todayCount = await this.countTodaySessions(userId);
      if (todayCount >= limits.daily_session_limit) {
        throw new HttpException(
          { error: 'SESSION_LIMIT_REACHED', limit: limits.daily_session_limit, used: todayCount },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
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

    const session = this.repo.create({ userId, status: 'active' });
    await this.repo.save(session);

    // First-session detection: preserve refresh/orphan behavior. If the only
    // prior row was an active orphan and no session has ever ended, this is still
    // the first real speaking session.
    const isFirstSession = sessionsBeforeStart === 0
      || (
        sessionsBeforeStart === 1
        && completedOrAbandonedBefore === 0
        && (onlySessionBeforeStart?.totalTokens ?? 0) === 0
      );

    // Fire-and-forget: record session start in billing analytics
    firstValueFrom(
      this.http.post(`${billingUrl}/internal/usage/increment-session`, { user_id: userId }),
    ).catch((err) => console.error('[Session] failed to increment session count in billing:', err?.message));

    return { session_id: session.id, is_first_session: isFirstSession };
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
    // Trigger consolidation async — fire and forget
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
   */
  async generateClosingMessage(
    userId: string,
    sessionId: string,
  ): Promise<{ text: string; audio_b64: string | null }> {
    // Fetch all context in parallel — saves 2-4s vs sequential calls
    const [insight, recentContext] = await Promise.all([
      this.getSessionInsight(userId),
      this.getGreetingContext(userId),
    ]);

    const struggled  = insight?.struggled_with ?? null;
    const nextChall  = insight?.next_challenge ?? null;

    const prompt = [
      `You are an AI speaking coach. The user has just ended today's speaking session.`,
      `Write a SHORT (3-4 sentences) closing message in a warm, coach-like tone.`,
      ``,
      `Rules:`,
      `1. Acknowledge one SPECIFIC thing the user practiced today (infer from context if available).`,
      `2. Mention ONE concrete thing to improve next time.`,
      `3. Tease the next session briefly.`,
      `4. End with a natural sign-off like "See you next time!" or "Talk soon."`,
      `5. NO emojis. NO generic openers like "Great job!". Start directly.`,
      `6. Maximum 4 sentences.`,
      ``,
      struggled ? `What they struggled with today: ${struggled}` : '',
      nextChall  ? `Recommended challenge for next time: ${nextChall}` : '',
      recentContext ? `\nRecent context:\n${recentContext.slice(0, 600)}` : '',
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
    const payload = {
      query: 'recent conversation context',
      session_id: '',
      limit: 3,
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
      const context = chunks.map((c) => c.text).join('\n');
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

  async list(userId: string, page: number, limit: number) {
    const [items, total] = await this.repo.findAndCount({
      where: { userId, isArchived: false },
      order: { startedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      select: ['id', 'title', 'status', 'startedAt'],
    });
    return { items, total, page, limit, hasMore: (page - 1) * limit + items.length < total };
  }

  private async triggerConsolidation(userId: string, sessionId: string) {
    console.log(`[Consolidation] ── triggering ───────────────────────`);
    console.log(`[Consolidation]   user    : ${userId}`);
    console.log(`[Consolidation]   session : ${sessionId}`);
    try {
      const res = await firstValueFrom(
        this.http.post(`${this.cfg.get('MEMORY_SERVICE_URL')}/consolidate/${userId}`, {
          session_id: sessionId,
        }),
      );
      console.log(`[Consolidation] queued → memory-service responded:`, res.data);
    } catch (err: any) {
      console.error(`[Consolidation] ✖ failed to queue — memory-service unreachable:`, err?.message);
    }
  }
}
