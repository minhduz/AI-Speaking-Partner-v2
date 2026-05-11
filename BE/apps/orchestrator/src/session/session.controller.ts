import { Controller, Post, Get, Param, Body, Query, UseGuards, Req, Res, HttpCode } from '@nestjs/common';
import { Response } from 'express';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SessionService } from './session.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

class EndSessionDto { @IsString() session_id: string; }

@Controller('session')
@UseGuards(JwtAuthGuard)
export class SessionController {
  constructor(
    private sessionService: SessionService,
    private http: HttpService,
    private cfg: ConfigService,
  ) {}

  // POST /session/start → { session_id }  returns in ~5ms
  @Post('start')
  start(@Req() req) { return this.sessionService.start(req.user.id); }

  // GET /session/list?page=1&limit=25 → paginated session list
  @Get('list')
  list(@Req() req, @Query('page') page = '1', @Query('limit') limit = '25') {
    return this.sessionService.list(req.user.id, parseInt(page), parseInt(limit));
  }

  // GET /session/greeting/stream → SSE (no session ID, called before any session is created)
  @Get('greeting/stream')
  async greetingStreamAnon(@Req() _req, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      // TODO: re-enable memory service after testing
      // const urgentContext = await this.sessionService.getUrgentContext(req.user.id);
      const urgentContext = null;
      const speechUrl = this.cfg.get('SPEECH_SERVICE_URL');

      const llmRes = await this.http.axiosRef.post(
        `${this.cfg.get('LLM_GATEWAY_URL')}/stream`,
        {
          system: `You are a friendly English speaking coach.
${urgentContext ? `Important — user context: ${urgentContext}` : ''}
Greet the user warmly and open the session. Max 2 sentences.`,
          messages: [{ role: 'user', content: 'start' }],
        },
        { responseType: 'stream' },
      );

      let fullText = '';
      let sentenceBuffer = '';
      let ttsChain: Promise<void> = Promise.resolve();

      llmRes.data.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        fullText += text;
        sentenceBuffer += text;
        send({ type: 'text', chunk: text });

        let match: RegExpMatchArray | null;
        while ((match = sentenceBuffer.match(/^([\s\S]*?[.!?]+\s)/))) {
          const sentence = match[1];
          sentenceBuffer = sentenceBuffer.slice(sentence.length);
          const clean = sentence.trim();
          if (clean) {
            console.log(`[Greeting][TTS] sentence matched: "${clean}"`);
            const p = this.http.axiosRef.post(`${speechUrl}/tts`, { text: clean })
              .catch(e => { console.error(`[Greeting][TTS] FAILED: "${clean}" —`, e?.message); return null; });
            ttsChain = ttsChain.then(async () => {
              console.log(`[Greeting][TTS] awaiting TTS for: "${clean}"`);
              const r = await p;
              if (r) {
                console.log(`[Greeting][TTS] OK — b64 len: ${r.data.audio_b64?.length ?? 0} → sending audio event`);
                send({ type: 'audio', audio_b64: r.data.audio_b64, text: clean });
              } else {
                console.warn(`[Greeting][TTS] skipped — TTS returned null for: "${clean}"`);
              }
            });
          }
        }
      });

      llmRes.data.on('end', async () => {
        console.log(`[Greeting] ── full text ──────────────────────────\n${fullText}\n────────────────────────────────────────────────`);
        const remaining = sentenceBuffer.trim();
        console.log(`[Greeting][TTS] remaining after stream: "${remaining}"`);
        if (remaining) {
          const p = this.http.axiosRef.post(`${speechUrl}/tts`, { text: remaining })
            .catch(e => { console.error(`[Greeting][TTS] FAILED remaining: "${remaining}" —`, e?.message); return null; });
          ttsChain = ttsChain.then(async () => {
            console.log(`[Greeting][TTS] awaiting TTS for remaining: "${remaining}"`);
            const r = await p;
            if (r) {
              console.log(`[Greeting][TTS] OK remaining — b64 len: ${r.data.audio_b64?.length ?? 0} → sending audio event`);
              send({ type: 'audio', audio_b64: r.data.audio_b64, text: remaining });
            } else {
              console.warn(`[Greeting][TTS] skipped remaining — TTS returned null`);
            }
          });
        }
        await ttsChain;
        send({ type: 'done', greeting: fullText });
        res.end();
      });
    } catch {
      send({ type: 'error', message: 'Failed to generate greeting' });
      res.end();
    }
  }

  // GET /session/:id/greeting/stream → SSE
  @Get(':id/greeting/stream')
  async greetingStream(@Param('id') _sessionId: string, @Req() _req, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      // TODO: re-enable memory service after testing
      // const urgentContext = await this.sessionService.getUrgentContext(req.user.id);
      const urgentContext = null;
      const speechUrl = this.cfg.get('SPEECH_SERVICE_URL');

      const llmRes = await this.http.axiosRef.post(
        `${this.cfg.get('LLM_GATEWAY_URL')}/stream`,
        {
          system: `You are a friendly English speaking coach.
${urgentContext ? `Important — user context: ${urgentContext}` : ''}
Greet the user warmly and open the session. Max 2 sentences.`,
          messages: [{ role: 'user', content: 'start' }],
        },
        { responseType: 'stream' },
      );

      let fullText = '';
      let sentenceBuffer = '';
      let ttsChain: Promise<void> = Promise.resolve();

      llmRes.data.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        fullText += text;
        sentenceBuffer += text;
        send({ type: 'text', chunk: text });

        let match: RegExpMatchArray | null;
        while ((match = sentenceBuffer.match(/^([\s\S]*?[.!?]+\s)/))) {
          const sentence = match[1];
          sentenceBuffer = sentenceBuffer.slice(sentence.length);
          const clean = sentence.trim();
          if (clean) {
            console.log(`[Greeting][TTS] sentence matched: "${clean}"`);
            const p = this.http.axiosRef.post(`${speechUrl}/tts`, { text: clean })
              .catch(e => { console.error(`[Greeting][TTS] FAILED: "${clean}" —`, e?.message); return null; });
            ttsChain = ttsChain.then(async () => {
              console.log(`[Greeting][TTS] awaiting TTS for: "${clean}"`);
              const r = await p;
              if (r) {
                console.log(`[Greeting][TTS] OK — b64 len: ${r.data.audio_b64?.length ?? 0} → sending audio event`);
                send({ type: 'audio', audio_b64: r.data.audio_b64, text: clean });
              } else {
                console.warn(`[Greeting][TTS] skipped — TTS returned null for: "${clean}"`);
              }
            });
          }
        }
      });

      llmRes.data.on('end', async () => {
        console.log(`[Greeting] ── full text ──────────────────────────\n${fullText}\n────────────────────────────────────────────────`);
        const remaining = sentenceBuffer.trim();
        console.log(`[Greeting][TTS] remaining after stream: "${remaining}"`);
        if (remaining) {
          const p = this.http.axiosRef.post(`${speechUrl}/tts`, { text: remaining })
            .catch(e => { console.error(`[Greeting][TTS] FAILED remaining: "${remaining}" —`, e?.message); return null; });
          ttsChain = ttsChain.then(async () => {
            console.log(`[Greeting][TTS] awaiting TTS for remaining: "${remaining}"`);
            const r = await p;
            if (r) {
              console.log(`[Greeting][TTS] OK remaining — b64 len: ${r.data.audio_b64?.length ?? 0} → sending audio event`);
              send({ type: 'audio', audio_b64: r.data.audio_b64, text: remaining });
            } else {
              console.warn(`[Greeting][TTS] skipped remaining — TTS returned null`);
            }
          });
        }
        await ttsChain;
        send({ type: 'done', greeting: fullText });
        res.end();
      });
    } catch {
      send({ type: 'error', message: 'Failed to generate greeting' });
      res.end();
    }
  }

  // POST /session/end
  @Post('end') @HttpCode(200)
  end(@Body() dto: EndSessionDto, @Req() req) {
    return this.sessionService.end(dto.session_id, req.user.id);
  }
}
