import { Controller, Post, Get, Param, Body, Query, UseGuards, Req, Res, HttpCode } from '@nestjs/common';
import { Response } from 'express';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SessionService } from './session.service';
import { UserService } from '../user/user.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

class EndSessionDto { @IsString() session_id: string; }

function formatDatetimeInTimezone(timezone: string): string {
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

@Controller('session')
@UseGuards(JwtAuthGuard)
export class SessionController {
  constructor(
    private sessionService: SessionService,
    private userService: UserService,
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
  async greetingStreamAnon(@Req() req, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      const [user, greetingContext] = await Promise.all([
        this.userService.findById(req.user.id).catch(() => null),
        this.sessionService.getGreetingContext(req.user.id),
      ]);

      const formattedDatetime = formatDatetimeInTimezone(user?.timezone ?? 'UTC');
      const speechUrl = this.cfg.get('SPEECH_SERVICE_URL');

      const systemPrompt = [
        `You are a friendly and encouraging ${user?.targetLanguage ?? 'English'} speaking coach.`,
        `Today is ${formattedDatetime}.`,
        user?.name ? `You are greeting ${user.name} (${user.level ?? 'beginner'} level learner).` : '',
        greetingContext
          ? `Important user context — use this to personalise your greeting:\n${greetingContext}`
          : '',
        '',
        'Greet the user warmly by name if you know it.',
        'If the context mentions an upcoming or recent event relevant to today\'s date (e.g. an exam, appointment, or goal), naturally ask about it.',
        'Keep your greeting to 2 sentences maximum.',
      ].filter(Boolean).join('\n');

      console.log(`[Greeting] system prompt:\n${systemPrompt}`);

      const llmRes = await this.http.axiosRef.post(
        `${this.cfg.get('LLM_GATEWAY_URL')}/stream`,
        {
          system: systemPrompt,
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
              const r = await p;
              if (r) send({ type: 'audio', audio_b64: r.data.audio_b64, text: clean });
            });
          }
        }
      });

      llmRes.data.on('end', async () => {
        console.log(`[Greeting] ── full text ──────────────────────────\n${fullText}\n────────────────────────────────────────────────`);
        const remaining = sentenceBuffer.trim();
        if (remaining) {
          const p = this.http.axiosRef.post(`${speechUrl}/tts`, { text: remaining })
            .catch(e => { console.error(`[Greeting][TTS] FAILED remaining: "${remaining}" —`, e?.message); return null; });
          ttsChain = ttsChain.then(async () => {
            const r = await p;
            if (r) send({ type: 'audio', audio_b64: r.data.audio_b64, text: remaining });
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
  async greetingStream(@Param('id') sessionId: string, @Req() req, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      const [user, greetingContext] = await Promise.all([
        this.userService.findById(req.user.id).catch(() => null),
        this.sessionService.getGreetingContext(req.user.id),
      ]);

      const formattedDatetime = formatDatetimeInTimezone(user?.timezone ?? 'UTC');
      const speechUrl = this.cfg.get('SPEECH_SERVICE_URL');

      const systemPrompt = [
        `You are a friendly and encouraging ${user?.targetLanguage ?? 'English'} speaking coach.`,
        `Today is ${formattedDatetime}.`,
        user?.name ? `You are greeting ${user.name} (${user.level ?? 'beginner'} level learner).` : '',
        greetingContext
          ? `Important user context — use this to personalise your greeting:\n${greetingContext}`
          : '',
        '',
        'Greet the user warmly by name if you know it.',
        'If the context mentions an upcoming or recent event relevant to today\'s date (e.g. an exam, appointment, or goal), naturally ask about it.',
        'Keep your greeting to 2 sentences maximum.',
      ].filter(Boolean).join('\n');

      console.log(`[Greeting][session=${sessionId}] system prompt:\n${systemPrompt}`);

      const llmRes = await this.http.axiosRef.post(
        `${this.cfg.get('LLM_GATEWAY_URL')}/stream`,
        {
          system: systemPrompt,
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
            const p = this.http.axiosRef.post(`${speechUrl}/tts`, { text: clean })
              .catch(e => { console.error(`[Greeting][TTS] FAILED: "${clean}" —`, e?.message); return null; });
            ttsChain = ttsChain.then(async () => {
              const r = await p;
              if (r) send({ type: 'audio', audio_b64: r.data.audio_b64, text: clean });
            });
          }
        }
      });

      llmRes.data.on('end', async () => {
        const remaining = sentenceBuffer.trim();
        if (remaining) {
          const p = this.http.axiosRef.post(`${speechUrl}/tts`, { text: remaining })
            .catch(e => { console.error(`[Greeting][TTS] FAILED remaining: "${remaining}" —`, e?.message); return null; });
          ttsChain = ttsChain.then(async () => {
            const r = await p;
            if (r) send({ type: 'audio', audio_b64: r.data.audio_b64, text: remaining });
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
