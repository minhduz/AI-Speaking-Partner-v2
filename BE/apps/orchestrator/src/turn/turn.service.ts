import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Turn } from './entities/turn.entity';
import { Session } from '../session/entities/session.entity';
import { UserService } from '../user/user.service';
import { User } from '../user/entities/user.entity';

export interface QuotaInfo {
  tokens_used: number;
  tokens_limit: number;
  addon_balance: number;
  percent_used: number;
  reset_date: string;
}

const VALID_MEMORY_LAYERS = new Set(['short_term', 'long_term', 'urgent']);

function getCurrentDatetime(timezone: string): string {
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
    }).format(new Date());
  } catch {
    return new Date().toUTCString();
  }
}

@Injectable()
export class TurnService {
  constructor(
    @InjectRepository(Turn) private readonly turnRepo: Repository<Turn>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    private readonly http: HttpService,
    private readonly cfg: ConfigService,
    private readonly userService: UserService,
  ) {}

  async getUserEntity(userId: string): Promise<User | null> {
    try { return await this.userService.findById(userId); } catch { return null; }
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
      // 0. Quota check
      step = 'quota';
      await this.checkQuota(userId);
      console.log(`[Turn] [${elapsed()}] quota ok`);

      // 1. Turn index + user entity (parallel)
      step = 'turn-index';
      const [turnCount, user] = await Promise.all([
        this.turnRepo.count({ where: { sessionId } }),
        this.getUserEntity(userId),
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

      // 3. Select memory layers
      step = 'select-layers';
      const layers = await this.selectMemoryLayers(transcript, llmUrl, currentDatetime);
      console.log(`[Turn] [${elapsed()}] selected layers: ${JSON.stringify(layers)}`);

      // 4. Build prompt
      step = 'prompt';
      let system_prompt: string;
      if (layers.length > 0) {
        try {
          const promptRes = await firstValueFrom(
            this.http.post(`${memoryUrl}/build-prompt/${userId}`, {
              query: transcript,
              session_id: sessionId,
              user_level: user?.level ?? 'beginner',
              target_language: user?.targetLanguage ?? 'english',
              user_name: user?.name ?? '',
              current_datetime: currentDatetime,
              layers,
            }),
          );
          system_prompt = promptRes.data.system_prompt;
          console.log(`[Turn] [${elapsed()}] system_prompt length: ${system_prompt?.length ?? 0} chars`);
        } catch {
          system_prompt = 'You are a friendly English speaking coach.';
        }
      } else {
        system_prompt = `You are a friendly ${user?.targetLanguage ?? 'English'} speaking coach. Today is ${currentDatetime}.`;
        console.log(`[Turn] [${elapsed()}] no memory needed — using default prompt`);
      }

      // 5. LLM complete
      step = 'llm';
      const llmRes = await firstValueFrom(
        this.http.post(`${llmUrl}/complete`, {
          system: system_prompt,
          messages: [{ role: 'user', content: transcript }],
        }),
      );
      const { response_text, tokens_used, provider } = llmRes.data;
      console.log(`[Turn] [${elapsed()}] LLM:`, { provider, tokens_used, preview: response_text?.slice(0, 80) });

      // 6. TTS
      step = 'tts';
      const ttsRes = await firstValueFrom(
        this.http.post(`${speechUrl}/tts`, { text: response_text }),
      );
      const { audio_b64 } = ttsRes.data;

      // 7. Persist
      step = 'persist';
      const turn = this.turnRepo.create({
        sessionId, userId, turnIndex,
        tokensUsed: tokens_used,
        data: { transcript, response_text, confidence, pronunciation, tokens_used },
      });
      await this.turnRepo.save(turn);
      console.log(`[Turn] [${elapsed()}] persisted — turn_id: ${turn.id}`);

      // 8. Async side-effects
      this.updateSessionTotals(sessionId, tokens_used, pronunciation?.score ?? 0).catch(console.error);
      this.appendToShortTerm(sessionId, userId, transcript, response_text).catch(console.error);
      this.recordUsage(userId, tokens_used).catch(console.error);
      if (turnIndex === 1) this.generateTitle(sessionId, transcript).catch(console.error);

      console.log(`[Turn] ── processTurn done (${elapsed()}) ────────────────`);
      return { turn_id: turn.id, transcript, confidence, pronunciation, response_text, audio_b64, tokens_used };

    } catch (err) {
      console.error(`[Turn] ✖ FAILED at step "${step}" (${elapsed()}):`, err.message);
      if (err.response) {
        console.error(`[Turn]   upstream status :`, err.response.status);
        console.error(`[Turn]   upstream body   :`, JSON.stringify(err.response.data ?? '').slice(0, 300));
      }
      throw err;
    }
  }

  async getTurnIndex(sessionId: string): Promise<number> {
    const count = await this.turnRepo.count({ where: { sessionId } });
    return count + 1;
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
    if (turnIndex === 1) this.generateTitle(sessionId, data.transcript).catch(console.error);
    return turn;
  }

  async checkQuota(userId: string): Promise<QuotaInfo> {
    const billingUrl = this.cfg.get<string>('BILLING_SERVICE_URL');
    try {
      const { data } = await firstValueFrom(
        this.http.get<any>(`${billingUrl}/internal/quota/${userId}`),
      );
      if (!data.allowed) {
        throw new HttpException(
          { error: 'QUOTA_EXCEEDED', limit: data.tokens_limit, used: data.tokens_used, reset_date: data.reset_date },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return {
        tokens_used:   data.tokens_used   ?? 0,
        tokens_limit:  data.tokens_limit  ?? -1,
        addon_balance: data.addon_balance ?? 0,
        percent_used:  data.percent_used  ?? 0,
        reset_date:    data.reset_date    ?? '',
      };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      console.warn('[Quota] Billing service unreachable, allowing turn:', err.message);
      return { tokens_used: 0, tokens_limit: -1, addon_balance: 0, percent_used: 0, reset_date: '' };
    }
  }

  async selectMemoryLayers(transcript: string, llmUrl: string, currentDatetime: string): Promise<string[]> {
    try {
      const res = await firstValueFrom(
        this.http.post(`${llmUrl}/complete`, {
          system: `You are a memory router for an English speaking coach app. You have access to three memory databases:
1. "short_term" — Recent messages from this session (Redis). Use when the user references something said earlier in this conversation.
2. "long_term" — User's personal facts, goals, preferences, background across all sessions (pgvector). Use for personalization or when the question involves the user's personal context.
3. "urgent" — Time-sensitive facts: upcoming exams, appointments, events within 7 days (pgvector). Use when the message involves time, upcoming events, or deadlines.

Today is: ${currentDatetime}

Decide which memory databases to query for the user's message. Return ONLY valid JSON: {"layers": [...]}.
Use only the layer names listed above. Return {"layers": []} if no memory context is needed (e.g. pure grammar questions, generic conversation).`,
          messages: [{ role: 'user', content: transcript }],
        }),
      );
      const text: string = res.data?.response_text?.trim() ?? '';
      const match = text.match(/\{[\s\S]*?"layers"[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const layers = (parsed.layers ?? []).filter((l: string) => VALID_MEMORY_LAYERS.has(l));
        return layers;
      }
    } catch (e: any) {
      console.warn('[Turn] selectMemoryLayers failed, defaulting to long_term+urgent:', e?.message);
    }
    return ['long_term', 'urgent'];
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

  private async appendToShortTerm(sessionId: string, _userId: string, userMsg: string, aiMsg: string) {
    const memUrl = this.cfg.get('MEMORY_SERVICE_URL');
    await firstValueFrom(
      this.http.post(`${memUrl}/short-term/${sessionId}/append`, { user_message: userMsg, ai_message: aiMsg }),
    );
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
