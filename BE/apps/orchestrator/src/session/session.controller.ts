import { Controller, Post, Get, Param, Body, Query, UseGuards, Req, Res, HttpCode } from '@nestjs/common';
import { Response } from 'express';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SessionService } from './session.service';
import { UserService } from '../user/user.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { normalizeVoiceId } from '../user/voice-options';

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

// Take the first whitespace-separated word — addresses users by a single given
// name ("Đức" from "Đức Nguyễn Minh") instead of dumping the full stored name
// into the prompt. Returns empty string for null/empty input.
function firstName(fullName: string | null | undefined): string {
  if (!fullName) return '';
  return fullName.trim().split(/\s+/)[0] ?? '';
}

// One-line tone primer per conversation style. Mirrored in memory-service so
// turn responses follow the same persona as the greeting.
const STYLE_HINTS: Record<string, string> = {
  friendly:     'Tone: warm and casual, like a supportive friend. Use contractions and natural phrasing.',
  formal:       'Tone: polite and respectful, with complete sentences and no slang.',
  casual:       'Tone: relaxed and brief, like texting a buddy.',
  playful:      'Tone: light and witty, gentle humor when it fits naturally.',
  professional: 'Tone: clear, focused, and expert — like a tutor on the clock.',
};
function styleHint(style: string | null | undefined): string {
  return STYLE_HINTS[style ?? 'friendly'] ?? STYLE_HINTS.friendly;
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

// Matches one complete sentence ending in .!? followed by whitespace or EOS.
const SENTENCE_RE = /^([\s\S]*?[.!?]+(?:\s+|$))/;
const TTS_MIN_CHARS = 42;
const TTS_MAX_CHARS = 80;

// Same chunking strategy as turn-agent's llm_tts_node._split_tts_segment:
// prefer sentence boundary, else split at comma/whitespace inside a 42-80 char window
// so the first TTS segment is small enough to play fast.
function splitTtsSegment(buffer: string, force = false): [string | null, string] {
  const m = buffer.match(SENTENCE_RE);
  if (m) {
    return [m[1].trim(), buffer.slice(m[1].length)];
  }
  if (buffer.length >= TTS_MAX_CHARS) {
    const window = buffer.slice(0, TTS_MAX_CHARS);
    let splitAt = -1;
    for (const match of window.matchAll(/[,;:]\s+/g)) {
      const end = (match.index ?? 0) + match[0].length;
      if (end >= TTS_MIN_CHARS) splitAt = end;
    }
    if (splitAt < 0) {
      for (const match of window.matchAll(/\s+/g)) {
        const end = (match.index ?? 0) + match[0].length;
        if (end >= TTS_MIN_CHARS) splitAt = end;
      }
    }
    if (splitAt > 0) {
      return [buffer.slice(0, splitAt).trim(), buffer.slice(splitAt)];
    }
  }
  if (force && buffer.trim()) {
    return [buffer.trim(), ''];
  }
  return [null, buffer];
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

      // Limit context to 400 chars so the greeting prompt stays cheap.
      // The AI only needs a brief topic hint for a 2-sentence greeting.
      const MAX_CONTEXT_CHARS = 400;
      const trimmedContext = greetingContext.length > MAX_CONTEXT_CHARS
        ? greetingContext.slice(0, MAX_CONTEXT_CHARS) + '…'
        : greetingContext;

      const systemPrompt = [
        `You are a warm, friendly AI companion. Speak in ${user?.targetLanguage ?? 'English'} or whatever language the user uses naturally.`,
        `Help with conversations, answer questions, and support language learning like a good friend.`,
        styleHint(user?.conversationStyle),
        `The current date and time RIGHT NOW is: ${formattedDatetime}.`,
        `Do not use emojis or special icons in your response.`,
        user?.name ? `You are greeting ${firstName(user.name)} (${user.level ?? 'beginner'} level learner). Always address them by this single given name — never by the full stored name.` : '',
        user?.nativeLanguage ? `Their native language is ${user.nativeLanguage}.` : '',
        user?.learningGoal ? `Their learning goal is: ${user.learningGoal}.` : '',
        trimmedContext ? `Recent conversation topics (brief):\n${trimmedContext}` : '',
        trimmedContext
          ? `TEMPORAL REASONING: The context above may mention events at specific times. Compare those times to RIGHT NOW (${formattedDatetime}). If an event (meeting, appointment, task, activity) has already passed, ask how it went — do not wish them luck for it. If it is still upcoming, you may acknowledge it. Never treat a past event as if it is still in the future.`
          : '',
        '',
        'Greet the user warmly by name if you know it.',
        'Keep your greeting to 15 words maximum. Be concise — a single short sentence.',
      ].filter(Boolean).join('\n');

      console.log(`${logPrefix} ── greeting prompt built ──────────────────────`);
      console.log(`${logPrefix}   user         : ${user?.name ?? '(unknown)'}`);
      console.log(`${logPrefix}   language     : ${user?.targetLanguage ?? 'English'}`);
      console.log(`${logPrefix}   native lang  : ${user?.nativeLanguage ?? '(unknown)'}`);
      console.log(`${logPrefix}   learning goal: ${user?.learningGoal ?? '(none)'}`);
      console.log(`${logPrefix}   datetime     : ${formattedDatetime}`);
      console.log(`${logPrefix}   sessionId    : ${sessionId ?? '(none — anon route)'}`);
      console.log(`${logPrefix}   context src  : short_term (consolidated st_facts from previous sessions)`);
      console.log(`${logPrefix}   context len  : ${trimmedContext.length} chars (raw: ${greetingContext.length})`);
      console.log(`${logPrefix}   system prompt:\n${systemPrompt.split('\n').map(l => `    | ${l}`).join('\n')}`);
      console.log(`${logPrefix} ────────────────────────────────────────────────`);

      const llmRes = await this.http.axiosRef.post(
        `${this.cfg.get('LLM_GATEWAY_URL')}/stream`,
        { system: systemPrompt, messages: [{ role: 'user', content: 'start' }] },
        { responseType: 'stream' },
      );

      let fullText = '';
      let ttsBuffer = '';
      // Chain of segment emissions — TTS kicks off in parallel as soon as a segment
      // is split off, but events fire to the FE in segment order via this chain.
      let segmentChain: Promise<void> = Promise.resolve();

      const ttsBody: Record<string, unknown> = { text: '' };
      ttsBody.voice = normalizeVoiceId(user?.voiceId);
      if (user?.speechRate)  ttsBody.speech_rate = user.speechRate;

      const flushSegment = (segment: string) => {
        const p = this.http.axiosRef.post(`${speechUrl}/tts`, { ...ttsBody, text: segment })
          .catch(e => { console.error(`${logPrefix}[TTS] FAILED: "${segment}" —`, e?.message); return null; });
        segmentChain = segmentChain.then(async () => {
          const r = await p;
          if (r) send({ type: 'segment', text: segment, audio_b64: r.data.audio_b64 });
        });
      };

      llmRes.data.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        fullText += text;
        ttsBuffer += text;

        while (true) {
          const [segment, remaining] = splitTtsSegment(ttsBuffer);
          ttsBuffer = remaining;
          if (!segment) break;
          flushSegment(segment);
        }
      });

      llmRes.data.on('end', async () => {
        const [segment] = splitTtsSegment(ttsBuffer, true);
        if (segment) flushSegment(segment);
        await segmentChain;
        send({ type: 'done', greeting: fullText });
        res.end();
      });

    } catch {
      send({ type: 'error', message: 'Failed to generate greeting' });
      res.end();
    }
  }
}
