import { Controller, Post, Put, Get, Param, Body, Query, UseGuards, Req, Res, HttpCode } from '@nestjs/common';
import { Response } from 'express';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SessionService } from './session.service';
import { UserService } from '../user/user.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

class EndSessionDto { @IsString() session_id: string; }
class TodayChallengeDto { @IsString() challenge: string; }

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

  // GET /session/insight — proxies to memory-service for the FE mission card.
  // Cheap Redis read, called on every app open.
  @Get('insight')
  insight(@Req() req) {
    return this.sessionService.getSessionInsight(req.user.id);
  }

  // PUT /session/today-challenge — optional protected setter for any FE/backend
  // mission generator. This keeps the mission card, greeting, and turn prompt on
  // the same source of truth.
  @Put('today-challenge')
  setTodayChallenge(@Body() dto: TodayChallengeDto, @Req() req) {
    return this.sessionService.setTodayChallenge(req.user.id, dto.challenge);
  }

  // GET /session/onboarding-state — proxies to memory-service. Polled by the FE
  // ONLY during the user's first speaking session to drive the "Learning about you..."
  // panel. Returns {} when no state exists.
  @Get('onboarding-state')
  onboardingState(@Req() req) {
    return this.sessionService.getOnboardingState(req.user.id);
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
      // session_insight drives the mission-based greeting (Case A vs B vs C).
      // Onboarding flag flips the greeting to the first-session prompt instead.
      const [user, greetingContext, insight, todayChallenge, isOnboarding] = await Promise.all([
        this.userService.findById(userId).catch(() => null),
        this.sessionService.getGreetingContext(userId),
        this.sessionService.getSessionInsight(userId),
        this.sessionService.getTodayChallenge(userId),
        sessionId
          ? this.sessionService.isOnboardingSession(userId, sessionId)
          : this.sessionService.isFirstSession(userId),
      ]);

      const formattedDatetime = resolveClientDatetime(clientDatetime, user?.timezone ?? 'UTC');
      const speechUrl = this.cfg.get('SPEECH_SERVICE_URL');
      const logPrefix = sessionId ? `[Greeting][session=${sessionId}]` : '[Greeting]';

      // Bumped from 400 to 800 so the SESSION_INSIGHT JSON chunk (and other
      // short-term facts surfaced via retrieval) isn't truncated mid-payload.
      const MAX_CONTEXT_CHARS = 800;
      const trimmedContext = greetingContext.length > MAX_CONTEXT_CHARS
        ? greetingContext.slice(0, MAX_CONTEXT_CHARS) + '…'
        : greetingContext;

      const hasInsight = insight?.has_insight === true;
      const activeMissionCandidates = [
        todayChallenge,
        typeof insight?.active_mission === 'string' ? insight.active_mission.trim() : '',
        typeof insight?.next_challenge === 'string' ? insight.next_challenge.trim() : '',
      ];
      const activeMission = activeMissionCandidates.find(Boolean) ?? null;
      const daysAgo: number | null = hasInsight && typeof insight.last_session_days_ago === 'number'
        ? insight.last_session_days_ago
        : null;
      const isAbsent5Plus = daysAgo !== null && daysAgo >= 5;

      const targetLang = user?.targetLanguage ?? 'English';
      const profileLines = [
        user?.name ? `- Name: ${user.name}` : '',
        user?.level ? `- Level: ${user.level}` : '',
        user?.learningGoal ? `- Learning goal: ${user.learningGoal}` : '',
        user?.nativeLanguage ? `- Native language: ${user.nativeLanguage}` : '',
      ].filter(Boolean).join('\n');

      let systemPrompt: string;
      const activeMissionBlock = activeMission
        ? [
            `ACTIVE MISSION (highest priority — this is what today's session is about):`,
            `"${activeMission}"`,
            `The greeting MUST reference this mission. Do not reference any other challenge.`,
            `Previous-session challenges are background context only and must not replace this mission.`,
          ].join('\n')
        : '';

      if (isOnboarding) {
        // Onboarding greeting — first speaking session ever. Conversational,
        // not survey-style. Discovers motivation/style/confidence via natural
        // dialogue; data is silently extracted by the turn-agent in parallel.
        systemPrompt = [
          `You are a warm, sharp AI speaking partner.`,
          `The user just signed up and this is their FIRST speaking session.`,
          `The current date and time RIGHT NOW is: ${formattedDatetime}.`,
          '',
          `Known profile:`,
          `- Name: ${user?.name ?? 'unknown'}`,
          `- Native language: ${user?.nativeLanguage ?? 'unknown'}`,
          `- Target language: ${targetLang}`,
          `- Self-reported level: ${user?.level ?? 'unknown'}`,
          `- Learning goal: ${user?.learningGoal ?? 'unknown'}`,
          '',
          `MISSION:`,
          `Start a real conversation, not a survey.`,
          `Make the user feel recognized from the first 10 seconds.`,
          `Use the registered learning goal naturally, then discover more through conversation.`,
          '',
          `PHASE 1 — Opening greeting (THIS RESPONSE):`,
          `- Greet the user by name.`,
          `- Reference their learning goal as something you will help with, not as a question.`,
          `- End with exactly ONE natural follow-up question about that goal.`,
          `- Keep the whole response under 3 sentences.`,
          '',
          `OVERALL RULES across this onboarding session:`,
          `- Ask only ONE question per turn. Never two unrelated questions.`,
          `- Do not correct grammar during onboarding unless the user explicitly asks.`,
          `- Do not ask "What is your weakness?" / "What is your CEFR level?" / "Are you A1/B1/C1?".`,
          `- Do not mention IELTS unless the goal explicitly mentions exams.`,
          `- Do not mention onboarding, profiling, memory extraction, or that you're learning about them.`,
          `- Speak primarily in ${targetLang}.`,
          `- If the user mixes in ${user?.nativeLanguage ?? 'their native language'}, you may briefly mirror it to reduce pressure, then guide them back to ${targetLang}.`,
          `- No emojis.`,
        ].filter(Boolean).join('\n');
      } else if (hasInsight) {
        // Case A — returning user. Reference last session, give one mission.
        const struggled = insight.struggled_with ?? 'nothing specific noted';
        const improved  = insight.improved_vs_before ?? 'nothing noted yet';
        const nextChall = activeMission ?? insight.next_challenge ?? 'pick up where they left off';
        const energy    = insight.energy_level ?? 'medium';

        const absenceNote = isAbsent5Plus
          ? `\nNote: This user hasn't spoken in ${daysAgo} days. Do NOT be enthusiastic or act like nothing happened. Open gently — acknowledge the gap without making them feel guilty. Then still end with today's mission, but soften it.`
          : '';

        // Case A-bis — last session was the user's FIRST conversation. Open warmly,
        // referencing the soft signal we got, not the structured insight fields.
        // Do NOT mention onboarding, profiling, weakness, or CEFR labels.
        const isFirstInsight = insight.is_first_session_insight === true;
        let firstSessionBlock = '';
        if (isFirstInsight) {
          const motivation = insight.inferred_motivation;
          const recommended = insight.recommended_next_session?.suggested_challenge;
          firstSessionBlock = [
            ``,
            `CONTEXT: Last time was the user's first conversation with you.`,
            motivation ? `- Soft motivation signal: ${motivation}` : '',
            recommended ? `- Recommended starter for today: ${recommended}` : '',
            ``,
            `Open warmly and naturally — something like "Last time, I got a feel for your speaking style. Today let's start with something simple and real." Adapt the wording. Reference the motivation/context implicitly, never the labels.`,
            `Do NOT say: "Based on your onboarding insight" / "I extracted your weakness" / "Your confidence signal is..." / "Last session you struggled with X."`,
          ].filter(Boolean).join('\n');
        }

        systemPrompt = [
          `You are a sharp, warm AI speaking coach greeting a returning user.`,
          `Speak in ${targetLang} or whatever language the user uses naturally.`,
          `The current date and time RIGHT NOW is: ${formattedDatetime}.`,
          '',
          profileLines ? `User profile:\n${profileLines}` : '',
          '',
          activeMissionBlock,
          activeMissionBlock ? '' : '',
          `Last session insight:`,
          `- They struggled with: ${struggled}`,
          `- They improved on: ${improved}`,
          `- Recommended challenge from memory: ${insight.next_challenge ?? 'none'}`,
          `- Active mission for today: ${nextChall}`,
          `- Their energy last time: ${energy}`,
          absenceNote,
          firstSessionBlock,
          trimmedContext ? `\nAdditional recent context (use sparingly):\n${trimmedContext}` : '',
          '',
          `YOUR GREETING MUST:`,
          `1. Reference something specific from last session naturally — not robotically. BAD: "Last session you struggled with X." GOOD: weave it into a casual line.`,
          `2. Give them ONE clear mission for today as a challenge, not a suggestion.`,
          `3. Be 2-3 sentences MAX. No preamble. Start talking, don't introduce yourself.`,
          `4. Match their energy — if "low", be gentler. If "high", be direct.`,
          `5. Do NOT use emojis. Do NOT say "Great to see you!" or any generic opener.`,
          '',
          `TEMPORAL REASONING: Recent context may mention events at specific times. Compare them to RIGHT NOW (${formattedDatetime}). If an event has already passed, ask how it went — do not wish them luck for it.`,
        ].filter(Boolean).join('\n');
      } else if (activeMission) {
        systemPrompt = [
          `You are a sharp, warm AI speaking coach greeting a user.`,
          `Speak in ${targetLang} or whatever language the user uses naturally.`,
          `The current date and time RIGHT NOW is: ${formattedDatetime}.`,
          '',
          profileLines ? `User profile:\n${profileLines}` : '',
          '',
          activeMissionBlock,
          '',
          `YOUR GREETING:`,
          `1. Greet them naturally${user?.name ? ` by name (${user.name})` : ''}.`,
          `2. Start today's active mission directly.`,
          `3. Ask exactly ONE question that gets them into the mission.`,
          `4. 2 sentences MAX. No emojis.`,
        ].filter(Boolean).join('\n');
      } else {
        // Case B — first-time user (or first session with data). Warm, scoped, no mission yet.
        systemPrompt = [
          `You are a warm AI speaking coach meeting this user for the first time (or first session with data).`,
          `Speak in ${targetLang} or whatever language the user uses naturally.`,
          `The current date and time RIGHT NOW is: ${formattedDatetime}.`,
          '',
          profileLines ? `User profile:\n${profileLines}` : '',
          '',
          `YOUR GREETING:`,
          `1. Welcome them warmly by name${user?.name ? '' : ' if you know it'}.`,
          `2. Tell them ONE thing you'll do together today based on their learning goal.`,
          `3. Make it feel like the beginning of something, not a tool onboarding.`,
          `4. 2 sentences MAX. No emojis.`,
        ].filter(Boolean).join('\n');
      }

      console.log(`${logPrefix} ── greeting prompt built ──────────────────────`);
      console.log(`${logPrefix}   user         : ${user?.name ?? '(unknown)'}`);
      console.log(`${logPrefix}   language     : ${user?.targetLanguage ?? 'English'}`);
      console.log(`${logPrefix}   native lang  : ${user?.nativeLanguage ?? '(unknown)'}`);
      console.log(`${logPrefix}   learning goal: ${user?.learningGoal ?? '(none)'}`);
      console.log(`${logPrefix}   datetime     : ${formattedDatetime}`);
      console.log(`${logPrefix}   sessionId    : ${sessionId ?? '(none — anon route)'}`);
      console.log(`${logPrefix}   context src  : short_term (consolidated st_facts from previous sessions)`);
      console.log(`${logPrefix}   context len  : ${trimmedContext.length} chars (raw: ${greetingContext.length})`);
      console.log(`${logPrefix}   insight      : has=${hasInsight} daysAgo=${daysAgo ?? 'n/a'} absent5+=${isAbsent5Plus}`);
      console.log(`${logPrefix}   activeMission: ${activeMission ?? '(none)'}`);
      console.log(`${logPrefix}   onboarding   : ${isOnboarding}`);
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
