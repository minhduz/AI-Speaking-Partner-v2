'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  BillingLimitError,
  sessionService,
  type BillingLimitCode,
  type OnboardingState,
  type EndReason,
  type ExerciseDeck,
  type SessionEvaluation,
} from '@/services/session.service';
import { billingService } from '@/services/billing.service';
import { useAuthContext } from '@/contexts/auth-context';
import type { ChatMessage, TurnHistoryItem } from '@/types/session.types';

function splitSentences(text: string): string[] {
  if (!text?.trim()) return text ? [text] : [];
  const parts = text.split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

// Soniox emits control tokens like `<end>` / `<fin>` inside the streaming transcript.
// Strip them before rendering so they don't leak into the UI bubbles.
function stripSttControlTokens(text: string): string {
  if (!text) return text;
  return text.replace(/<\/?(end|fin)>/gi, '').replace(/\s+([.,!?])/g, '$1').trim();
}

// Greeting text cache — survives client-side navigation but resets on full page reload.
// Prevents re-streaming the greeting when the user navigates away and returns.
let _greetingTextCache: string[] | null = null;

const TURN_PLAYBACK_RATE = 1.15;
// Fallback reveal pace when audio is unavailable (suspended ctx / decode failure).
const FALLBACK_REVEAL_MS_PER_WORD = 220;

// Module-level singleton so the AudioContext is created exactly once and is
// available synchronously (before any React effect runs) on the client side.
let _sharedAudioCtx: AudioContext | null = null;
function getSharedAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!_sharedAudioCtx) {
    _sharedAudioCtx = new AudioContext();
    console.log(`[Audio] shared AudioContext created (singleton) — state: ${_sharedAudioCtx.state}`);
  }
  return _sharedAudioCtx;
}

export function stopAllAudio(): void {
  if (_sharedAudioCtx && _sharedAudioCtx.state !== 'closed') {
    _sharedAudioCtx.close();
  }
  _sharedAudioCtx = null;
  _greetingTextCache = null;
}

export type ChatStatus = 'idle' | 'greeting' | 'ready' | 'recording' | 'processing' | 'error';

export interface UseChatReturn {
  messages: ChatMessage[];
  status: ChatStatus;
  greetingSentences: string[];
  isRecording: boolean;
  analyser: AnalyserNode | null;
  errorMessage: string | null;
  billingLimitCode: BillingLimitCode | null;
  currentSessionId: string | null;
  sessionTitle: string | null;
  sessionTitleUpdate: { sessionId: string; title: string } | null;
  reviewMode: boolean;
  reviewSessionId: string | null;
  reviewHasMore: boolean;
  reviewLoading: boolean;
  /** Breakdown of the session being reviewed in History (null = none). */
  reviewEvaluation: SessionEvaluation | null;
  isOnboardingSession: boolean;
  onboardingState: OnboardingState | null;
  /** True while the AI closing message is playing (CLOSING_MODE). */
  isEnding: boolean;
  /** The AI closing farewell text, shown on screen while audio plays. */
  closingText: string | null;
  /** True after the closing message: show [View evaluation] / [Exit] choices. */
  endChoices: boolean;
  /** The fetched end-of-session evaluation report (null until viewed/ready). */
  evaluation: SessionEvaluation | null;
  /** True while polling for the evaluation report. */
  evaluationLoading: boolean;
  /** Fetch + show the evaluation board (polls while consolidation finishes). */
  viewEvaluation: () => Promise<void>;
  /** Leave the ended-session flow and reset to a fresh chat. */
  exitSession: () => void;
  /** True from the first mic tap until session ends. Drives layout switch in the UI. */
  sessionStarted: boolean;
  currentDeck: ExerciseDeck | null;
  lighterMode: boolean;
  advanceDeckCard: () => Promise<void>;
  skipDeckCard: () => Promise<void>;
  acceptDeckChallenge: () => Promise<void>;
  rejectDeckChallenge: () => Promise<void>;
  chooseDeckFreeTalk: () => Promise<void>;
  chooseDeckEnd: () => Promise<void>;
  enterLighterMode: () => Promise<void>;
  completeLighterDeck: () => Promise<void>;
  startMic: () => void;
  stopMic: () => void;
  endSession: (reason?: EndReason) => Promise<void>;
  startNewSession: () => void;
  enterReview: (sessionId: string) => Promise<void>;
  exitReview: () => void;
  loadMoreReview: () => Promise<void>;
}

function isEndSessionIntent(transcript: string): boolean {
  const normalized = transcript
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return false;

  return [
    // English — explicit
    'end session',
    'finish session',
    'stop session',
    'close session',
    'exit session',
    'quit session',
    'end the session',
    'finish the session',
    'stop the session',
    'close the session',
    'exit the session',
    // English — natural
    "i'm done",
    'i am done',
    "that's all",
    'that is all',
    "that's enough",
    'that is enough',
    'bye',
    'goodbye',
    'good bye',
    'see you',
    'talk later',
    'catch you later',
    // Vietnamese — natural (per spec)
    'hôm nay thế thôi',
    'hom nay the thoi',
    'hôm nay dừng đây',
    'hom nay dung day',
    'ok thôi',
    'ok thoi',
    'thôi nhé',
    'thoi nhe',
    'tạm biệt',
    'tam biet',
    'bye nhé',
    'bye nhe',
    'nghỉ nhé',
    'nghi nhe',
    'dừng lại',
    'dung lai',
    'dừng buổi',
    'dung buoi',
    'kết thúc',
    'ket thuc',
    'thoát',
    'thoat',
    'đủ rồi',
    'du roi',
    'thế đủ rồi',
    'the du roi',
    // fatigue / stop intent — common natural phrasing
    'i am tired',
    "i'm tired",
    'im tired',
    'i feel tired',
    'too tired',
    'had enough',
    "i've had enough",
    'i have had enough',
    'close the chat',
    'close chat',
    'we can close',
    'can close',
    'stop now',
    'close right now',
  ].some((phrase) => normalized.includes(phrase));
}


