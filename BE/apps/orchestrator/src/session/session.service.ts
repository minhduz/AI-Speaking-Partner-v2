import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, LessThan } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Session } from './entities/session.entity';
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
    private http: HttpService,
    private cfg: ConfigService,
    private userService: UserService,
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

    // Fire-and-forget deck generation after session is created
    this.generateDeckAfterStart(userId, session.id, isFirstSession).catch(console.error);

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
    // Fetch all context in parallel — saves 2-4s vs sequential calls
    const [insight, recentContext, deck, user] = await Promise.all([
      this.getSessionInsight(userId),
      this.getGreetingContext(userId),
      this.getDeck(sessionId).catch(() => null),
      this.userService.findById(userId).catch(() => null),
    ]);

    const struggled  = insight?.struggled_with ?? null;
    const nextChall  = insight?.next_challenge ?? null;
    const firstName  = (user?.name ?? '').trim().split(/\s+/)[0] || '';

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
      `7. Never say "failed" or "incomplete" — use "paused", "continue next time", "still working on".`,
      ``,
      deckBlock,
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

    if (sessionType === 'onboarding_diagnostic') {
      cards = this.buildOnboardingCards(user);
    } else {
      // Lighter deck for low energy or if memory recommends it
      const isLightDeck =
        insight?.energy_signal === 'low' ||
        insight?.recommended_next_mode === 'lighter_deck';
      const cardTypes = isLightDeck
        ? ['simple_explanation', 'weakness_drill', 'real_situation']
        : ['simple_explanation', 'weakness_drill', 'real_situation', 'final_boss'];

      cards = await this.generateCardsWithLLM(sessionType, mission, insight, user, cardTypes, llmUrl);
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

  private async generateCardsWithLLM(
    sessionType: string,
    mission: string,
    insight: any,
    user: any,
    cardTypes: string[],
    llmUrl: string,
  ): Promise<any[]> {
    const typeDescriptions: Record<string, string> = {
      simple_explanation: 'warm-up, simple and achievable, builds momentum (30-45 sec)',
      weakness_drill:     'targets specific weakness from last session (45-60 sec)',
      real_situation:     'applies the skill in a real, natural context (60 sec)',
      final_boss:         'extended 60-second synthesizing response (60-90 sec)',
    };

    const contextLines = [
      insight?.struggled_with    ? `Struggled with last session: ${insight.struggled_with}`    : '',
      insight?.improved_vs_before ? `Improved on: ${insight.improved_vs_before}`               : '',
      insight?.energy_signal     ? `Energy level: ${insight.energy_signal}`                    : '',
    ].filter(Boolean).join('\n');

    const typesList = cardTypes
      .map((t, i) => `${i + 1}. ${t} — ${typeDescriptions[t] ?? t}`)
      .join('\n');

    const systemPrompt = [
      `You are an exercise deck planner for a language coaching app.`,
      `Generate exactly ${cardTypes.length} speaking exercise cards.`,
      ``,
      `Session type: ${sessionType}`,
      `Mission: "${mission}"`,
      `User level: ${user?.level ?? 'beginner'}`,
      `Target language: ${user?.targetLanguage ?? 'English'}`,
      `Native language: ${user?.nativeLanguage ?? 'Vietnamese'}`,
      contextLines ? `Context:\n${contextLines}` : '',
      ``,
      `Generate cards in this exact order:`,
      typesList,
      ``,
      `Rules:`,
      `- Each task: 1-2 clear sentences, specific to the mission — not generic.`,
      `- Final boss task must explicitly ask user to speak for 60 seconds.`,
      `- Success criteria: 2-3 short measurable statements. Be forgiving — clear meaning counts.`,
      `- Title: 4 words max.`,
      ``,
      `Return ONLY a valid JSON array, no markdown:`,
      `[{"id":"card-1","type":"<type>","title":"<title>","task":"<task>","success_criteria":["<c1>","<c2>"],"expected_duration_seconds":<n>,"retry_allowed":true,"status":"not_started","attempts":0,"result":null,"feedback":null,"ui_hint":null}]`,
    ].filter((s) => s !== '').join('\n');

    try {
      const res = await firstValueFrom(
        this.http.post(`${llmUrl}/complete`, {
          system: systemPrompt,
          messages: [{ role: 'user', content: `Generate ${cardTypes.length} exercise cards for mission: "${mission}"` }],
        }),
      );
      let text: string = res.data?.response_text ?? res.data?.text ?? '';
      if (text) {
        text = text.replace(/```json\n?|\n?```/g, '').trim();
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log(`[Deck] LLM generated ${parsed.length} cards for session type=${sessionType}`);
            return parsed.map((card: any, i: number) => ({
              id:                       card.id ?? `card-${i + 1}`,
              type:                     card.type ?? cardTypes[i],
              title:                    card.title ?? 'Exercise',
              task:                     card.task ?? 'Practice speaking clearly.',
              success_criteria:         Array.isArray(card.success_criteria) ? card.success_criteria
                                      : Array.isArray(card.successCriteria)  ? card.successCriteria
                                      : ['meaning is clear'],
              expected_duration_seconds: card.expected_duration_seconds ?? card.expectedDurationSeconds ?? 60,
              retry_allowed:            card.retry_allowed ?? card.retryAllowed ?? true,
              status:                   'not_started',
              attempts:                 0,
              result:                   null,
              feedback:                 null,
              ui_hint:                  card.ui_hint ?? card.uiHint ?? null,
            }));
          }
        }
      }
    } catch (err: any) {
      console.error(`[Deck] LLM card generation failed:`, err?.message);
    }

    console.log(`[Deck] using fallback cards for mission="${mission.slice(0, 50)}"`);
    return this.buildFallbackCards(mission, cardTypes);
  }

  private buildFallbackCards(mission: string, cardTypes: string[]): any[] {
    const shortMission = mission.slice(0, 60);
    const templates: Record<string, any> = {
      simple_explanation: {
        title: 'Start simple',
        task: `Describe your idea about "${shortMission}" in 2 sentences.`,
        success_criteria: ['meaning is clear', 'uses simple English', 'no long pause'],
        expected_duration_seconds: 45,
      },
      weakness_drill: {
        title: 'Drill it',
        task: 'Explain the same idea using different words and simpler English.',
        success_criteria: ['uses different vocabulary', 'explanation is clear'],
        expected_duration_seconds: 60,
      },
      real_situation: {
        title: 'Real situation',
        task: 'How would you explain this to someone who knows nothing about it?',
        success_criteria: ['explains clearly for a new listener', 'uses relatable language'],
        expected_duration_seconds: 60,
      },
      final_boss: {
        title: 'Final boss',
        task: `Speak for 60 seconds about everything you practiced related to: "${shortMission}".`,
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
