import {
  Controller, Post, Param, Req, Res,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TurnService } from './turn.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

const SENTENCE_BOUNDARY = /^([\s\S]*?[.!?]+\s+)/;

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

@Controller('turn')
@UseGuards(JwtAuthGuard)
export class TurnController {
  constructor(
    private readonly turnService: TurnService,
    private readonly http: HttpService,
    private readonly cfg: ConfigService,
  ) {}

  // POST /turn/:session_id — full response (non-streaming)
  @Post(':session_id')
  @UseInterceptors(FileInterceptor('audio'))
  async processTurn(
    @Param('session_id') sessionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req,
  ) {
    const fileInfo = file ? `${file.size}b  ${file.mimetype}  "${file.originalname}"` : 'MISSING';
    console.log(`\n[Turn] ▶ POST /turn/${sessionId}`);
    console.log(`[Turn]   user     : ${req.user?.id}`);
    console.log(`[Turn]   file     : ${fileInfo}`);

    if (!file) {
      console.error('[Turn] ✖ No audio file in request — check FormData field name is "audio"');
      throw new BadRequestException('No audio file received');
    }

    return this.turnService.processTurn(sessionId, req.user.id, file.buffer, file.mimetype);
  }

  // POST /turn/:session_id/stream — SSE streaming variant
  @Post(':session_id/stream')
  @UseInterceptors(FileInterceptor('audio'))
  async streamTurn(
    @Param('session_id') sessionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    if (!file) {
      send({ type: 'error', message: 'No audio provided' });
      res.end();
      return;
    }

    try {
      const quota = await this.turnService.checkQuota(req.user.id);
      if (quota.tokens_limit !== -1) {
        res.setHeader('X-RateLimit-Limit-Tokens',     quota.tokens_limit);
        res.setHeader('X-RateLimit-Used-Tokens',      quota.tokens_used);
        res.setHeader('X-RateLimit-Remaining-Tokens', Math.max(0, quota.tokens_limit - quota.tokens_used));
        if (quota.reset_date) res.setHeader('X-RateLimit-Reset-Tokens', quota.reset_date);
      }

      // Fetch user entity and turn index in parallel
      const [user, turnIndex] = await Promise.all([
        this.turnService.getUserEntity(req.user.id),
        this.turnService.getTurnIndex(sessionId),
      ]);

      // Prefer the client's reported time (sent as ISO string in header) for accuracy
      const clientIso = req.headers['x-client-datetime'];
      const currentDatetime = clientIso
        ? (() => {
            try {
              const d = new Date(clientIso);
              return isNaN(d.getTime()) ? getCurrentDatetime(user?.timezone ?? 'UTC') : getCurrentDatetime(user?.timezone ?? 'UTC', d);
            } catch { return getCurrentDatetime(user?.timezone ?? 'UTC'); }
          })()
        : getCurrentDatetime(user?.timezone ?? 'UTC');
      console.log(`[Turn][stream] datetime="${currentDatetime}"`);
      const speechUrl = this.cfg.get<string>('SPEECH_SERVICE_URL');
      const memoryUrl = this.cfg.get<string>('MEMORY_SERVICE_URL');
      const llmUrl    = this.cfg.get<string>('LLM_GATEWAY_URL');

      const formData = new FormData();
      formData.append('audio', new Blob([file.buffer as any], { type: file.mimetype || 'audio/webm' }), 'audio.webm');
      const sttRes = await this.http.axiosRef.post(`${speechUrl}/stt`, formData);
      const { transcript, confidence, pronunciation } = sttRes.data;
      send({ type: 'transcript', text: transcript });
      send({ type: 'pronunciation', data: pronunciation });

      // Let the LLM decide which memory layers to query
      const layers = await this.turnService.selectMemoryLayers(transcript, llmUrl, currentDatetime);
      console.log(`[Turn][stream] selected memory layers: ${JSON.stringify(layers)}`);

      // Build system prompt using selected layers
      let systemPrompt = `You are a friendly ${user?.targetLanguage ?? 'English'} speaking coach. Today is ${currentDatetime}.`;
      if (layers.length > 0) {
        try {
          const promptRes = await this.http.axiosRef.post(
            `${memoryUrl}/build-prompt/${req.user.id}`,
            {
              query: transcript,
              session_id: sessionId,
              user_level: user?.level ?? 'beginner',
              target_language: user?.targetLanguage ?? 'english',
              user_name: user?.name ?? '',
              current_datetime: currentDatetime,
              layers,
            },
          );
          if (promptRes.data?.system_prompt) systemPrompt = promptRes.data.system_prompt;
        } catch {
          // Memory service unavailable — keep default prompt with datetime
        }
      }

      const llmStream = await this.http.axiosRef.post(
        `${llmUrl}/stream`,
        { system: systemPrompt, messages: [{ role: 'user', content: transcript }] },
        { responseType: 'stream' },
      );

      let fullText = '';
      let sentenceBuffer = '';
      let ttsChain: Promise<void> = Promise.resolve();

      llmStream.data.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        fullText += text;
        sentenceBuffer += text;
        console.log(`[Turn] text chunk: ${JSON.stringify(text)}`);
        send({ type: 'text', chunk: text });

        let match: RegExpExecArray | null;
        let matched = false;
        while ((match = SENTENCE_BOUNDARY.exec(sentenceBuffer))) {
          matched = true;
          const sentence = match[1];
          sentenceBuffer = sentenceBuffer.slice(sentence.length);
          const cleanSentence = sentence.trim();
          console.log(`[Turn][TTS] sentence matched: "${cleanSentence}"`);
          if (cleanSentence.length > 0) {
            const ttsPromise = this.http.axiosRef.post(`${speechUrl}/tts`, { text: cleanSentence })
              .catch(e => { console.error(`[Turn][TTS] FAILED: "${cleanSentence}" —`, e?.message); return null; });
            ttsChain = ttsChain.then(async () => {
              const ttsRes = await ttsPromise;
              if (ttsRes) {
                send({ type: 'audio', audio_b64: ttsRes.data.audio_b64, text: cleanSentence });
              }
            });
          }
        }
        if (!matched) {
          console.log(`[Turn][TTS] no sentence boundary yet — buffer: "${sentenceBuffer.slice(0, 60)}"`);
        }
      });

