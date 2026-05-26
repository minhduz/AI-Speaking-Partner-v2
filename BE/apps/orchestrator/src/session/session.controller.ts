import { Controller, Post, Put, Get, Param, Body, Query, UseGuards, Req, Res, HttpCode } from '@nestjs/common';
import { Response } from 'express';
import { IsString, IsOptional, IsIn } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SessionService } from './session.service';
import { UserService } from '../user/user.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { normalizeVoiceId } from '../user/voice-options';

class EndSessionDto {
  @IsString() session_id: string;
  reason?: 'user_clicked' | 'voice_intent' | 'idle_timeout' | 'tab_close';
}
class TodayChallengeDto { @IsString() challenge: string; }
class StartSessionDto {
  // Optional — defaults to 'guided_learning' on the server side if missing.
  // The validation decorators are REQUIRED: with ValidationPipe({ whitelist: true })
  // any property lacking a class-validator decorator is silently stripped from
  // the parsed body. Without these, the FE's `mode: 'free_talk'` would be dropped
  // and the controller would fall back to 'guided_learning'.
  @IsOptional()
  @IsIn(['guided_learning', 'free_talk'])
  mode?: 'guided_learning' | 'free_talk';
}

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

// ── Free Talk greeting context helpers ─────────────────────────────────────
function getLocalHour(timezone: string | undefined): number | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone ?? 'UTC',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date()).find((p) => p.type === 'hour')?.value;
    if (!part) return null;
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function partOfDayFromHour(hour: number | null): string | null {
  if (hour == null) return null;
  if (hour < 5)  return 'late night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'late night';
}

function formatDaysAgoLabel(daysAgo: number | null): string | null {
  if (daysAgo == null) return null;
  if (daysAgo === 0) return 'earlier today';
  return `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`;
}

interface FreeTalkContext {
  partOfDay: string | null;
  recentTopic: string | null;
  daysAgoLabel: string | null;
  continuityLine: string;
  absenceLine: string;
}

