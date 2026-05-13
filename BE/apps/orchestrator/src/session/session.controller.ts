import { Controller, Post, Get, Param, Body, Query, UseGuards, Req, Res, HttpCode } from '@nestjs/common';
import { Response } from 'express';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SessionService } from './session.service';
import { UserService } from '../user/user.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

class EndSessionDto { @IsString() session_id: string; }

function formatDatetimeInTimezone(date: Date, timezone: string): string {
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

function resolveClientDatetime(queryDatetime: string | undefined, timezone: string): string {
  if (queryDatetime) {
    try {
      const clientDate = new Date(queryDatetime);
      if (!isNaN(clientDate.getTime())) {
        return formatDatetimeInTimezone(clientDate, timezone);
      }
    } catch { /* fall through */ }
  }
  return formatDatetimeInTimezone(new Date(), timezone);
}

const SENTENCE_RE = /^([\s\S]*?[.!?]+\s)/;

@Controller('session')
@UseGuards(JwtAuthGuard)
export class SessionController {
  constructor(
    private sessionService: SessionService,
    private userService: UserService,
    private http: HttpService,
    private cfg: ConfigService,
  ) {}

  // POST /session/start → { session_id }
  @Post('start')
  start(@Req() req) { return this.sessionService.start(req.user.id); }

  // GET /session/list?page=1&limit=25
  @Get('list')
  list(@Req() req, @Query('page') page = '1', @Query('limit') limit = '25') {
    return this.sessionService.list(req.user.id, parseInt(page), parseInt(limit));
  }

  // GET /session/greeting/stream — pre-session greeting (no session ID needed)
  @Get('greeting/stream')
  greetingStreamAnon(@Req() req, @Res() res: Response, @Query('datetime') dt?: string) {
    return this.streamGreetingForUser(req.user.id, res, dt);
  }

  // GET /session/:id/greeting/stream — greeting tied to a specific session
  @Get(':id/greeting/stream')
  greetingStream(@Param('id') id: string, @Req() req, @Res() res: Response, @Query('datetime') dt?: string) {
    return this.streamGreetingForUser(req.user.id, res, dt, id);
  }

  // POST /session/end
  @Post('end') @HttpCode(200)
  end(@Body() dto: EndSessionDto, @Req() req) {
    return this.sessionService.end(dto.session_id, req.user.id);
  }

  private async streamGreetingForUser(
    userId: string,
    res: Response,
    clientDatetime?: string,
    sessionId?: string,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (d: object) => res.write(`data: ${JSON.stringify(d)}\n\n`);

    try {
      // Short-term memory is now user-scoped, so we always fetch recent context
      // regardless of whether this is an anon (pre-session) or session-tied greeting.
      const [user, greetingContext] = await Promise.all([
        this.userService.findById(userId).catch(() => null),
        this.sessionService.getGreetingContext(userId),
      ]);

      const formattedDatetime = resolveClientDatetime(clientDatetime, user?.timezone ?? 'UTC');
      const speechUrl = this.cfg.get('SPEECH_SERVICE_URL');
      const logPrefix = sessionId ? `[Greeting][session=${sessionId}]` : '[Greeting]';

      const systemPrompt = [
        `You are a warm, friendly AI companion. Speak in ${user?.targetLanguage ?? 'English'} or whatever language the user uses naturally.`,
        `Help with conversations, answer questions, and support language learning like a good friend.`,
        `The current date and time RIGHT NOW is: ${formattedDatetime}.`,
        `Do not use emojis or special icons in your response.`,
        user?.name ? `You are greeting ${user.name} (${user.level ?? 'beginner'} level learner).` : '',
        greetingContext ? `Recent conversation context:\n${greetingContext}` : '',
        greetingContext
          ? `TEMPORAL REASONING: The context above may mention events at specific times. Compare those times to RIGHT NOW (${formattedDatetime}). If an event (meeting, appointment, task, activity) has already passed, ask how it went — do not wish them luck for it. If it is still upcoming, you may acknowledge it. Never treat a past event as if it is still in the future.`
          : '',
        '',
        'Greet the user warmly by name if you know it.',
        'Keep your greeting to 2 sentences maximum.',
      ].filter(Boolean).join('\n');

      console.log(`${logPrefix} ── greeting prompt built ──────────────────────`);
      console.log(`${logPrefix}   user         : ${user?.name ?? '(unknown)'}`);
      console.log(`${logPrefix}   language     : ${user?.targetLanguage ?? 'English'}`);
      console.log(`${logPrefix}   datetime     : ${formattedDatetime}`);
      console.log(`${logPrefix}   sessionId    : ${sessionId ?? '(none — anon route)'}`);
      console.log(`${logPrefix}   context src  : short_term (user-scoped rolling buffer)`);
      console.log(`${logPrefix}   context len  : ${greetingContext.length} chars`);
      console.log(`${logPrefix}   system prompt:\n${systemPrompt.split('\n').map(l => `    | ${l}`).join('\n')}`);
      console.log(`${logPrefix} ────────────────────────────────────────────────`);

      const llmRes = await this.http.axiosRef.post(
        `${this.cfg.get('LLM_GATEWAY_URL')}/stream`,
        { system: systemPrompt, messages: [{ role: 'user', content: 'start' }] },
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

        let m: RegExpMatchArray | null;
        while ((m = sentenceBuffer.match(SENTENCE_RE))) {
          const sentence = m[1];
          sentenceBuffer = sentenceBuffer.slice(sentence.length);
          const clean = sentence.trim();
          if (clean) {
            const p = this.http.axiosRef.post(`${speechUrl}/tts`, { text: clean })
              .catch(e => { console.error(`${logPrefix}[TTS] FAILED: "${clean}" —`, e?.message); return null; });
            ttsChain = ttsChain.then(async () => {
              const r = await p;
              if (r) send({ type: 'audio', audio_b64: r.data.audio_b64, text: clean });
            });
          }
        }
      });

      llmRes.data.on('end', async () => {
        const rem = sentenceBuffer.trim();
        if (rem) {
          const p = this.http.axiosRef.post(`${speechUrl}/tts`, { text: rem })
            .catch(e => { console.error(`${logPrefix}[TTS] FAILED remaining: "${rem}" —`, e?.message); return null; });
          ttsChain = ttsChain.then(async () => {
            const r = await p;
            if (r) send({ type: 'audio', audio_b64: r.data.audio_b64, text: rem });
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
}
