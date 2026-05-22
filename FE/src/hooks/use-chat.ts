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
  type SessionMode,
} from '@/services/session.service';
import { billingService } from '@/services/billing.service';
import { userService } from '@/services/user.service';
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
type GreetingCache = Partial<Record<SessionMode, string[]>>;
let _greetingTextCache: GreetingCache = {};

// Single-flight lock for the greeting stream. The cache above only guards
// AFTER a greeting finishes; without this, a route-change/remount while the
// greeting is still streaming (cache still null) would fire a second
// /session/greeting/stream request → duplicate greeting. The first caller owns
// the stream (audio + cache); any caller that mounts while a stream is in
// flight subscribes to this promise instead of starting its own request.
let _greetingInFlight: { mode: SessionMode; promise: Promise<string[]> } | null = null;
let _greetingAbort: AbortController | null = null;

// Abort the in-flight greeting (if any) and clear the lock. Call this BEFORE
// clearing _greetingTextCache + re-initing (logout / end-session reset), so the
// next runGreeting starts a FRESH request instead of subscribing to the stream
// we're trying to discard.
function resetGreetingFlight(): void {
  if (_greetingAbort) {
    _greetingAbort.abort();
    _greetingAbort = null;
  }
  _greetingInFlight = null;
}

// Fallback reveal pace when audio is unavailable (suspended ctx / decode failure).
const FALLBACK_REVEAL_MS_PER_WORD = 220;

// Speech rate applied to scheduled TTS playback. The Soniox TTS API has no
// speed parameter, so the user's "Speech speed" setting is enforced client-side
// via Web Audio's playbackRate. Held at module scope so the settings panel can
// push live updates without needing to re-render the chat tree.
let _userSpeechRate = 1.0;
export function setUserSpeechRate(rate: number): void {
  _userSpeechRate = Math.max(0.75, Math.min(1.5, rate));
}

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
  // Logout / hard reset: abort any streaming greeting (cancels the SSE fetch)
  // before dropping the cache, so it can't repopulate the cache afterwards.
  resetGreetingFlight();
  _greetingTextCache = {};
}

export type ChatStatus = 'idle' | 'greeting' | 'ready' | 'recording' | 'processing' | 'error';

export interface UseChatReturn {
  messages: ChatMessage[];
  status: ChatStatus;
  isSpeaking: boolean;
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
  /** Mode the user has picked on the greeting card for the NEXT session. */
  nextSessionMode: SessionMode;
  /** First session must be guided onboarding; mode select unlocks from session 2. */
  modeSelectionLocked: boolean;
  /** Update the next-session mode (pre-session toggle). Locked during a live session. */
  setNextSessionMode: (mode: SessionMode) => void;
  /** Effective mode of the live session — echoed from BE (onboarding can override). */
  activeSessionMode: SessionMode | null;
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
  // Reactive mirror of isPlayingRef — true while the agent's TTS is actually
  // playing. Drives UI gating (e.g. the deck Next button stays disabled until
  // the agent finishes speaking). Kept as state because isPlayingRef is a ref.
  const [isSpeaking, setIsSpeaking] = useState(false);
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
  // Mode picked on the greeting card. Locked once the session starts; only
  // the next session can change it. Persisted in localStorage so the
  // selection survives reloads.
  const [nextSessionMode, setNextSessionModeState] = useState<SessionMode>(() => {
    if (typeof window === 'undefined') return 'guided_learning';
    const saved = window.localStorage.getItem('speakup_next_session_mode');
    return saved === 'free_talk' || saved === 'guided_learning' ? saved : 'guided_learning';
  });
  const [modeSelectionLocked, setModeSelectionLocked] = useState(true);
  // The mode actually in effect for the live session (echoed back from BE,
  // since onboarding can force guided_learning even if user picked free_talk).
  const [activeSessionMode, setActiveSessionMode] = useState<SessionMode | null>(null);
  const activeSessionModeRef = useRef<SessionMode | null>(null);

  useEffect(() => {
    activeSessionModeRef.current = activeSessionMode;
  }, [activeSessionMode]);

