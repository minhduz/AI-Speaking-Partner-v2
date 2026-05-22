import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Turn } from './entities/turn.entity';
import { Session } from '../session/entities/session.entity';
import { UserService } from '../user/user.service';
import { User } from '../user/entities/user.entity';
import { SessionService } from '../session/session.service';
import { normalizeVoiceId } from '../user/voice-options';

function getCurrentDatetime(timezone: string, date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return date.toUTCString();
  }
}

function buildActiveMissionBlock(activeMission: string | null): string {
  if (!activeMission) return '';
  return [
    '',
    'ACTIVE SESSION MISSION (override everything else):',
    `"${activeMission}"`,
    'Stay on this mission. If the user drifts, redirect gently.',
    'Do NOT switch to any other challenge or topic from memory.',
    'This mission has absolute priority over previous-session challenges.',
  ].join('\n');
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getErrorResponse(err: unknown): { status?: unknown; data?: unknown } | undefined {
  if (typeof err !== 'object' || err === null || !('response' in err)) return undefined;
  const response = (err as { response?: unknown }).response;
  return typeof response === 'object' && response !== null
    ? response as { status?: unknown; data?: unknown }
    : undefined;
}

@Injectable()
export class TurnService {
  constructor(
    @InjectRepository(Turn) private readonly turnRepo: Repository<Turn>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    private readonly http: HttpService,
    private readonly cfg: ConfigService,
    private readonly userService: UserService,
    @Inject(forwardRef(() => SessionService))
    private readonly sessionService: SessionService,
  ) {}

  async getBySession(sessionId: string, userId: string, page = 1, limit = 20) {
    const [turns, total] = await this.turnRepo.findAndCount({
      where: { sessionId, userId },
      order: { turnIndex: 'DESC' },  // newest first — FE reverses for display
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      items: turns.map((t) => ({
        id: t.id,
        turnIndex: t.turnIndex,
        transcript: t.data?.transcript ?? '',
        responseText: t.data?.response_text ?? '',
        pronunciationScore: t.data?.pronunciation?.score ?? null,
        createdAt: t.createdAt,
      })),
      total,
      page,
      hasMore: page * limit < total,
    };
  }

  async getUserEntity(userId: string): Promise<User | null> {
    try { return await this.userService.findById(userId); } catch { return null; }
  }

  async getTurnIndex(sessionId: string): Promise<number> {
    const count = await this.turnRepo.count({ where: { sessionId } });
    return count + 1;
  }

  async getSessionTokens(sessionId: string): Promise<number> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    return session?.totalTokens ?? 0;
  }

  async getSessionMode(sessionId: string, userId: string): Promise<'guided_learning' | 'free_talk'> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId },
      select: ['mode'],
    });
    return session?.mode === 'free_talk' ? 'free_talk' : 'guided_learning';
  }

  /**
   * Returns true when the given session is the user's first real speaking session.
   * Used by turn routing to set X-Is-Onboarding so the turn-agent only runs
   * onboarding intent extraction during the first session. Zero-turn refresh
   * orphans do not count as prior speaking sessions.
   */
  async isOnboardingSession(userId: string, sessionId: string): Promise<boolean> {
    if (!sessionId) return false;
    const session = await this.sessionRepo.findOne({ where: { id: sessionId, userId } });
    if (!session) return false;
    const earlier = await this.sessionRepo.find({
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

  async getActiveMission(userId: string): Promise<string | null> {
    const memoryUrl = this.cfg.get('MEMORY_SERVICE_URL');
    try {
      const { data } = await firstValueFrom<any>(
        this.http.get<any>(`${memoryUrl}/today-challenge/${userId}`),
      );
      const mission = data?.active_mission;
      return typeof mission === 'string' && mission.trim() ? mission.trim() : null;
    } catch (err: any) {
      console.error(`[Turn] active mission fetch failed:`, err?.message);
      return null;
    }
  }

  /**
   * Fetches the consolidated session insight (struggled_with, energy, etc.)
   * for the user. Used by the turn-agent to drive practice lead-in: once the
   * conversation has warmed up (turn 3+), the AI can reference the insight to
   * naturally propose a mission. Returns null on miss/error so callers fall
   * back to a no-insight prompt branch.
   */
  async getSessionInsight(userId: string): Promise<any | null> {
    const url = `${this.cfg.get('MEMORY_SERVICE_URL')}/session-insight/${userId}`;
    try {
      const { data } = await firstValueFrom<any>(this.http.get<any>(url));
      return data && data.has_insight ? data : null;
    } catch (err: any) {
      console.error(`[Turn] session-insight fetch failed:`, err?.message);
      return null;
    }
  }

  async getDeckInfo(sessionId: string): Promise<{
    active: boolean;
    status: string;
    end_reason: string;
    current_card_index: number;
    total_cards: number;
    current_card: any | null;
    is_continuation: boolean;
  }> {
    const empty = { active: false, status: 'none', end_reason: '', current_card_index: 0, total_cards: 0, current_card: null, is_continuation: false };
    const memoryUrl = this.cfg.get('MEMORY_SERVICE_URL');
    try {
      const { data } = await firstValueFrom<any>(
        this.http.get<any>(`${memoryUrl}/exercise-deck/${sessionId}`),
      );
      if (!data || data.status === 'none') return empty;
      const cards = Array.isArray(data.cards) ? data.cards : [];
      const idx = data.current_card_index ?? 0;
      const isActive = data.status === 'in_progress';
      return {
        active:              isActive,
        status:              data.status ?? 'none',
        end_reason:          data.end_reason ?? '',
        current_card_index:  idx,
        total_cards:         cards.length,
        current_card:        cards[idx] ?? null,
        is_continuation:     Boolean(data.is_continuation),
      };
    } catch (err: any) {
      console.error(`[Turn] getDeckInfo failed session=${sessionId}:`, err?.message);
      return empty;
    }
  }

  async processTurn(sessionId: string, userId: string, audioBuffer: Buffer, mimetype: string) {
    const started = Date.now();
    const elapsed = () => `${Date.now() - started}ms`;
    let step = 'init';

    console.log(`[Turn] ── processTurn start ──────────────────────`);
    console.log(`[Turn]   session : ${sessionId}`);
    console.log(`[Turn]   user    : ${userId}`);
    console.log(`[Turn]   audio   : ${audioBuffer.length}b  ${mimetype}`);

    try {
      // 1. Turn index + user entity (parallel)
      step = 'turn-index';
      const [turnCount, user, activeMission] = await Promise.all([
        this.turnRepo.count({ where: { sessionId } }),
        this.getUserEntity(userId),
        this.getActiveMission(userId),
      ]);
      const turnIndex = turnCount + 1;
      const currentDatetime = getCurrentDatetime(user?.timezone ?? 'UTC');
      console.log(`[Turn] [${elapsed()}] turn index: ${turnIndex}, datetime: ${currentDatetime}`);

      const speechUrl = this.cfg.get('SPEECH_SERVICE_URL');
      const memoryUrl = this.cfg.get('MEMORY_SERVICE_URL');
      const llmUrl    = this.cfg.get('LLM_GATEWAY_URL');

      // 2. STT
      step = 'stt';
      const formData = new FormData();
      formData.append('audio', new Blob([new Uint8Array(audioBuffer)], { type: mimetype }), 'audio.webm');
      const sttRes = await firstValueFrom(
        this.http.post(`${speechUrl}/stt`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        }),
      );
      const { transcript, confidence, pronunciation } = sttRes.data;
      console.log(`[Turn] [${elapsed()}] STT:`, { transcript });

      // 3. Build prompt (always query all layers — no routing LLM call)
      step = 'prompt';
      let system_prompt: string;
      try {
        const promptRes = await firstValueFrom(
          this.http.post(`${memoryUrl}/build-prompt/${userId}`, {
            query: transcript,
            session_id: sessionId,
            user_level: user?.level ?? 'beginner',
            target_language: user?.targetLanguage ?? 'english',
            user_name: (user?.name ?? '').trim().split(/\s+/)[0] ?? '',
            native_language: user?.nativeLanguage ?? 'vietnamese',
            learning_goal: user?.learningGoal ?? '',
            current_datetime: currentDatetime,
            layers: ['short_term', 'long_term', 'urgent'],
          }),
        );
        system_prompt = promptRes.data.system_prompt;
        system_prompt += buildActiveMissionBlock(activeMission);
        console.log(`[Turn] [${elapsed()}] system_prompt length: ${system_prompt?.length ?? 0} chars`);
      } catch {
        system_prompt = `You are a warm, friendly AI companion. Speak only in ${user?.targetLanguage ?? 'English'} in every user-visible sentence. If the user uses their native language, understand it silently but do not mirror it. Today is ${currentDatetime}.`;
        system_prompt += buildActiveMissionBlock(activeMission);
      }

      // 4. LLM complete
      step = 'llm';
      const llmRes = await firstValueFrom(
        this.http.post(`${llmUrl}/complete`, {
          system: system_prompt,
          messages: [{ role: 'user', content: transcript }],
        }),
      );
      const { response_text, tokens_used, provider } = llmRes.data;
      console.log(`[Turn] [${elapsed()}] LLM:`, { provider, tokens_used, preview: response_text?.slice(0, 80) });

      // 5. TTS
      step = 'tts';
      const ttsRes = await firstValueFrom(
        this.http.post(`${speechUrl}/tts`, {
          text: response_text,
          voice: normalizeVoiceId(user?.voiceId),
          speech_rate: user?.speechRate ?? 1.0,
        }),
      );
      const { audio_b64 } = ttsRes.data;

      // 6. Persist
      step = 'persist';
      const turn = this.turnRepo.create({
        sessionId, userId, turnIndex,
        tokensUsed: tokens_used,
        data: { transcript, response_text, confidence, pronunciation, tokens_used },
      });
      await this.turnRepo.save(turn);
      console.log(`[Turn] [${elapsed()}] persisted — turn_id: ${turn.id}`);

      // 7. Async side-effects
      this.updateSessionTotals(sessionId, tokens_used, pronunciation?.score ?? 0).catch(console.error);
      this.appendToShortTerm(sessionId, userId, transcript, response_text).catch(console.error);
      this.recordUsage(userId, tokens_used).catch(console.error);
      this.sessionService.updateLastActivity(sessionId, userId).catch(console.error);
      if (turnIndex === 1) this.generateTitle(sessionId, transcript).catch(console.error);

      console.log(`[Turn] ── processTurn done (${elapsed()}) ────────────────`);
      return { turn_id: turn.id, transcript, confidence, pronunciation, response_text, audio_b64, tokens_used };

    } catch (err: unknown) {
      const response = getErrorResponse(err);
      console.error(`[Turn] ✖ FAILED at step "${step}" (${elapsed()}):`, getErrorMessage(err));
      if (response) {
        console.error(`[Turn]   upstream status :`, response.status);
        console.error(`[Turn]   upstream body   :`, JSON.stringify(response.data ?? '').slice(0, 300));
      }
      throw err;
    }
  }

  async persistStreamedTurn(
    sessionId: string,
    userId: string,
    turnIndex: number,
    data: { transcript: string; confidence: number; pronunciation: any; response_text: string; tokens_used: number },
  ) {
    const turn = this.turnRepo.create({ sessionId, userId, turnIndex, tokensUsed: data.tokens_used, data });
    await this.turnRepo.save(turn);
    this.updateSessionTotals(sessionId, data.tokens_used, data.pronunciation?.score ?? 0).catch(console.error);
    this.appendToShortTerm(sessionId, userId, data.transcript, data.response_text).catch(console.error);
    this.recordUsage(userId, data.tokens_used).catch(console.error);
    this.sessionService.updateLastActivity(sessionId, userId).catch(console.error);
    if (turnIndex === 1) this.generateTitle(sessionId, data.transcript).catch(console.error);
    return turn;
  }

  private async updateSessionTotals(sessionId: string, tokens: number, score: number) {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) return;
    const turns = await this.turnRepo.count({ where: { sessionId } });
    const newAvg = ((session.avgPronunciationScore * (turns - 1)) + score) / turns;
    await this.sessionRepo.update(sessionId, {
      totalTokens: session.totalTokens + tokens,
      avgPronunciationScore: Math.round(newAvg * 1000) / 1000,
    });
  }

  private async appendToShortTerm(sessionId: string, userId: string, userMsg: string, aiMsg: string) {
    const memUrl = this.cfg.get('MEMORY_SERVICE_URL');
    try {
      await firstValueFrom(
        this.http.post(`${memUrl}/short-term/${userId}/append`, { session_id: sessionId, user_message: userMsg, ai_message: aiMsg }),
      );
      console.log(`[Turn][appendToShortTerm] ✓ appended  user=${userId}  session=${sessionId}`);
    } catch (err: any) {
      console.error(`[Turn][appendToShortTerm] ✖ FAILED  user=${userId}  session=${sessionId}  url=${memUrl}  error=${err?.message}`);
    }
  }

  private async recordUsage(userId: string, tokens: number) {
    const billingUrl = this.cfg.get('BILLING_SERVICE_URL');
    await firstValueFrom(
      this.http.post(`${billingUrl}/internal/usage/increment`, { user_id: userId, tokens_used: tokens }),
    );
  }

  private async generateTitle(sessionId: string, firstTranscript: string) {
    const llmUrl = this.cfg.get('LLM_GATEWAY_URL');
    const res = await firstValueFrom(
      this.http.post(`${llmUrl}/complete`, {
        system: 'Generate a 5-word max title for this conversation. Return only the title, nothing else.',
        messages: [{ role: 'user', content: firstTranscript }],
      }),
    );
    const title = res.data?.response_text?.trim();
    if (title) await this.sessionRepo.update(sessionId, { title });
  }
}