// Builds the variable parts of the Free Talk greeting prompt. Kept as a pure
// helper so the streamGreetingForUser body stays readable and the layered
// fallback logic (continuity → time-of-day → default) is testable in isolation.
function buildFreeTalkContext(
  user: { timezone?: string } | null | undefined,
  insight: { last_topic?: unknown } | null | undefined,
  daysAgo: number | null,
  isAbsent5Plus: boolean,
): FreeTalkContext {
  const partOfDay = partOfDayFromHour(getLocalHour(user?.timezone));
  const rawTopic = typeof insight?.last_topic === 'string' ? insight.last_topic.trim() : '';
  const recentTopic = !isAbsent5Plus && rawTopic.length > 0 ? rawTopic : null;
  const daysAgoLabel = formatDaysAgoLabel(daysAgo);

  const continuityLine = recentTopic && daysAgo !== null && daysAgo <= 3 && daysAgoLabel
    ? `They were talking about "${recentTopic}" ${daysAgoLabel}. You MAY reference it lightly — do not interrogate.`
    : '';

  const absenceLine = isAbsent5Plus && daysAgo !== null
    ? `They have not spoken in ${daysAgo} days — keep it gentle, no enthusiasm, no guilt.`
    : '';

  return { partOfDay, recentTopic, daysAgoLabel, continuityLine, absenceLine };
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

  // POST /session/start → { session_id, is_first_session }
  // Body: { mode?: 'guided_learning' | 'free_talk' } — defaults to 'guided_learning'.
  @Post('start')
  start(@Req() req, @Body() body: StartSessionDto) {
    const mode = body?.mode === 'free_talk' ? 'free_talk' : 'guided_learning';
    return this.sessionService.start(req.user.id, mode);
  }

  // GET /session/quota: current daily session allowance without creating a session
  @Get('quota')
  quota(@Req() req) { return this.sessionService.getQuota(req.user.id); }

  // GET /session/list?page=1&limit=25
  @Get('list')
  list(@Req() req, @Query('page') page = '1', @Query('limit') limit = '25') {
    return this.sessionService.list(req.user.id, parseInt(page), parseInt(limit));
  }

  // GET /session/greeting/stream — pre-session greeting (no session ID needed)
  // ?mode=free_talk swaps the prompt to a casual "friend" tone (no missions).
  @Get('greeting/stream')
  greetingStreamAnon(
    @Req() req,
    @Res() res: Response,
    @Query('datetime') dt?: string,
    @Query('mode') mode?: string,
  ) {
    const normalizedMode = mode === 'free_talk' ? 'free_talk' : 'guided_learning';
    return this.streamGreetingForUser(req.user.id, res, dt, undefined, normalizedMode);
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
    const reason = dto.reason ?? 'user_clicked';
    return this.sessionService.end(dto.session_id, req.user.id, reason);
  }

  // POST /session/:id/close — generate AI closing message, then mark ENDING.
  // FE plays the closing audio, then calls /session/end to finalize.
  @Post(':id/close') @HttpCode(200)
  async close(@Param('id') sessionId: string, @Req() req) {
    // Immediately mark as 'ending' so other logic knows the user is leaving
    await this.sessionService['repo'].update(
      { id: sessionId, userId: req.user.id },
      { status: 'ending' },
    );
    const closing = await this.sessionService.generateClosingMessage(req.user.id, sessionId);
    return { session_id: sessionId, ...closing };
  }

  // GET /session/:id/deck — get exercise deck state for a session
  @Get(':id/deck')
  getDeck(@Param('id') sessionId: string) {
    return this.sessionService.getDeck(sessionId);
  }

  // GET /session/:id/evaluation — user-facing end-of-session report.
  // Returns {status:'pending'} until consolidation finishes building it.
  @Get(':id/evaluation')
  getEvaluation(@Param('id') sessionId: string, @Req() req) {
    return this.sessionService.getEvaluation(sessionId, req.user.id);
  }

  // GET /session/:id/toolbox?topic=...&level=...&task=...&tab=vocab|phrases|sample
  // Returns LLM-generated vocab / phrase patterns / sample response
  // scoped to the current deck card context (topic, level, task description).
  @Get(':id/toolbox')
  getToolbox(
    @Param('id') sessionId: string,
    @Req() req,
    @Query('topic') topic?: string,
    @Query('level') level?: string,
    @Query('task') task?: string,
    @Query('tab') tab?: string,
  ) {
    return this.sessionService.generateToolboxContent(req.user.id, {
      sessionId,
      topic: topic ?? '',
      level: level ?? 'beginner',
      task: task ?? '',
      tab: (tab as 'vocab' | 'phrases' | 'sample') ?? 'vocab',
    });
  }

  // POST /session/:id/deck — create or replace exercise deck for a session
  @Post(':id/deck')
  createDeck(@Param('id') sessionId: string, @Body() body: { mission_source?: string; cards?: any[] }) {
    return this.sessionService.createDeck(sessionId, body);
  }

  // PUT /session/:id/deck/card — update current card (after evaluation)
  @Put(':id/deck/card')
  @HttpCode(200)
  updateDeckCard(@Param('id') sessionId: string, @Body() body: any) {
    return this.sessionService.updateDeckCard(sessionId, body);
  }

  // PUT /session/:id/deck/next — advance to next card
  @Put(':id/deck/next')
  @HttpCode(200)
  nextDeckCard(@Param('id') sessionId: string) {
    return this.sessionService.advanceDeck(sessionId);
  }

  // PUT /session/:id/deck/advance — alias for /next (backward compat)
  @Put(':id/deck/advance')
  @HttpCode(200)
  advanceDeck(@Param('id') sessionId: string) {
    return this.sessionService.advanceDeck(sessionId);
  }

  // PUT /session/:id/deck/skip — mark current card as skipped + advance
  @Put(':id/deck/skip')
  @HttpCode(200)
  skipDeckCard(@Param('id') sessionId: string) {
    return this.sessionService.skipDeckCard(sessionId);
  }

  // PUT /session/:id/deck/status — update deck status
  @Put(':id/deck/status')
  @HttpCode(200)
  updateDeckStatus(@Param('id') sessionId: string, @Body() body: { status: string }) {
    return this.sessionService.updateDeckStatus(sessionId, body.status);
  }

  // PUT /session/:id/deck/end — mark deck ended with reason
  @Put(':id/deck/end')
  @HttpCode(200)
  endDeck(@Param('id') sessionId: string, @Body() body: { end_reason?: string }) {
    return this.sessionService.endDeck(sessionId, body?.end_reason ?? 'user_clicked_end');
  }

  // PUT /session/:id/deck/regenerate — generate a fresh deck for a user-supplied topic
  @Put(':id/deck/regenerate')
  @HttpCode(200)
  regenerateDeck(@Param('id') sessionId: string, @Body() body: { topic: string }, @Req() req) {
    return this.sessionService.regenerateDeckFromTopic(req.user.id, sessionId, body.topic ?? '');
  }

  private async streamGreetingForUser(
    userId: string,
    res: Response,
    clientDatetime?: string,
    sessionId?: string,
    mode: 'guided_learning' | 'free_talk' = 'guided_learning',
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
      const [user, greetingContext, insight, todayChallenge, isOnboarding, sessionMeta] = await Promise.all([
        this.userService.findById(userId).catch(() => null),
        this.sessionService.getGreetingContext(userId),
        this.sessionService.getSessionInsight(userId),
        this.sessionService.getTodayChallenge(userId),
        sessionId
          ? this.sessionService.isOnboardingSession(userId, sessionId)
          : this.sessionService.isFirstSession(userId),
        sessionId
          ? this.sessionService.getGreetingSessionMeta(userId, sessionId)
          : Promise.resolve(null),
      ]);

      const formattedDatetime = resolveClientDatetime(clientDatetime, user?.timezone ?? 'UTC');
      const speechUrl = this.cfg.get('SPEECH_SERVICE_URL');
      const logPrefix = sessionId ? `[Greeting][session=${sessionId}]` : '[Greeting]';

      // Slim greeting: 1 snippet, max 200 chars. The greeting is one sentence —
      // it does not need (or benefit from) a long context dump. Heavy context
      // (session_insight, today_challenge, mission) is injected per-turn by the
      // turn-agent, not here.
      const MAX_CONTEXT_CHARS = 200;
      const trimmedContext = greetingContext.length > MAX_CONTEXT_CHARS
        ? greetingContext.slice(0, MAX_CONTEXT_CHARS) + '…'
        : greetingContext;

      const hasInsight = insight?.has_insight === true;
      // First-session users are force-onboarded server-side (start() ignores
      // free_talk on first session). For a returning user picking Free Talk we
      // skip the onboarding prompt entirely and use the free-talk greeting.
      const shouldUseOnboarding = isOnboarding && !hasInsight;
      const isFreeTalk = mode === 'free_talk' && !shouldUseOnboarding;
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
      const isLessonSession = !!sessionMeta?.lessonAttemptId;

      let systemPrompt: string;

      if (isLessonSession) {
        const lessonTitle = sessionMeta?.title?.trim() || 'today\'s lesson';
        systemPrompt = [
          `You are greeting a learner who has opened a structured speaking lesson.`,
          `Speak ONLY in ${targetLang}. Never switch to the user's native language.`,
          '',
          `Lesson title: ${lessonTitle}`,
          '',
          `LESSON GREETING STYLE:`,
          `1. Output EXACTLY ONE short sentence, max 16 words.`,
          `2. Mention that the lesson is starting, naturally.`,
          `3. Do NOT ask a discovery question.`,
          `4. Do NOT mention memory, missions, challenges, plans, subscriptions, or progress.`,
          `5. Do NOT explain the lesson. The first card is already visible in the UI.`,
          `6. No emojis.`,
        ].join('\n');
      } else if (isFreeTalk) {
        const { partOfDay, recentTopic, daysAgoLabel, continuityLine, absenceLine } =
          buildFreeTalkContext(user, insight, daysAgo, isAbsent5Plus);
        systemPrompt = [
          `You are a friendly AI conversation partner greeting someone for a Free Talk session.`,
          `Speak ONLY in ${targetLang}. Never switch to the user's native language.`,
          '',
          user?.name ? `Name to use: ${user.name}` : '',
          partOfDay ? `Local time of day: ${partOfDay}.` : '',
          continuityLine,
          absenceLine,
          '',
          `FREE TALK GREETING STYLE:`,
          `1. Output EXACTLY ONE short sentence (≤ 14 words). No preamble, no second sentence.`,
          `2. Tone: friend, not teacher. Casual, curious, and relaxed.`,
          `3. Pick ONE natural opener (do NOT label which):`,
          recentTopic && daysAgoLabel
            ? `   • Reference the recent topic lightly ("How did the ${recentTopic} go?" / "Still thinking about ${recentTopic}?").`
            : '',
          partOfDay
            ? `   • Soft hello tied to time of day ("Evening, ${user?.name ?? 'friend'} — long day?").`
            : '',
          `   • Simple open question ("What's on your mind?" / "Anything you want to chat about?").`,
          `4. Do NOT mention missions, exercises, challenges, practice, lessons, breakdowns, or progress.`,
          `5. Do NOT offer a menu of topics. Let the user lead.`,
          `6. No emojis. No translation. No native-language fallback.`,
        ].filter(Boolean).join('\n');
      } else if (shouldUseOnboarding) {
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
          `- Speak ONLY in ${targetLang} in every user-visible sentence.`,
          `- If the user writes or speaks in their native language, understand it silently but reply in ${targetLang}.`,
          `- Never mirror, translate into, or continue in the user's native language.`,
          `- No emojis.`,
        ].filter(Boolean).join('\n');
      } else {
        // ────────────────────────────────────────────────────────────────────
        // Slim greeting (session 2+).
        //
        // Heavy context — session_insight, today_challenge, active_mission,
        // recommendations — is NO LONGER injected here. The turn-agent owns
        // those: it injects them into every in-session turn via build_prompt_node
        // so the AI can drive practice from turn 3-4 onwards (after warm chat).
        //
        // The greeting itself is now a single warm line that may reference one
        // recent-context snippet. Replies to it are preserved by the
        // greeting_text payload mechanism (sent on the first user turn → stored
        // as turn 1 in short-term so the LLM never loses what it just asked).
        // ────────────────────────────────────────────────────────────────────
        const absenceLine = isAbsent5Plus
          ? `The user hasn't spoken in ${daysAgo} days — open gently, no enthusiasm. Do not make them feel guilty.`
          : '';

        systemPrompt = [
          `You are a warm AI speaking partner greeting a returning user.`,
          `Speak ONLY in ${targetLang}. Never switch to the user's native language, even if they use it first.`,
          `Right now: ${formattedDatetime}.`,
          '',
          user?.name ? `User: ${user.name}` : '',
          trimmedContext ? `\nOne recent snippet to weave in (only if natural — do NOT quote it verbatim):\n${trimmedContext}` : '',
          absenceLine ? `\n${absenceLine}` : '',
          '',
          `YOUR GREETING — STRICT RULES:`,
          `1. Output EXACTLY ONE sentence, max 25 words. No preamble, no second sentence.`,
          `2. Be warm and natural — if the snippet mentions an upcoming interview, meeting, exam, deadline, or appointment, make that the greeting's main context.`,
          `3. Never say "last session", "based on your insight", or quote labels.`,
          `4. Do NOT mention any challenge, practice, exercise, or mission — that is handled later in conversation, not here.`,
          `5. Ending with ONE short question is fine (the system preserves context) — or close with a soft "ready when you are".`,
          `6. No emojis. No generic openers like "Great to see you!" or "How can I help you today?".`,
          `7. If the recent snippet mentions a past event, ask how it went; if a future event, acknowledge it gently and compare to right now.`,
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
      console.log(`${logPrefix}   onboarding   : raw=${isOnboarding} effective=${shouldUseOnboarding}`);
      console.log(`${logPrefix}   mode         : requested=${mode} freeTalk=${isFreeTalk}`);
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

        // Diagnostic: greeting truncations show up as endsClean=false or an
        // abrupt tail (e.g. "...I want"). If the LLM is stopping early we'll
        // see the cut here before the FE ever does.
        const tail = fullText.slice(-80).replace(/\n/g, '\\n');
        const endsClean = /[.!?]['""]?\s*$/.test(fullText);
        console.log(
          `${logPrefix} ── greeting stream end  len=${fullText.length}  endsClean=${endsClean}  tail="${tail}"`,
        );

        send({ type: 'done', greeting: fullText });
        res.end();

        // Fire-and-forget: generate deck after greeting completes (session-tied route only)
        if (sessionId) {
          this.sessionService
            .generateDeck(userId, sessionId, user, insight, activeMission, isOnboarding)
            .catch((err) => console.error(`[Deck] generateDeck failed session=${sessionId}:`, err?.message));
        }
      });

    } catch {
      send({ type: 'error', message: 'Failed to generate greeting' });
      res.end();
    }
  }
}