  // Hydrate the next-session mode from localStorage once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('speakup_next_session_mode');
    if (saved === 'free_talk' || saved === 'guided_learning') {
      setNextSessionModeState(saved);
    }
  }, []);

  // Public setter — also persists. Refuses to change mode while a session is
  // already live (sessionId is set) so we don't desync FE state vs BE.
  const setNextSessionMode = useCallback((mode: SessionMode) => {
    if (sessionIdRef.current || modeSelectionLocked) {
      console.warn('[mode-debug] setNextSessionMode BLOCKED', {
        requested: mode,
        hasLiveSession: !!sessionIdRef.current,
        modeSelectionLocked,
      });
      return;
    }
    console.log('[mode-debug] setNextSessionMode →', mode);
    setNextSessionModeState(mode);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('speakup_next_session_mode', mode);
    }
  }, [modeSelectionLocked]);
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
  // Tracks whether THIS component instance is still mounted. The greeting stream
  // is owned at module level and outlives a route-change unmount, so its
  // completion callbacks must not setState into an instance that's gone.
  const mountedRef = useRef(true);
  const lastGreetingModeRef = useRef<SessionMode | null>(null);
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

      const history = typeof quota?.is_first_session === 'boolean'
        ? null
        : await sessionService.list(1, 1).catch(() => null);
      const firstSession = typeof quota?.is_first_session === 'boolean'
        ? quota.is_first_session
        : (history?.total ?? 0) === 0;
      setModeSelectionLocked(firstSession);
      if (firstSession) {
        setNextSessionModeState('guided_learning');
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('speakup_next_session_mode', 'guided_learning');
        }
      }

      // The orchestrator quota is the single source of truth for the *daily*
      // gate: quota.sessions_used counts sessions started today. Do NOT gate on
      // billing's usage.sessions_used — that's a *monthly* cumulative count, so
      // comparing it to the daily limit would keep the user blocked for the rest
      // of the month once they hit 10 in a day.
      const quotaLimitReached =
        !!quota &&
        !quota.is_unlimited &&
        !quota.can_start;

      if (!quotaLimitReached) return quota;

      setBillingLimitError(new BillingLimitError(
        'SESSION_LIMIT_REACHED',
        quota?.daily_session_limit ?? usage?.daily_session_limit ?? 10,
        quota?.sessions_used ?? 0,
      ));
      return quota;
    } catch (err) {
      console.error('[session quota]', err);
      setModeSelectionLocked(true);
      setNextSessionModeState('guided_learning');
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('speakup_next_session_mode', 'guided_learning');
      }
      return null;
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
    void (async () => {
      const deadline = Date.now() + 30000;
      let bestReport: SessionEvaluation | null = null;
      while (Date.now() < deadline) {
        const report = await sessionService.getEvaluation(sessionId).catch(() => null);
        if (report) {
          bestReport = report;
          if (report.quality !== 'basic') break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (reviewSessionIdRef.current === sessionId) setReviewEvaluation(bestReport);
    })();
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
    const playbackRate = _userSpeechRate;

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
    if (mountedRef.current) setIsSpeaking(true);
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
      if (mountedRef.current) setIsSpeaking(false);
      resolveSegmentIdle();
    }
  }, [appendEmptySegment, updateLastSegment, resolveSegmentIdle]);

  // ── Greeting flow ───────────────────────────────────────────────────────────
  const runGreeting = useCallback(async (modeOverride?: SessionMode) => {
    const greetingMode = modeOverride ?? nextSessionMode;
    lastGreetingModeRef.current = greetingMode;
    setStatus('greeting');
    setGreetingSentences([]);

    // Cache filled (possibly between initSession's check and now) → render it.
    const cachedGreeting = _greetingTextCache[greetingMode];
    if (cachedGreeting && cachedGreeting.length > 0) {
      if (mountedRef.current) {
        setGreetingSentences(cachedGreeting);
        setStatus('ready');
      }
      return;
    }

    // Another instance is already streaming the greeting (route-change remount
    // during stream). Subscribe to its result and render the text — don't fire a
    // second request. Audio belongs to the instance that owns the stream; the
    // remounted view shows text only (the prior AudioContext was closed on
    // unmount anyway).
    if (_greetingInFlight?.mode === greetingMode) {
      try {
        const segments = await _greetingInFlight.promise;
        if (mountedRef.current) {
          setGreetingSentences(segments);
          setStatus('ready');
        }
      } catch {
        if (mountedRef.current) setStatus('ready');
      }
      return;
    }
    if (_greetingInFlight) resetGreetingFlight();

    // We own the stream: reset audio scheduling and start exactly one request.
    nextPlayTimeRef.current = 0;
    lastScheduleRef.current = Promise.resolve();
    const collectedSegments: string[] = [];
    _greetingAbort = new AbortController();
    const signal = _greetingAbort.signal;

    const flight = (async (): Promise<string[]> => {
      const stream = await sessionService.streamGreetingAnon(signal, greetingMode);
      for await (const event of stream) {
        if (event.type === 'segment') {
          collectedSegments.push(event.text);
          enqueueSegment(event.audio_b64, event.text, true);
          void processSegmentQueue();
        } else if (event.type === 'done') {
          await waitForSegmentIdle();
          if (collectedSegments.length > 0) _greetingTextCache[greetingMode] = [...collectedSegments];
          return _greetingTextCache[greetingMode] ?? [];
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
      await waitForSegmentIdle();
      if (collectedSegments.length > 0) _greetingTextCache[greetingMode] = [...collectedSegments];
      return _greetingTextCache[greetingMode] ?? [];
    })();
    _greetingInFlight = { mode: greetingMode, promise: flight };

    try {
      await flight;
      if (mountedRef.current) setStatus('ready');
    } catch (err) {
      // Aborted on purpose (logout / end-session reset) — stay silent.
      if ((err as { name?: string })?.name !== 'AbortError') {
        console.error('[greeting]', err);
        if (mountedRef.current) setStatus('ready');
      }
    } finally {
      // Only clear if a reset hasn't already replaced this flight.
      if (_greetingInFlight?.promise === flight) {
        _greetingInFlight = null;
        _greetingAbort = null;
      }
    }
  }, [enqueueSegment, nextSessionMode, processSegmentQueue, waitForSegmentIdle]);

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
    activeSessionModeRef.current = null;
    setActiveSessionMode(null);
    const quota = await checkSessionQuota();
    const greetingMode = quota?.is_first_session === false ? nextSessionMode : 'guided_learning';
    const cachedGreeting = _greetingTextCache[greetingMode];
    if (cachedGreeting && cachedGreeting.length > 0) {
      setGreetingSentences(cachedGreeting);
      setStatus('ready');
    } else {
      setGreetingSentences([]);
      await runGreeting(greetingMode);
    }
  }, [runGreeting, checkSessionQuota, nextSessionMode]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    if (initializedRef.current) return;
    initializedRef.current = true;
    // Prime the user's speech rate before any TTS playback so the first greeting
    // already respects it. Runs in parallel with greeting/review init — even if
    // the profile lands after the first segment is decoded, scheduling reads the
    // module-level value at createBufferSource time, so subsequent segments still
    // pick up the correct rate.
    void userService.me()
      .then((u) => setUserSpeechRate(u.speechRate ?? 1.0))
      .catch(() => {});
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
    if (authLoading || !isAuthenticated) return;
    if (!initializedRef.current) return;
    if (initialSessionId || reviewMode || sessionIdRef.current) return;
    if (modeSelectionLocked) return;
    if (lastGreetingModeRef.current === null || lastGreetingModeRef.current === nextSessionMode) return;

    resetGreetingFlight();
    segmentQueueRef.current = [];
    nextPlayTimeRef.current = 0;
    lastScheduleRef.current = Promise.resolve();
    isPlayingRef.current = false;
    setIsSpeaking(false);
    const ctx = sharedPlaybackCtxRef.current;
    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch(() => {});
    }
    _sharedAudioCtx = null;
    sharedPlaybackCtxRef.current = getSharedAudioCtx();
    setGreetingSentences([]);
    void runGreeting();
  }, [authLoading, initialSessionId, isAuthenticated, modeSelectionLocked, nextSessionMode, reviewMode, runGreeting]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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
    if ((activeSessionModeRef.current as SessionMode | null) === 'free_talk') {
      setCurrentDeck(null);
      return;
    }
    try {
      const deck = await sessionService.getDeck(sid);
      if (sessionIdRef.current !== sid) return;
      if ((activeSessionModeRef.current as SessionMode | null) === 'free_talk') {
        setCurrentDeck(null);
        return;
      }
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
    if (activeSessionMode === 'free_talk') {
      setCurrentDeck(null);
      return;
    }
    void pollDeck();
    const interval = window.setInterval(pollDeck, 3000);
    return () => {
      window.clearInterval(interval);
      setCurrentDeck(null);
    };
  }, [activeSessionMode, currentSessionId, pollDeck]);

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
    const requestedMode = nextSessionMode;
    let effectiveSessionMode = activeSessionMode;
    // Capture FIRST-TURN-OF-SESSION before the session-start block runs.
    // We pass the greeting text to the backend only on the turn that actually
    // creates the session — so the AI's previous turn (the greeting it just
    // said out loud) is preserved as turn 0 in short-term memory.
    const isFirstTurnOfSession = !sessionId;
    if (!sessionId) {
      if (!trimmedTranscript) return;

      console.log(
        `[mode-debug] START → requestedMode=${requestedMode} nextSessionMode=${nextSessionMode} ` +
        `locked=${modeSelectionLocked} saved=${typeof window !== 'undefined' ? window.localStorage.getItem('speakup_next_session_mode') : 'n/a'}`,
      );

      try {
        if (!sessionStartPromiseRef.current) {
          // Snapshot the picked mode now — onboarding-first will still force
          // guided_learning server-side; we honor whatever BE echoes back.
          sessionStartPromiseRef.current = sessionService
            .start(requestedMode)
            .then(({ session_id, is_first_session, mode }) => {
              console.log(`[mode-debug] START RESPONSE → BE mode=${mode} is_first_session=${is_first_session} (requested=${requestedMode})`);
              const resolvedMode = mode ?? requestedMode;
              sessionIdRef.current = session_id;
              setCurrentSessionId(session_id);
              isFirstSessionRef.current = Boolean(is_first_session);
              effectiveSessionMode = resolvedMode;
              activeSessionModeRef.current = resolvedMode;
              setActiveSessionMode(resolvedMode);
            })
            .finally(() => { sessionStartPromiseRef.current = null; });
        }
        await sessionStartPromiseRef.current;
        sessionId = sessionIdRef.current;
        if (!sessionId) return;
        setIsOnboardingSession(isFirstSessionRef.current);
        // Free Talk sessions never get a deck — skip the poll to avoid useless requests.
        if (effectiveSessionMode !== 'free_talk') {
          window.setTimeout(() => { void pollDeck(); }, 600);
          window.setTimeout(() => { void pollDeck(); }, 1800);
        }
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
    const cachedGreetingForMode = _greetingTextCache[requestedMode];
    const greetingTextForBE = isFirstTurnOfSession && cachedGreetingForMode && cachedGreetingForMode.length > 0
      ? cachedGreetingForMode.join(' ').trim()
      : undefined;
    if (isFirstTurnOfSession) {
      // Consume the cache — the greeting has now been bound to this session.
      // Future "New Chat" within the same auth lifetime will re-stream a fresh
      // greeting via runGreeting().
      delete _greetingTextCache[requestedMode];
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
          if (effectiveSessionMode !== 'free_talk') void pollDeck();
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
  }, [activeSessionMode, enqueueSegment, nextSessionMode, modeSelectionLocked, processSegmentQueue, setBillingLimitError, waitForSegmentIdle, pollDeck]);

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
    // Clear the just-ended session's mode now that the recap is dismissed —
    // initSession will reset state but this is the canonical place to drop
    // any cross-flow leftovers.
    activeSessionModeRef.current = null;
    setActiveSessionMode(null);
    setMessages([]);
    setStatus('ready');
    isEndingRef.current = false;
    // Clear the greeting cache so the next initSession fetches a FRESH greeting
    // (session 2+ slim variant) instead of replaying the ended session's
    // onboarding-style greeting from cache. Abort any in-flight greeting FIRST
    // so initSession starts a new request rather than subscribing to the
    // just-ended session's stream.
    resetGreetingFlight();
    _greetingTextCache = {};
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
    // NOTE: activeSessionMode is intentionally NOT reset here — the closing
    // overlay and end-choices UI still need to know it (e.g. to show a Free
    // Talk recap vs a Guided breakdown). It is cleared in exitSession() once
    // the user dismisses the recap.
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
    // The backend writes a useful basic report first, then may overwrite it
    // with quality="rich"; keep polling briefly so users see the richer coach
    // feedback instead of stopping at the fallback.
    const deadline = Date.now() + 60000;
    const fallbackVisibleAt = Date.now() + 12000;
    let report: SessionEvaluation | null = null;
    let showedFallback = false;
    while (Date.now() < deadline) {
      const nextReport = await sessionService.getEvaluation(sid).catch(() => null);
      if (nextReport) {
        report = nextReport;
        if (nextReport.quality !== 'basic') {
          setEvaluation(nextReport);
          setEvaluationLoading(false);
          return;
        }
        if (!showedFallback && Date.now() >= fallbackVisibleAt) {
          setEvaluation(nextReport);
          setEvaluationLoading(false);
          showedFallback = true;
        }
      }
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
      const deck = await sessionService.rejectDeckChallenge(sessionId);
      if (!deck || deck.status !== 'ended_early') {
        throw new Error(`Deck was not ended for free chat (status=${deck?.status ?? 'none'})`);
      }
      setCurrentDeck(null);
      void processTurn('');
    } catch (err) {
      console.error('[rejectDeckChallenge]', err);
      setBillingLimitCode(null);
      setErrorMessage(err instanceof Error ? err.message : 'Could not end the exercise deck');
      setStatus('error');
    }
  }, [processTurn]);

  const chooseDeckFreeTalk = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    try {
      const deck = await sessionService.rejectDeckWithMode(sessionId, 'user_chose_free_talk');
      if (!deck || deck.status !== 'ended_early' || deck.end_reason !== 'user_chose_free_talk') {
        throw new Error(
          `Deck did not switch to free talk (status=${deck?.status ?? 'none'}, reason=${deck?.end_reason ?? 'none'})`,
        );
      }
      activeSessionModeRef.current = 'free_talk';
      setActiveSessionMode('free_talk');
      setCurrentDeck(null);
      void processTurn('');
    } catch (err) {
      console.error('[chooseDeckFreeTalk]', err);
      setBillingLimitCode(null);
      setErrorMessage(err instanceof Error ? err.message : 'Could not switch to free talk');
      setStatus('error');
    }
  }, [processTurn]);

  const chooseDeckEnd = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    try {
      const deck = await sessionService.rejectDeckWithMode(sessionId, 'user_wants_to_end');
      if (!deck || deck.status !== 'ended_early' || deck.end_reason !== 'user_wants_to_end') {
        throw new Error(
          `Deck did not switch to soft end (status=${deck?.status ?? 'none'}, reason=${deck?.end_reason ?? 'none'})`,
        );
      }
      setCurrentDeck(null);
      void processTurn('');
    } catch (err) {
      console.error('[chooseDeckEnd]', err);
      setBillingLimitCode(null);
      setErrorMessage(err instanceof Error ? err.message : 'Could not end the exercise deck');
      setStatus('error');
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
    const cachedGreeting = _greetingTextCache[nextSessionMode];
    if (cachedGreeting && cachedGreeting.length > 0) {
      setGreetingSentences(cachedGreeting);
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
    isSpeaking,
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
    nextSessionMode,
    modeSelectionLocked,
    setNextSessionMode,
    activeSessionMode,
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