function revealWordsOverTime(
  text: string,
  durationMs: number,
  onWordReveal: (partial: string) => void,
): Promise<void> {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    onWordReveal(text);
    return Promise.resolve();
  }
  const intervalMs = durationMs / words.length;
  return new Promise<void>((resolve) => {
    let built = '';
    words.forEach((word, i) => {
      setTimeout(() => {
        built += (built ? ' ' : '') + word;
        onWordReveal(built);
        if (i === words.length - 1) resolve();
      }, i * intervalMs);
    });
  });
}

// Each queue item carries the spoken text and a promise that, when resolved,
// gives the scheduled playback timing (startTime in ctx.currentTime units,
// durationMs after playback rate is applied). Audio scheduling is ordered and
// eager — it happens as segments arrive, so playback is gapless.
type SegmentQueueItem = {
  text: string;
  isGreeting: boolean;
  audioReady: Promise<{ startTime: number; durationMs: number } | null>;
};

export function useChat(initialSessionId?: string): UseChatReturn {
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [greetingSentences, setGreetingSentences] = useState<string[]>([]);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [billingLimitCode, setBillingLimitCode] = useState<BillingLimitCode | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [sessionTitleUpdate, setSessionTitleUpdate] = useState<{ sessionId: string; title: string } | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [reviewHasMore, setReviewHasMore] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  // Breakdown for the session being reviewed in History (null = none/not built).
  const [reviewEvaluation, setReviewEvaluation] = useState<SessionEvaluation | null>(null);
  const [isOnboardingSession, setIsOnboardingSession] = useState(false);
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
  const [isEnding, setIsEnding] = useState(false);
  const [closingText, setClosingText] = useState<string | null>(null);
  // End-of-session evaluation flow: after the closing message we show two
  // choices ([View evaluation] / [Exit]) instead of auto-clearing.
  const [endChoices, setEndChoices] = useState(false);
  const [evaluation, setEvaluation] = useState<SessionEvaluation | null>(null);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const endedSessionIdRef = useRef<string | null>(null);
  const [currentDeck, setCurrentDeck] = useState<ExerciseDeck | null>(null);
  const [lighterMode, setLighterMode] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);

  const statusRef = useRef<ChatStatus>('idle');
  const sessionIdRef = useRef<string | null>(null);
  const reviewSessionIdRef = useRef<string | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const reviewPageRef = useRef(1);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const initializedRef = useRef(false);
  const isEndingRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const segmentQueueRef = useRef<SegmentQueueItem[]>([]);
  const segmentIdleResolversRef = useRef<(() => void)[]>([]);
  const isPlayingRef = useRef(false);
  // Tracks an in-flight session.start() so only one live session can be
  // created for the first meaningful user turn.
  const sessionStartPromiseRef = useRef<Promise<void> | null>(null);
  const isFirstSessionRef = useRef<boolean>(false);
  const pendingAutoEndRef = useRef<boolean>(false);
  const pendingAutoEndReasonRef = useRef<EndReason>('voice_intent');
  // Stable ref so processTurn can call endSession without adding it to deps.
  const endSessionRef = useRef<(reason?: EndReason) => Promise<void>>(async () => {});
  // Chains segment scheduling so audio is pushed onto the timeline in arrival order
  // even when MP3 decode of an earlier segment happens to finish later.
  const lastScheduleRef = useRef<Promise<unknown>>(Promise.resolve());
  const isStoppingRef = useRef(false);
  const sttWsRef = useRef<WebSocket | null>(null);
  const sttDoneResolverRef = useRef<((t: string) => void) | null>(null);
  const pendingStopRef = useRef(false);
  const sharedPlaybackCtxRef = useRef<AudioContext | null>(getSharedAudioCtx());

  const turnsToMessages = useCallback((items: TurnHistoryItem[]): ChatMessage[] => {
    const msgs: ChatMessage[] = [];
    for (const t of items) {
      msgs.push({ role: 'user', text: t.transcript, pronunciationScore: t.pronunciationScore ?? undefined, isHistoric: true });
      msgs.push({ role: 'ai', text: t.responseText, sentences: splitSentences(t.responseText), isHistoric: true });
    }
    return msgs;
  }, []);

  const loadReviewPage = useCallback(async (sessionId: string, page: number, prepend: boolean) => {
    setReviewLoading(true);
    try {
      const data = await sessionService.getTurns(sessionId, page, 20);
      const converted = turnsToMessages([...data.items].reverse());
      setMessages((prev) => (prepend ? [...converted, ...prev] : converted));
      setReviewHasMore(data.hasMore);
      reviewPageRef.current = page;
    } finally {
      setReviewLoading(false);
    }
  }, [turnsToMessages]);

  const setBillingLimitError = useCallback((err: BillingLimitError) => {
    setBillingLimitCode(err.code);
    if (err.code === 'SESSION_LIMIT_REACHED') {
      setErrorMessage(
        `You've used your ${err.limit ?? 10} free sessions today. Upgrade to Pro for unlimited speaking practice.`,
      );
      return;
    }
    setErrorMessage(
      `This session has reached the ${err.limit?.toLocaleString() ?? '30,000'} token limit. Start a new session or upgrade to Pro for longer practice.`,
    );
  }, []);

  const checkSessionQuota = useCallback(async () => {
    try {
      const [quota, usage] = await Promise.all([
        sessionService.getQuota().catch(() => null),
        billingService.getUsage().catch(() => null),
      ]);

      const quotaLimitReached =
        !!quota &&
        !quota.is_unlimited &&
        !quota.can_start;

      const usageLimitReached =
        !!usage &&
        !usage.is_unlimited &&
        usage.daily_session_limit > -1 &&
        usage.sessions_used >= usage.daily_session_limit;

      if (!quotaLimitReached && !usageLimitReached) return;

      setBillingLimitError(new BillingLimitError(
        'SESSION_LIMIT_REACHED',
        usage?.daily_session_limit ?? quota?.daily_session_limit ?? 10,
        Math.max(usage?.sessions_used ?? 0, quota?.sessions_used ?? 0),
      ));
    } catch (err) {
      console.error('[session quota]', err);
    }
  }, [setBillingLimitError]);

  const enterReview = useCallback(async (sessionId: string) => {
    setReviewMode(true);
    setReviewSessionId(sessionId);
    reviewSessionIdRef.current = sessionId;
    reviewPageRef.current = 1;
    setMessages([]);
    setReviewHasMore(false);
    setReviewEvaluation(null);
    // Transcript + breakdown load in parallel. The breakdown is a single DB
    // read (persisted at consolidation); null when the session has none
    // (abandoned, or predates the feature).
    void sessionService
      .getEvaluation(sessionId)
      .then((report) => {
        if (reviewSessionIdRef.current === sessionId) setReviewEvaluation(report);
      })
      .catch(() => {});
    await loadReviewPage(sessionId, 1, false);
  }, [loadReviewPage]);

  const resolveSegmentIdle = useCallback(() => {
    if (isPlayingRef.current || segmentQueueRef.current.length > 0) return;
    const resolvers = segmentIdleResolversRef.current.splice(0);
    resolvers.forEach((resolve) => resolve());
  }, []);

  const waitForSegmentIdle = useCallback((): Promise<void> => {
    if (!isPlayingRef.current && segmentQueueRef.current.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      segmentIdleResolversRef.current.push(resolve);
    });
  }, []);

  // Visual helpers — kept here so processSegmentQueue stays focused on timing.
  const appendEmptySegment = useCallback((isGreeting: boolean) => {
    if (isGreeting) {
      setGreetingSentences((prev) => [...prev, '']);
    } else {
      setMessages((prev) => {
        const msgs = [...prev];
        const idx = msgs.findLastIndex((m) => m.role === 'ai' && m.pending);
        if (idx >= 0) {
          const existing = msgs[idx];
          msgs[idx] = { ...existing, sentences: [...(existing.sentences ?? []), ''] };
        }
        return msgs;
      });
    }
  }, []);

  const updateLastSegment = useCallback((partial: string, isGreeting: boolean) => {
    if (isGreeting) {
      setGreetingSentences((prev) => {
        if (prev.length === 0) return [partial];
        const next = [...prev];
        next[next.length - 1] = partial;
        return next;
      });
    } else {
      setMessages((prev) => {
        const msgs = [...prev];
        const idx = msgs.findLastIndex((m) => m.role === 'ai' && m.pending);
        if (idx >= 0) {
          const existing = msgs[idx];
          const sentences = [...(existing.sentences ?? [])];
          if (sentences.length === 0) sentences.push(partial);
          else sentences[sentences.length - 1] = partial;
          msgs[idx] = { ...existing, sentences };
        }
        return msgs;
      });
    }
  }, []);

  // Decode MP3 → AudioBuffer; returns null on failure or suspended ctx.
  const decodeMp3 = useCallback(async (ctx: AudioContext, b64: string): Promise<AudioBuffer | null> => {
    if (!b64) return null;
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return await ctx.decodeAudioData(bytes.buffer);
    } catch (err) {
      console.error('[Audio] decode failed:', err);
      return null;
    }
  }, []);

  // Eagerly decode + schedule audio for a segment, preserving arrival order via
  // lastScheduleRef. Returns a promise resolving to the scheduled timing — used
  // by the processor to align word reveal with the actual audio start time.
  const enqueueSegment = useCallback((b64: string, text: string, isGreeting: boolean) => {
    const ctx = sharedPlaybackCtxRef.current ?? getSharedAudioCtx();
    const playbackRate = isGreeting ? 1 : TURN_PLAYBACK_RATE;

    // Decode runs in parallel for all segments; scheduling chains off the
    // previous segment's schedule so the audio timeline stays ordered.
    const decodePromise = ctx && ctx.state !== 'closed'
      ? decodeMp3(ctx, b64)
      : Promise.resolve(null);

    const audioReady = lastScheduleRef.current.then(async () => {
      const buffer = await decodePromise;
      const liveCtx = sharedPlaybackCtxRef.current ?? ctx;
      if (!buffer || !liveCtx || liveCtx.state === 'closed' || liveCtx.state === 'suspended') {
        return null;
      }
      const startTime = Math.max(liveCtx.currentTime, nextPlayTimeRef.current);
      const source = liveCtx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = playbackRate;
      source.connect(liveCtx.destination);
      source.start(startTime);
      nextPlayTimeRef.current = startTime + buffer.duration / playbackRate;
      return { startTime, durationMs: (buffer.duration * 1000) / playbackRate };
    }).catch((err) => {
      console.error('[Audio] schedule failed:', err);
      return null;
    });

    lastScheduleRef.current = audioReady;
    segmentQueueRef.current.push({ text, isGreeting, audioReady });
  }, [decodeMp3]);

  // Pulls segments off the queue one at a time. For each segment: wait until its
  // audio actually starts on the timeline, then reveal its words over the audio
  // duration. Sequential reveal + gapless audio = no drift, no layout jumps.
  const processSegmentQueue = useCallback(async () => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;
    try {
      while (segmentQueueRef.current.length > 0) {
        const item = segmentQueueRef.current.shift()!;
        const scheduled = await item.audioReady;
        const ctx = sharedPlaybackCtxRef.current ?? getSharedAudioCtx();

        appendEmptySegment(item.isGreeting);

        if (!scheduled || !ctx) {
          const wordCount = item.text.split(/\s+/).filter(Boolean).length;
          const fallbackMs = Math.max(600, wordCount * FALLBACK_REVEAL_MS_PER_WORD);
          await revealWordsOverTime(item.text, fallbackMs, (partial) =>
            updateLastSegment(partial, item.isGreeting),
          );
          continue;
        }

        const delayUntilStartMs = Math.max(0, (scheduled.startTime - ctx.currentTime) * 1000);
        if (delayUntilStartMs > 0) {
          await new Promise((r) => setTimeout(r, delayUntilStartMs));
        }
        await revealWordsOverTime(item.text, scheduled.durationMs, (partial) =>
          updateLastSegment(partial, item.isGreeting),
        );
      }
    } finally {
      isPlayingRef.current = false;
      resolveSegmentIdle();
    }
  }, [appendEmptySegment, updateLastSegment, resolveSegmentIdle]);

  // ── Greeting flow ───────────────────────────────────────────────────────────
  const runGreeting = useCallback(async () => {
    setStatus('greeting');
    setGreetingSentences([]);
    nextPlayTimeRef.current = 0;
    lastScheduleRef.current = Promise.resolve();
    const collectedSegments: string[] = [];
    try {
      const stream = await sessionService.streamGreetingAnon();
      for await (const event of stream) {
        if (event.type === 'segment') {
          collectedSegments.push(event.text);
          enqueueSegment(event.audio_b64, event.text, true);
          void processSegmentQueue();
        } else if (event.type === 'done') {
          await waitForSegmentIdle();
          if (collectedSegments.length > 0) _greetingTextCache = [...collectedSegments];
          setStatus('ready');
          return;
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
      await waitForSegmentIdle();
    } catch (err) {
      console.error('[greeting]', err);
    } finally {
      setStatus('ready');
    }
  }, [enqueueSegment, processSegmentQueue, waitForSegmentIdle]);

  const initSession = useCallback(async () => {
    setStatus('idle');
    setMessages([]);
    setErrorMessage(null);
    setBillingLimitCode(null);
    setSessionTitle(null);
    sessionIdRef.current = null;
    setCurrentSessionId(null);
    setIsOnboardingSession(false);
    setOnboardingState(null);
    void checkSessionQuota();
    if (_greetingTextCache && _greetingTextCache.length > 0) {
      setGreetingSentences(_greetingTextCache);
      setStatus('ready');
    } else {
      setGreetingSentences([]);
      await runGreeting();
    }
  }, [runGreeting, checkSessionQuota]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    if (initializedRef.current) return;
    initializedRef.current = true;
    // Direct call — initializedRef already guarantees single-run.
    // The earlier Promise.resolve().then(...) + cancelled pattern could race with
    // the cleanup fired when deps change (e.g. authLoading flipping false), leaving
    // init skipped while initializedRef stays true → greeting never fires.
    if (initialSessionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void enterReview(initialSessionId);
    } else {
      void initSession();
    }
  }, [authLoading, isAuthenticated, initSession, initialSessionId, enterReview]);

  useEffect(() => {
    const ctx = getSharedAudioCtx();
    if (!ctx) return;
    sharedPlaybackCtxRef.current = ctx;
    console.log(`[Audio] shared AudioContext on mount — state: ${ctx.state}`);

    const resume = () => {
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
          console.log(`[Audio] shared AudioContext resumed — state: ${ctx.state}`);
        }).catch(() => {});
      }
    };
    window.addEventListener('click', resume);
    window.addEventListener('keydown', resume);
    return () => {
      window.removeEventListener('click', resume);
      window.removeEventListener('keydown', resume);
      if (ctx.state !== 'closed') {
        ctx.close();
      }
      _sharedAudioCtx = null;
      sharedPlaybackCtxRef.current = null;
    };
  }, []);

  useEffect(() => {
    const endOnLeave = () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      sessionIdRef.current = null;
      setCurrentSessionId(null);
      sessionService.endBeacon(sid); // sends reason: 'tab_close'
    };
    window.addEventListener('beforeunload', endOnLeave);
    return () => {
      window.removeEventListener('beforeunload', endOnLeave);
      endOnLeave();
    };
  }, []);

  // Keep statusRef in sync so callbacks that run within the same React batch
  // (e.g. stopMic called from touchend before re-render) read the latest value.
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Poll onboarding state only during the user's first speaking session.
  // The extractor on the backend writes to Redis after each turn; we surface
  // its progress to the "Learning about you..." panel here.
  useEffect(() => {
    if (!isOnboardingSession || !currentSessionId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const next = await sessionService.getOnboardingState();
        if (!cancelled) setOnboardingState(next);
      } catch (err) {
        console.error('[onboarding-state poll]', err);
      }
    };

    void poll();
    const interval = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isOnboardingSession, currentSessionId]);

  // Fetch deck for the current session. Lifted out of the polling effect so
  // event-driven re-polls (after session start, after a turn ends) can reuse it
  // without spinning up a parallel interval.
  const pollDeck = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const deck = await sessionService.getDeck(sid);
      if (sessionIdRef.current !== sid) return;
      // Never let a stale poll revert to a lower card index — this can happen
      // when the interval fires while advanceDeckCard's PUT is still in flight,
      // causing the auto-advance useEffect to re-trigger for an already-passed card.
      setCurrentDeck((prev) => {
        // Don't restore a deck the user already dismissed (e.g. chose free-talk / end).
        // If currentDeck is null and the fetched deck is ended/abandoned, keep it null.
        if (!prev && deck && (deck.status === 'ended_early' || deck.status === 'abandoned')) return prev;
        if (prev && deck && deck.current_card_index < prev.current_card_index) return prev;
        return deck;
      });
    } catch { /* silent — 3s interval will retry */ }
  }, []);

  // Poll deck state every 3s as a safety net. Event-driven re-polls after the
  // first meaningful turn starts a session, and after `done`, beat the interval
  // for responsiveness; this just catches anything missed.
  useEffect(() => {
    if (!currentSessionId) return;
    void pollDeck();
    const interval = window.setInterval(pollDeck, 3000);
    return () => {
      window.clearInterval(interval);
      setCurrentDeck(null);
    };
  }, [currentSessionId, pollDeck]);

  const hasSpokenRef = useRef(false);
  const checkVolumeIntervalRef = useRef<number | null>(null);

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    // Re-use the AudioContext pre-created by startMic in the gesture handler.
    // If for some reason it wasn't set, fall back to creating one here.
    const audioCtx = (audioCtxRef.current && audioCtxRef.current.state !== 'closed')
      ? audioCtxRef.current
      : new AudioContext();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 256;
    source.connect(analyserNode);
    setAnalyser(analyserNode);

    hasSpokenRef.current = false;
    let spokenFrames = 0;
    const dataArray = new Uint8Array(analyserNode.fftSize);
    checkVolumeIntervalRef.current = window.setInterval(() => {
      analyserNode.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const amplitude = (dataArray[i] - 128) / 128;
        sum += amplitude * amplitude;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      if (rms > 0.03) {
        spokenFrames++;
        if (spokenFrames >= 3) hasSpokenRef.current = true;
      }
    }, 100);

    const speechBase = (process.env.NEXT_PUBLIC_SPEECH_SERVICE_URL ?? 'http://localhost:8010')
      .replace(/^http(s?):\/\//, (_: string, s: string) => `ws${s}://`);
    const ws = new WebSocket(`${speechBase}/stt/ws`);
    sttWsRef.current = ws;

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'word') {
        const cleanText = stripSttControlTokens(data.text ?? '');
        setMessages((prev) => {
          const msgs = [...prev];
          const idx = msgs.findLastIndex((m) => m.role === 'user' && m.pending);
          if (idx >= 0) msgs[idx] = { ...msgs[idx], text: cleanText };
          return msgs;
        });
      } else if (data.type === 'done' || data.type === 'error') {
        sttWsRef.current = null;
        ws.close();
        sttDoneResolverRef.current?.(stripSttControlTokens(data.transcript ?? ''));
        sttDoneResolverRef.current = null;
      }
    };
    ws.onclose = () => {
      if (sttWsRef.current === ws) sttWsRef.current = null;
      sttDoneResolverRef.current?.('');
      sttDoneResolverRef.current = null;
    };

    if (ws.readyState !== WebSocket.OPEN) {
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener('error', () => reject(new Error('STT WebSocket failed to connect')), { once: true });
      });
    }

    setMessages((prev) => [...prev, { role: 'user', text: '', pending: true }]);

    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        e.data.arrayBuffer().then((buf) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(buf);
        });
      }
    };
    recorder.start(50);
    setStatus('recording');
  }, [setMessages]);

  const stopRecording = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      if (checkVolumeIntervalRef.current !== null) {
        window.clearInterval(checkVolumeIntervalRef.current);
        checkVolumeIntervalRef.current = null;
      }
      const recorder = recorderRef.current!;
      const ws = sttWsRef.current;
      sttDoneResolverRef.current = resolve;
      recorder.onstop = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ end: true }));
        } else {
          resolve('');
        }
      };
      recorder.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const recCtx = audioCtxRef.current;
      if (recCtx && recCtx.state !== 'closed') recCtx.close();
      setAnalyser(null);
    });
  }, []);

  // ── Turn flow ───────────────────────────────────────────────────────────────
  const processTurn = useCallback(async (transcript: string) => {
    const trimmedTranscript = transcript.trim();
    let sessionId = sessionIdRef.current;
    // Capture FIRST-TURN-OF-SESSION before the session-start block runs.
    // We pass the greeting text to the backend only on the turn that actually
    // creates the session — so the AI's previous turn (the greeting it just
    // said out loud) is preserved as turn 0 in short-term memory.
    const isFirstTurnOfSession = !sessionId;
    if (!sessionId) {
      if (!trimmedTranscript) return;

      try {
        if (!sessionStartPromiseRef.current) {
          sessionStartPromiseRef.current = sessionService
            .start()
            .then(({ session_id, is_first_session }) => {
              sessionIdRef.current = session_id;
              setCurrentSessionId(session_id);
              isFirstSessionRef.current = Boolean(is_first_session);
            })
            .finally(() => { sessionStartPromiseRef.current = null; });
        }
        await sessionStartPromiseRef.current;
        sessionId = sessionIdRef.current;
        if (!sessionId) return;
        setIsOnboardingSession(isFirstSessionRef.current);
        window.setTimeout(() => { void pollDeck(); }, 600);
        window.setTimeout(() => { void pollDeck(); }, 1800);
      } catch (err) {
        setMessages((prev) => prev.filter((m) => !m.pending));
        if (err instanceof BillingLimitError) {
          setBillingLimitError(err);
        } else {
          setBillingLimitCode(null);
          setErrorMessage('Failed to start session');
        }
        setStatus('error');
        return;
      }
    }

    setStatus('processing');
    setErrorMessage(null);
    setBillingLimitCode(null);
    nextPlayTimeRef.current = 0;
    lastScheduleRef.current = Promise.resolve();

    setGreetingSentences([]);
    setMessages((prev) => {
      const withoutPending = prev.filter((m) => !m.pending);
      const userBubble = transcript.trim()
        ? [{ role: 'user' as const, text: transcript }]
        : [];
      return [...withoutPending, ...userBubble, { role: 'ai', text: '', sentences: [], pending: true }];
    });

    // First turn of session: send the greeting text we just played back to the
    // user so the turn-agent can (a) inject it as the AI's prior message for
    // this turn's LLM call, and (b) persist it as turn 0 in short-term memory.
    // Without this, the AI would not know what question it just asked → would
    // re-ask or respond out of context on the user's first reply.
    const greetingTextForBE = isFirstTurnOfSession && _greetingTextCache && _greetingTextCache.length > 0
      ? _greetingTextCache.join(' ').trim()
      : undefined;
    if (isFirstTurnOfSession) {
      // Consume the cache — the greeting has now been bound to this session.
      // Future "New Chat" within the same auth lifetime will re-stream a fresh
      // greeting via runGreeting().
      _greetingTextCache = null;
    }

    try {
      const stream = await sessionService.streamTurnText(sessionId, transcript, greetingTextForBE);
      for await (const event of stream) {
        if (sessionIdRef.current !== sessionId) {
          segmentQueueRef.current = [];
          return;
        }
        if (event.type === 'segment') {
          enqueueSegment(event.audio_b64, event.text, false);
          void processSegmentQueue();
        } else if (event.type === 'eval') {
          // Optimistic deck update — apply the eval immediately so Retry/Next/Finish
          // buttons appear within ~ms of the turn ending. The 3s poll in the deck
          // effect will reconcile against memory-service shortly after.
          setCurrentDeck((prev) => {
            if (!prev || prev.current_card_index !== event.card_index) return prev;
            const cards = [...prev.cards];
            const card = cards[event.card_index];
            if (!card) return prev;
            const attempts = (card.attempts ?? 0) + 1;
            const passed = event.data.passed;
            cards[event.card_index] = {
              ...card,
              attempts,
              status: passed ? 'completed' : 'in_progress',
              result: passed ? 'passed' : attempts >= 3 ? 'partial' : 'not_passed',
              feedback: event.data.feedback,
              next_action: event.data.nextAction,
            };
            return { ...prev, cards };
          });
        } else if (event.type === 'title') {
          setSessionTitleUpdate({ sessionId, title: event.text });
        } else if (event.type === 'session_ended') {
          // LLM emitted SESSION_END marker. Do not close immediately here:
          // wait for the `done` event so the current farewell audio/text finishes,
          // then run the normal closing overlay flow via voice_intent.
          pendingAutoEndRef.current = true;
          pendingAutoEndReasonRef.current = 'voice_intent';
        } else if (event.type === 'deck_new_topic') {
          // User chose a new topic during continuation offer — regenerate the deck.
          const topic = event.topic;
          if (sessionId && topic) {
            try {
              await sessionService.regenerateDeck(sessionId, topic);
              void pollDeck();
            } catch (err) {
              console.error('[deck_new_topic] regenerate failed', err);
            }
          }
        } else if (event.type === 'done') {
          // Wait for all segments to finish revealing before flipping pending → false.
          // The bubble was already rendered via `sentences[]`, so no layout change.
          await waitForSegmentIdle();
          setMessages((prev) => {
            const msgs = [...prev];
            const idx = msgs.findLastIndex((m) => m.role === 'ai');
            if (idx >= 0) {
              const sentences = msgs[idx].sentences ?? [];
              msgs[idx] = {
                ...msgs[idx],
                pending: false,
                text: sentences.join(' '),
                sentences,
              };
            }
            return msgs;
          });
          // Reconcile deck from Redis — covers the case where the SSE `eval`
          // event was dropped/raced, and catches deck-status transitions
          // (e.g. `completed` after the final card) that the eval event alone
          // doesn't carry.
          void pollDeck();
          setStatus('ready');
          if (pendingAutoEndRef.current) {
            pendingAutoEndRef.current = false;
            const reason = pendingAutoEndReasonRef.current;
            await new Promise((r) => setTimeout(r, 1200));
            if (sessionIdRef.current === sessionId) {
              void endSessionRef.current(reason);
            }
          }
          return;
        } else if (event.type === 'error') {
          if (event.message === 'SESSION_TOKEN_LIMIT_REACHED') {
            throw new BillingLimitError('SESSION_TOKEN_LIMIT_REACHED', event.limit, event.used);
          }
          throw new Error(event.message);
        }
      }
      await waitForSegmentIdle();
      setMessages((prev) => {
        const msgs = [...prev];
        const idx = msgs.findLastIndex((m) => m.role === 'ai');
        if (idx >= 0) {
          const sentences = msgs[idx].sentences ?? [];
          msgs[idx] = { ...msgs[idx], pending: false, text: sentences.join(' '), sentences };
        }
        return msgs;
      });
      setStatus('ready');
    } catch (err) {
      setMessages((prev) => prev.filter((m) => !m.pending));
      if (err instanceof BillingLimitError) {
        setBillingLimitError(err);
      } else {
        setBillingLimitCode(null);
        setErrorMessage(err instanceof Error ? err.message : 'Turn failed');
      }
      setStatus('error');
    }
  }, [enqueueSegment, processSegmentQueue, setBillingLimitError, waitForSegmentIdle, pollDeck]);

  const exitReview = useCallback(() => {
    setReviewMode(false);
    setReviewSessionId(null);
    reviewSessionIdRef.current = null;
    reviewPageRef.current = 1;
    setMessages([]);
    setReviewHasMore(false);
  }, []);

  /**
   * Tear down the ended-session UI and return to a fresh chat. Called when the
   * user taps "Exit", or directly on silent (idle/tab) ends.
   */
  const finalizeExit = useCallback(() => {
    setEndChoices(false);
    setEvaluation(null);
    setEvaluationLoading(false);
    endedSessionIdRef.current = null;
    setIsEnding(false);
    setClosingText(null);
    setMessages([]);
    setStatus('ready');
    isEndingRef.current = false;
    // Clear the greeting cache so the next initSession fetches a FRESH greeting
    // (session 2+ slim variant) instead of replaying the ended session's
    // onboarding-style greeting from cache.
    _greetingTextCache = null;
    void initSession();
  }, [initSession]);

  const endSession = useCallback(async (reason: EndReason = 'user_clicked') => {
    // Guard: don't double-trigger
    if (isEndingRef.current) return;
    isEndingRef.current = true;
    pendingAutoEndRef.current = false;

    // Clear idle timer
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    setReviewMode(false);
    setReviewSessionId(null);
    reviewSessionIdRef.current = null;
    reviewPageRef.current = 1;
    setReviewHasMore(false);

    if (checkVolumeIntervalRef.current !== null) {
      window.clearInterval(checkVolumeIntervalRef.current);
      checkVolumeIntervalRef.current = null;
    }
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (sttWsRef.current) {
      sttWsRef.current.close();
      sttWsRef.current = null;
    }
    segmentQueueRef.current = [];
    lastScheduleRef.current = Promise.resolve();
    sttDoneResolverRef.current?.('');
    sttDoneResolverRef.current = null;
    pendingStopRef.current = false;
    isStoppingRef.current = false;

    sessionStartPromiseRef.current = null;
    setSessionStarted(false);
    const prevSessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    setCurrentSessionId(null);
    setIsOnboardingSession(false);
    setOnboardingState(null);
    setErrorMessage(null);
    setBillingLimitCode(null);

    // CLOSING_MODE: only when user deliberately ends (button or voice intent)
    // For idle/tab_close we skip the closing message since user isn't there.
    const shouldClose = prevSessionId && (reason === 'user_clicked' || reason === 'voice_intent');

    if (shouldClose) {
      // Show overlay IMMEDIATELY — don't wait for LLM to return
      setIsEnding(true);
      setClosingText(null);
      setStatus('processing');

      try {
        const closing = await sessionService.close(prevSessionId!);

        if (closing.text) {
          // Update closingText state — this drives the overlay display.
          // Do NOT push to messages here; closing text is shown via overlay only.
          setClosingText(closing.text);
        }

        // Play TTS if available
        if (closing.audio_b64) {
          const ctx = sharedPlaybackCtxRef.current ?? getSharedAudioCtx();
          if (ctx && ctx.state !== 'closed') {
            try {
              // Force-reset isPlayingRef — the previous turn's audio may still have
              // it locked to true even though we cleared the queue above.
              isPlayingRef.current = false;
              const buffer = await decodeMp3(ctx, closing.audio_b64);
              if (buffer && ctx.state !== 'suspended') {
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                await new Promise<void>((resolve) => {
                  const safety = setTimeout(resolve, 40000); // hard 40s cap
                  source.onended = () => {
                    clearTimeout(safety);
                    resolve();
                  };
                  source.start();
                });
              }
            } catch {
              // ignore audio errors — proceed to end
            }
          }
        } else if (closing.text) {
          // No audio — show text for 3s
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (err) {
        console.error('[endSession] closing failed:', err);
      }
    }

    // Hard-end: mark session in DB + trigger consolidation. Consolidation also
    // builds the user-facing evaluation report (fetched later via viewEvaluation).
    if (prevSessionId) {
      await sessionService.end(prevSessionId, reason).catch(console.error);
    }

    // Deliberate close → keep the overlay up and offer the evaluation board
    // before leaving. Silent ends (idle/tab) skip straight to cleanup.
    if (shouldClose && prevSessionId) {
      endedSessionIdRef.current = prevSessionId;
      setEndChoices(true);
      setStatus('ready');
      isEndingRef.current = false;
      return;
    }

    finalizeExit();
  }, [decodeMp3, finalizeExit]);

  /**
   * Fetch the evaluation report for the just-ended session, polling while
   * consolidation finishes (BE returns null until ready, ~up to 30s).
   */
  const viewEvaluation = useCallback(async () => {
    const sid = endedSessionIdRef.current;
    if (!sid) return;
    setEvaluationLoading(true);
    // Consolidation (LLM extraction + embeddings) can take a while; poll up to 45s.
    const deadline = Date.now() + 45000;
    let report: SessionEvaluation | null = null;
    while (Date.now() < deadline) {
      report = await sessionService.getEvaluation(sid).catch(() => null);
      if (report) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    setEvaluation(report);
    setEvaluationLoading(false);
  }, []);

  /** "Exit" button — leave the evaluation flow and reset to a fresh chat. */
  const exitSession = useCallback(() => {
    finalizeExit();
  }, [finalizeExit]);

  // Keep the ref pointing at the latest endSession so processTurn can call it
  // without adding endSession to processTurn's dependency array.
  useEffect(() => { endSessionRef.current = endSession; }, [endSession]);

  const advanceDeckCard = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    try {
      await sessionService.advanceDeckCard(sessionId);
      const deck = await sessionService.getDeck(sessionId);
      setCurrentDeck(deck);
      if (deck) {
        if (deck.status === 'in_progress' && deck.cards[deck.current_card_index]) {
          // More cards remain — AI introduces the next one.
          void processTurn('');
        } else if (deck.status === 'completed' || deck.status === 'ended_early') {
          // Last card done — AI transitions back to free conversation.
          void processTurn('');
        }
      }
    } catch (err) {
      console.error('[advanceDeckCard]', err);
    }
  }, [processTurn]);

  const skipDeckCard = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    try {
      await sessionService.skipDeckCard(sessionId);
      const deck = await sessionService.getDeck(sessionId);
      setCurrentDeck(deck);
      if (deck) {
        if (deck.status === 'in_progress' && deck.cards[deck.current_card_index]) {
          // Mid-deck skip: AI introduces the next card's task.
          void processTurn('');
        } else if (deck.status === 'completed' || deck.status === 'ended_early') {
          // Last card skipped: AI asks what was difficult or if user wants another topic.
          void processTurn('');
        }
      }
    } catch (err) {
      console.error('[skipDeckCard]', err);
    }
  }, [processTurn]);

  const acceptDeckChallenge = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    try {
      await sessionService.acceptDeckChallenge(sessionId);
      const deck = await sessionService.getDeck(sessionId);
      setCurrentDeck(deck);
      // Trigger AI turn so it reads the card task and encourages the user to begin
      void processTurn('');
    } catch (err) {
      console.error('[acceptDeckChallenge]', err);
    }
  }, [processTurn]);

  const rejectDeckChallenge = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    try {
      await sessionService.rejectDeckChallenge(sessionId);
      setCurrentDeck(null);
      void processTurn('');
    } catch (err) {
      console.error('[rejectDeckChallenge]', err);
    }
  }, [processTurn]);

  const chooseDeckFreeTalk = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    try {
      await sessionService.rejectDeckWithMode(sessionId, 'user_chose_free_talk');
      setCurrentDeck(null);
      void processTurn('');
    } catch (err) {
      console.error('[chooseDeckFreeTalk]', err);
    }
  }, [processTurn]);

  const chooseDeckEnd = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    try {
      await sessionService.rejectDeckWithMode(sessionId, 'user_wants_to_end');
      setCurrentDeck(null);
      void processTurn('');
    } catch (err) {
      console.error('[chooseDeckEnd]', err);
    }
  }, [processTurn]);

  /** Accept the deck in lighter mode — AI immediately presents the card task. */
  const enterLighterMode = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    try {
      await sessionService.acceptDeckChallenge(sessionId);
      const deck = await sessionService.getDeck(sessionId);
      setCurrentDeck(deck);
      setLighterMode(true);
      void processTurn('');
    } catch (err) {
      console.error('[enterLighterMode]', err);
    }
  }, [processTurn]);

  /** Force-complete the deck after the quick-task card finishes, then pivot to free chat. */
  const completeLighterDeck = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    setLighterMode(false);
    try {
      await sessionService.completeLighterDeck(sessionId);
      const deck = await sessionService.getDeck(sessionId);
      setCurrentDeck(deck);
      void processTurn('');
    } catch (err) {
      console.error('[completeLighterDeck]', err);
    }
  }, [processTurn]);

  const loadMoreReview = useCallback(async () => {
    const sessionId = reviewSessionIdRef.current;
    if (!sessionId || !reviewHasMore || reviewLoading) return;
    await loadReviewPage(sessionId, reviewPageRef.current + 1, true);
  }, [reviewHasMore, reviewLoading, loadReviewPage]);

  const runStop = useCallback(() => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;
    stopRecording()
      .then((transcript) => {
        isStoppingRef.current = false;
        if (!hasSpokenRef.current) {
          setMessages((prev) => prev.filter((m) => !m.pending));
          setErrorMessage("You didn't say anything. Please try again.");
          if (!sessionIdRef.current) setSessionStarted(false);
          setStatus('ready');
          return;
        }
        if (isEndSessionIntent(transcript)) {
          // Universal voice-close flow: let the AI say a natural farewell first,
          // then auto-close after the streamed audio finishes. This covers
          // "bye", "I'm tired", "close the chat", "that's enough", etc.
          pendingAutoEndRef.current = true;
          pendingAutoEndReasonRef.current = 'voice_intent';
          return processTurn(transcript);
        }
        // Reset idle timer on every completed turn
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => {
          const sid = sessionIdRef.current;
          if (sid && !isEndingRef.current) {
            console.log('[idle] 15-min timeout — auto-ending session');
            void endSession('idle_timeout');
          }
        }, 15 * 60 * 1000);
        return processTurn(transcript);
      })
      .catch((err) => {
        isStoppingRef.current = false;
        console.error(err);
      });
  }, [stopRecording, processTurn, endSession]);

  const startMic = useCallback(() => {
    if (statusRef.current !== 'ready' && statusRef.current !== 'error') return;
    if (billingLimitCode === 'SESSION_LIMIT_REACHED') return;
    statusRef.current = 'recording';
    isStoppingRef.current = false;
    pendingStopRef.current = false;


    // Create AudioContext HERE, synchronously inside the gesture handler (mousedown /
    // touchstart), so mobile browsers see it as user-initiated and start it in 'running'
    // state. If created later inside a .then() after a network call, the gesture context
    // has expired and the context is created 'suspended' — causing the analyser to return
    // silence and hasSpokenRef to never become true.
    const prevCtx = audioCtxRef.current;
    if (prevCtx && prevCtx.state !== 'closed') prevCtx.close();
    audioCtxRef.current = new AudioContext();

    setStatus('recording');
    setSessionStarted(true);

    startRecording()
      .then(() => {
        if (pendingStopRef.current) {
          pendingStopRef.current = false;
          runStop();
        }
      })
      .catch((err) => {
        console.error('[startMic]', err);
        pendingStopRef.current = false;
        const ctx = audioCtxRef.current;
        if (ctx && ctx.state !== 'closed') ctx.close();
        audioCtxRef.current = null;
        setStatus('ready');
        if (!sessionIdRef.current) setSessionStarted(false);
        if (err instanceof BillingLimitError) {
          setBillingLimitError(err);
        } else {
          setBillingLimitCode(null);
          setErrorMessage('Failed to start recording');
        }
      });
  }, [billingLimitCode, setBillingLimitError, startRecording, runStop]);

  const stopMic = useCallback(() => {
    if (statusRef.current !== 'recording') return;
    if (isStoppingRef.current) return;
    if (!recorderRef.current || recorderRef.current.state !== 'recording') {
      pendingStopRef.current = true;
      return;
    }
    runStop();
  }, [runStop]);

  const startNewSession = useCallback(() => {
    setReviewMode(false);
    setReviewSessionId(null);
    reviewSessionIdRef.current = null;
    reviewPageRef.current = 1;
    setReviewHasMore(false);

    if (sttWsRef.current) {
      sttWsRef.current.close();
      sttWsRef.current = null;
    }
    sttDoneResolverRef.current = null;

    sessionStartPromiseRef.current = null;
    setSessionStarted(false);
    const prevSessionId = sessionIdRef.current;
    if (prevSessionId) {
      sessionService.end(prevSessionId, 'user_clicked').catch(console.error);
      sessionIdRef.current = null;
      setCurrentSessionId(null);
    }

    const ctx = sharedPlaybackCtxRef.current;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    // Reset chat state but reuse the cached greeting — we only restream on
    // login or full page reload, not when the user clicks "New Chat" or
    // comes back from an old session.
    setMessages([]);
    setErrorMessage(null);
    setBillingLimitCode(null);
    setSessionTitle(null);
    sessionIdRef.current = null;
    setCurrentSessionId(null);
    if (_greetingTextCache && _greetingTextCache.length > 0) {
      setGreetingSentences(_greetingTextCache);
      setStatus('ready');
      return;
    }
    // No cache (rare — e.g. first session creation failed earlier) → stream fresh.
    initializedRef.current = false;
    initSession().then(() => { initializedRef.current = true; });
  }, [initSession]);

  return {
    messages,
    status,
    greetingSentences,
    isRecording: status === 'recording',
    analyser,
    errorMessage,
    billingLimitCode,
    currentSessionId,
    sessionTitle,
    sessionTitleUpdate,
    reviewMode,
    reviewSessionId,
    reviewHasMore,
    reviewLoading,
    reviewEvaluation,
    isOnboardingSession,
    onboardingState,
    isEnding,
    closingText,
    endChoices,
    evaluation,
    evaluationLoading,
    viewEvaluation,
    exitSession,
    sessionStarted,
    currentDeck,
    lighterMode,
    advanceDeckCard,
    skipDeckCard,
    acceptDeckChallenge,
    rejectDeckChallenge,
    chooseDeckFreeTalk,
    chooseDeckEnd,
    enterLighterMode,
    completeLighterDeck,
    startMic,
    stopMic,
    endSession,
    startNewSession,
    enterReview,
    exitReview,
    loadMoreReview,
  };
}