      llmStream.data.on('end', async () => {
        console.log(`[Turn] ── full LLM text ──────────────────────────\n${fullText}\n────────────────────────────────────────────────`);
        const remaining = sentenceBuffer.trim();
        if (remaining.length > 0) {
          const ttsPromise = this.http.axiosRef.post(`${speechUrl}/tts`, { text: remaining })
            .catch(e => { console.error(`[Turn][TTS] FAILED remaining: "${remaining}" —`, e?.message); return null; });
          ttsChain = ttsChain.then(async () => {
            const ttsRes = await ttsPromise;
            if (ttsRes) {
              send({ type: 'audio', audio_b64: ttsRes.data.audio_b64, text: remaining });
            }
          });
        }

        await ttsChain;

        const tokensUsed = Math.ceil((transcript.length + fullText.length) / 4);
        try {
          await this.turnService.persistStreamedTurn(sessionId, req.user.id, turnIndex, {
            transcript, confidence, pronunciation, response_text: fullText, tokens_used: tokensUsed,
          });
        } catch (e: any) { console.error('[Turn Persist Error]', e?.message); }

        send({ type: 'done', tokens_used: tokensUsed });

        // Warn when subscription usage hits 80%+ after this turn
        if (quota.tokens_limit !== -1) {
          const usedAfter    = quota.tokens_used + tokensUsed;
          const percentAfter = Math.min(100, Math.round((usedAfter / quota.tokens_limit) * 100));
          if (percentAfter >= 80) {
            send({ type: 'quota_warning', percent_used: percentAfter, upgrade_url: '/billing' });
          }
        }

        res.end();
      });
    } catch (err: any) {
      console.error('[Turn][stream] FAILED:', err?.message ?? err);
      if (err?.response) {
        console.error('[Turn][stream] upstream status:', err.response.status);
        const body = typeof err.response.data === 'string'
          ? err.response.data
          : JSON.stringify(err.response.data ?? '');
        console.error('[Turn][stream] upstream body:', body.slice(0, 500));
      }
      if (err?.stack) console.error('[Turn][stream] stack:', err.stack);
      send({ type: 'error', message: err?.message ?? 'stream failed' });
      res.end();
    }
  }
}
