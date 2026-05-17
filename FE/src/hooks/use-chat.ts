'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { sessionService, type OnboardingState, type EndReason } from '@/services/session.service';
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
let _greetingTextCache: string | null = null;

const TURN_PLAYBACK_RATE = 1.15;
const TURN_REVEAL_MS_PER_WORD = 300;

// Module-level singleton so the AudioContext is created exactly once and is
// available synchronously (before any React effect runs) on the client side.
// Returns null during SSR where `window` does not exist.
let _sharedAudioCtx: AudioContext | null = null;
function getSharedAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!_sharedAudioCtx) {
    _sharedAudioCtx = new AudioContext();
    console.log(`[Audio] shared AudioContext created (singleton) — state: ${_sharedAudioCtx.state}`);
  }
  return _sharedAudioCtx;
}

// Call on logout to immediately stop any playing audio
export function stopAllAudio(): void {
  if (_sharedAudioCtx && _sharedAudioCtx.state !== 'closed') {
    _sharedAudioCtx.close();
  }
  _sharedAudioCtx = null;
}


export type ChatStatus = 'idle' | 'greeting' | 'ready' | 'recording' | 'processing' | 'error';

export interface UseChatReturn {
  messages: ChatMessage[];
  status: ChatStatus;
  greetingSentences: string[];
  isRecording: boolean;
  analyser: AnalyserNode | null;
  errorMessage: string | null;
  currentSessionId: string | null;
  sessionTitle: string | null;
  sessionTitleUpdate: { sessionId: string; title: string } | null;
  reviewMode: boolean;
  reviewSessionId: string | null;
  reviewHasMore: boolean;
  reviewLoading: boolean;
  isOnboardingSession: boolean;
  onboardingState: OnboardingState | null;
  /** True while the AI closing message is playing (CLOSING_MODE). */
  isEnding: boolean;
  /** The AI closing farewell text, shown on screen while audio plays. */
  closingText: string | null;
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
    "i'm good",
    'i am good',
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
  ].some((phrase) => normalized.includes(phrase));
}


function revealWordsOverTime(
  text: string,
  durationMs: number,
  onWordReveal: (partial: string) => void,
): void {
  const words = text.split(/\s+/).filter(Boolean);
  const intervalMs = durationMs / words.length;
  let built = '';
  words.forEach((word, i) => {
    setTimeout(() => {
      built += (built ? ' ' : '') + word;
      onWordReveal(built);
    }, i * intervalMs);
  });
}

async function playAudioWithSentence(
  ctx: AudioContext,
  b64: string,
  text: string | undefined,
  onText: ((t: string) => void) | undefined,
  onWordReveal?: (partial: string) => void,
  playbackRate = 1,
): Promise<void> {
  console.log(`[Audio] playAudioWithSentence — ctx state: ${ctx.state}, b64 len: ${b64?.length ?? 0}, text: "${text?.slice(0, 40) ?? 'none'}"`);
  if (ctx.state === 'suspended') {
    console.warn('[Audio] shared ctx still suspended — skipping audio, showing text');
    if (text && onText) onText(text);
    else if (text && onWordReveal) revealWordsOverTime(text, text.split(/\s+/).length * TURN_REVEAL_MS_PER_WORD, onWordReveal);
    return;
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
  console.log(`[Audio] decoded — duration: ${audioBuffer.duration.toFixed(2)}s`);
  if (text && onText) onText(text);
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.playbackRate.value = playbackRate;
  source.connect(ctx.destination);
  source.start(0);
  console.log('[Audio] source.start(0) called — playing');
  if (text && onWordReveal) {
    revealWordsOverTime(text, (audioBuffer.duration * 1000) / playbackRate, onWordReveal);
  }
  return new Promise((resolve) => {
    source.onended = () => {
      console.log('[Audio] source.onended — playback finished');
      resolve();
    };
  });
}

export function useChat(initialSessionId?: string): UseChatReturn {
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [greetingSentences, setGreetingSentences] = useState<string[]>([]);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [sessionTitleUpdate, setSessionTitleUpdate] = useState<{ sessionId: string; title: string } | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [reviewHasMore, setReviewHasMore] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [isOnboardingSession, setIsOnboardingSession] = useState(false);
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
  const [isEnding, setIsEnding] = useState(false);
  const [closingText, setClosingText] = useState<string | null>(null);

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

  const audioQueueRef = useRef<{ b64: string; text?: string; isGreeting?: boolean }[]>([]);
  const audioQueueIdleResolversRef = useRef<(() => void)[]>([]);
  const isPlayingRef = useRef(false);
  const isStoppingRef = useRef(false);
  const sttWsRef = useRef<WebSocket | null>(null);
  const sttDoneResolverRef = useRef<((t: string) => void) | null>(null);
  // Set when stopMic is called before startRecording has finished setting up the
  // MediaRecorder — drains in startMic's .then() so the stop isn't lost.
  const pendingStopRef = useRef(false);
  // Point to the module-level singleton — always exists on the client before any effect.
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

  const enterReview = useCallback(async (sessionId: string) => {
    setReviewMode(true);
    setReviewSessionId(sessionId);
    reviewSessionIdRef.current = sessionId;
    reviewPageRef.current = 1;
    setMessages([]);
    setReviewHasMore(false);
    await loadReviewPage(sessionId, 1, false);
  }, [loadReviewPage]);

  const resolveAudioQueueIdle = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length > 0) return;
    const resolvers = audioQueueIdleResolversRef.current.splice(0);
    resolvers.forEach((resolve) => resolve());
  }, []);

  const waitForAudioQueueIdle = useCallback((): Promise<void> => {
    if (!isPlayingRef.current && audioQueueRef.current.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      audioQueueIdleResolversRef.current.push(resolve);
    });
  }, []);

  const processAudioQueue = useCallback(async () => {
    // During SSR, useRef(getSharedAudioCtx()) receives null because window doesn't exist.
    // React doesn't re-run the initializer on hydration, so the ref stays null.
    // Fix: always resolve the context directly from the singleton as a fallback.
    let ctx = sharedPlaybackCtxRef.current ?? getSharedAudioCtx();
    if (ctx && !sharedPlaybackCtxRef.current) {
      sharedPlaybackCtxRef.current = ctx; // repair the ref for subsequent calls
    }
    if (!ctx) {
      // Very early call (SSR stub) — wait up to 2s for the client to mount.
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        ctx = getSharedAudioCtx();
        if (ctx) { sharedPlaybackCtxRef.current = ctx; break; }
      }
    }
    console.log(`[Audio] processAudioQueue called — isPlaying: ${isPlayingRef.current}, queue length: ${audioQueueRef.current.length}, ctx state: ${ctx?.state ?? 'none'}`);
    if (isPlayingRef.current) {
      console.log('[Audio] already playing — skipping');
      return;
    }
    if (!ctx) {
      console.warn('[Audio] no shared AudioContext yet — skipping');
      while (audioQueueRef.current.length > 0) {
        const item = audioQueueRef.current.shift()!;
        if (!item.text) continue;
        if (item.isGreeting) {
          setGreetingSentences((prev) => [...prev, item.text!]);
        } else {
          setMessages((prev) => {
            const msgs = [...prev];
            const idx = msgs.findLastIndex((m) => m.role === 'ai');
            if (idx >= 0) {
              const existing = msgs[idx];
              const sentences = [...(existing.sentences ?? []), item.text!];
              msgs[idx] = { ...existing, pending: false, text: sentences.join(' '), sentences };
            }
            return msgs;
          });
        }
      }
      resolveAudioQueueIdle();
      return;
    }
    isPlayingRef.current = true;
    try {
      while (audioQueueRef.current.length > 0) {
        const item = audioQueueRef.current.shift()!;
        console.log(`[Audio] dequeued item — queue remaining: ${audioQueueRef.current.length}`);

        let onText: ((t: string) => void) | undefined;
        let onWordReveal: ((partial: string) => void) | undefined;

        if (item.text) {
          if (item.isGreeting) {
            setGreetingSentences((prev) => [...prev, '']);
            onWordReveal = (partial: string) =>
              setGreetingSentences((prev) => {
                if (prev.length === 0) return [partial];
                const next = [...prev];
                next[next.length - 1] = partial;
                return next;
              });
          } else {
            setMessages((prev) => {
              const msgs = [...prev];
              const idx = msgs.findLastIndex((m) => m.role === 'ai');
              if (idx >= 0) {
                const existing = msgs[idx];
                const sentences = [...(existing.sentences ?? []), ''];
                msgs[idx] = { ...existing, pending: false, text: sentences.filter(Boolean).join(' '), sentences };
              }
              return msgs;
            });
            onWordReveal = (partial: string) =>
              setMessages((prev) => {
                const msgs = [...prev];
                const idx = msgs.findLastIndex((m) => m.role === 'ai');
                if (idx >= 0) {
                  const existing = msgs[idx];
                  const sentences = [...(existing.sentences ?? [])];
                  if (sentences.length === 0) {
                    sentences.push(partial);
                  } else {
                    sentences[sentences.length - 1] = partial;
                  }
                  msgs[idx] = { ...existing, pending: false, text: sentences.filter(Boolean).join(' '), sentences };
                }
                return msgs;
              });
          }
        }

        try {
          await playAudioWithSentence(
            ctx,
            item.b64,
            item.text,
            onText,
            onWordReveal,
            item.isGreeting ? 1 : TURN_PLAYBACK_RATE,
          );
        } catch (err) {
          console.error('[Audio] playback error:', err);
          if (item.text) {
            if (onText) onText(item.text);
            else if (onWordReveal) revealWordsOverTime(item.text, item.text.split(/\s+/).length * 150, onWordReveal);
          }
        }
      }
    } finally {
      console.log('[Audio] queue drained — isPlaying reset to false');
      isPlayingRef.current = false;
      resolveAudioQueueIdle();
    }
  }, [resolveAudioQueueIdle, setMessages, setGreetingSentences]);

  // Greeting does not require a session — it's a pre-session welcome stream
  const runGreeting = useCallback(async () => {
    setStatus('greeting');
    setGreetingSentences([]);
    let fullText = '';
    let hadAudioText = false;
    try {
      const stream = await sessionService.streamGreetingAnon();
      for await (const event of stream) {
        if (event.type === 'text') {
          fullText += event.chunk;
        } else if (event.type === 'audio') {
          console.log(`[Audio][greeting] audio event received — b64 len: ${event.audio_b64?.length ?? 0}`);
          if (event.text) hadAudioText = true;
          audioQueueRef.current.push({ b64: event.audio_b64, text: event.text, isGreeting: true });
          processAudioQueue();
        } else if (event.type === 'done') {
          // Cache the full text immediately so navigation reuse works.
          if (fullText.trim()) _greetingTextCache = fullText.trim();
          // If TTS failed entirely, fall back to showing the raw LLM text.
          if (!hadAudioText && fullText.trim()) {
            setGreetingSentences([fullText.trim()]);
          }
          // Wait for the audio queue to fully drain before marking ready.
          // Without this, the last sentence is pushed to the queue but its
          // word-reveal timer hasn't finished, so the displayed text is cut off.
          await waitForAudioQueueIdle();
          setStatus('ready');
          return;
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
    } catch (err) {
      console.error('[greeting]', err);
    } finally {
      setStatus('ready');
    }
  }, [processAudioQueue, waitForAudioQueueIdle]);

  const initSession = useCallback(async () => {
    setStatus('idle');
    setMessages([]);
    setErrorMessage(null);
    setSessionTitle(null);
    sessionIdRef.current = null;
    setCurrentSessionId(null);
    setIsOnboardingSession(false);
    setOnboardingState(null);
    // Restore cached greeting instead of re-streaming (survives client-side nav)
    if (_greetingTextCache) {
      setGreetingSentences([_greetingTextCache]);
      setStatus('ready');
      return;
    }
    setGreetingSentences([]);
    await runGreeting();
  }, [runGreeting]);

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

  // Resume the shared AudioContext on every user gesture (Chrome blocks autoplay without one).
  // Also explicitly assign the ref here because the useRef initializer runs during SSR
  // (where window is undefined → null) and React doesn't re-run it on client hydration.
  useEffect(() => {
    const ctx = getSharedAudioCtx(); // always returns the real context on the client
    if (!ctx) return;
    sharedPlaybackCtxRef.current = ctx; // repair ref that was null after SSR hydration
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

  // End the session on tab close (beforeunload) and on Next.js client-side navigation
  // away from the chat page (component unmount). Uses keepalive:true so the request
  // survives page unload without needing sendBeacon.
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
      endOnLeave(); // fires when component unmounts (client-side nav away from chat)
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

    // Open STT WebSocket — browser streams audio chunks directly to Soniox in real-time
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

    // Wait for WS to open before starting recorder
    if (ws.readyState !== WebSocket.OPEN) {
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener('error', () => reject(new Error('STT WebSocket failed to connect')), { once: true });
      });
    }

    // Pending user bubble appears as soon as recording starts
    setMessages((prev) => [...prev, { role: 'user', text: '', pending: true }]);

    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    // Each 50ms chunk goes directly to Soniox via the WebSocket
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

      // Store resolver — ws.onmessage 'done' handler calls it when Soniox is finished
      sttDoneResolverRef.current = resolve;

      recorder.onstop = () => {
        // All ondataavailable chunks have been sent by this point — signal end of audio
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

  const processTurn = useCallback(async (transcript: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    setStatus('processing');
    setErrorMessage(null);
    nextPlayTimeRef.current = 0;

    // Replace the pending user bubble (filled by word events) with the final transcript
    setGreetingSentences([]);
    setMessages((prev) => {
      const withoutPending = prev.filter((m) => !m.pending);
      const userBubble = transcript.trim()
        ? [{ role: 'user' as const, text: transcript }]
        : [];
      return [...withoutPending, ...userBubble, { role: 'ai', text: '', pending: true }];
    });

    try {
      const stream = await sessionService.streamTurnText(sessionId, transcript);
      let aiFullText = '';
      let hadAudioChunks = false;
      let hadSentenceAudio = false;
      let wordsRevealed = 0;
      let revealInterval: number | null = null;

      const stopReveal = () => {
        if (revealInterval !== null) { window.clearInterval(revealInterval); revealInterval = null; }
      };

      for await (const event of stream) {
        if (sessionIdRef.current !== sessionId) {
          stopReveal();
          return;
        }
        if (event.type === 'text') {
          // Accumulate silently — interval reveals at speech rate once audio starts
          aiFullText += event.chunk;
        } else if (event.type === 'audio_chunk') {
          hadAudioChunks = true;
          const ctx = sharedPlaybackCtxRef.current ?? getSharedAudioCtx();
          if (ctx && ctx.state !== 'closed') {
            try {
              const binary = atob(event.audio_b64);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              const pcm = new Int16Array(bytes.buffer);
              const float32 = new Float32Array(pcm.length);
              for (let i = 0; i < pcm.length; i++) float32[i] = pcm[i] / 32768.0;
              const sampleRate = event.sample_rate || 24000;
              const buffer = ctx.createBuffer(1, float32.length, sampleRate);
              buffer.copyToChannel(float32, 0);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.playbackRate.value = TURN_PLAYBACK_RATE;
              source.connect(ctx.destination);
              const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
              source.start(startTime);
              nextPlayTimeRef.current = startTime + (buffer.duration / TURN_PLAYBACK_RATE);

              // Start word-reveal interval the moment first audio plays (~150 wpm)
              if (revealInterval === null) {
                revealInterval = window.setInterval(() => {
                  const words = aiFullText.trim().split(/\s+/).filter(Boolean);
                  if (wordsRevealed < words.length) {
                    wordsRevealed++;
                    const visible = words.slice(0, wordsRevealed).join(' ');
                    setMessages((prev) => {
                      const msgs = [...prev];
                      const idx = msgs.findLastIndex((m) => m.role === 'ai' && m.pending);
                      if (idx >= 0) msgs[idx] = { ...msgs[idx], text: visible };
                      return msgs;
                    });
                  }
                }, TURN_REVEAL_MS_PER_WORD);
              }
            } catch (err) {
              console.error('[Audio] PCM chunk playback error:', err);
            }
          }
        } else if (event.type === 'audio_end') {
          // Stop fixed-rate interval; spread any unrevealed words over remaining audio
          stopReveal();
          const ctx = sharedPlaybackCtxRef.current ?? getSharedAudioCtx();
          const remainingAudioMs = ctx && hadAudioChunks
            ? Math.max(0, (nextPlayTimeRef.current - ctx.currentTime) * 1000)
            : 0;
          const words = aiFullText.trim().split(/\s+/).filter(Boolean);
          const remaining = words.slice(wordsRevealed);
          if (remaining.length === 0) {
            // All words already revealed — nothing to do
          } else if (remainingAudioMs < 100) {
            // Audio almost done — show rest immediately
            setMessages((prev) => {
              const msgs = [...prev];
              const idx = msgs.findLastIndex((m) => m.role === 'ai' && m.pending);
              if (idx >= 0) msgs[idx] = { ...msgs[idx], text: aiFullText.trim() };
              return msgs;
            });
          } else {
            // Spread remaining words evenly over remaining audio time
            const stepMs = remainingAudioMs / remaining.length;
            let built = words.slice(0, wordsRevealed).join(' ');
            remaining.forEach((word, i) => {
              setTimeout(() => {
                built += (built ? ' ' : '') + word;
                setMessages((prev) => {
                  const msgs = [...prev];
                  const idx = msgs.findLastIndex((m) => m.role === 'ai' && m.pending);
                  if (idx >= 0) msgs[idx] = { ...msgs[idx], text: built };
                  return msgs;
                });
              }, i * stepMs);
            });
          }
        } else if (event.type === 'audio') {
          // Batch mp3 sentence audio: same contract as the greeting stream.
          console.log(`[Audio][turn] audio event — b64 len: ${event.audio_b64?.length ?? 0}`);
          if (event.text) hadSentenceAudio = true;
          audioQueueRef.current.push({ b64: event.audio_b64, text: event.text, isGreeting: false });
          processAudioQueue();
        } else if (event.type === 'title') {
          setSessionTitleUpdate({ sessionId, title: event.text });
        } else if (event.type === 'done') {
          stopReveal();
          if (hadSentenceAudio) {
            await waitForAudioQueueIdle();
            setMessages((prev) => {
              const msgs = [...prev];
              const idx = msgs.findLastIndex((m) => m.role === 'ai');
              if (idx >= 0) {
                const finalText = aiFullText.trim() || msgs[idx].text;
                msgs[idx] = { ...msgs[idx], pending: false, text: finalText, sentences: splitSentences(finalText) };
              }
              return msgs;
            });
            setStatus('ready');
            return;
          }
          // Delay finalization until audio finishes so the reveal timers
          // can complete before we switch pending → sentences rendering branch
          const ctx = sharedPlaybackCtxRef.current ?? getSharedAudioCtx();
          const remainingAudioMs = ctx && hadAudioChunks
            ? Math.max(0, (nextPlayTimeRef.current - ctx.currentTime) * 1000)
            : 0;
          setTimeout(() => {
            setMessages((prev) => {
              const msgs = [...prev];
              const idx = msgs.findLastIndex((m) => m.role === 'ai');
              if (idx >= 0) {
                const finalText = aiFullText.trim();
                msgs[idx] = { ...msgs[idx], pending: false, text: finalText, sentences: splitSentences(finalText) };
              }
              return msgs;
            });
            setStatus('ready');
          }, remainingAudioMs);
          return;
        } else if (event.type === 'error') {
          stopReveal();
          throw new Error(event.message);
        }
      }
      stopReveal();
      setStatus('ready');
    } catch (err) {
      setMessages((prev) => prev.filter((m) => !m.pending));
      setErrorMessage(err instanceof Error ? err.message : 'Turn failed');
      setStatus('error');
    }
  }, [processAudioQueue, waitForAudioQueueIdle]);

  const exitReview = useCallback(() => {
    setReviewMode(false);
    setReviewSessionId(null);
    reviewSessionIdRef.current = null;
    reviewPageRef.current = 1;
    setMessages([]);
    setReviewHasMore(false);
  }, []);

  const endSession = useCallback(async (reason: EndReason = 'user_clicked') => {
    // Guard: don't double-trigger
    if (isEndingRef.current) return;
    isEndingRef.current = true;

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
    audioQueueRef.current = [];
    sttDoneResolverRef.current?.('');
    sttDoneResolverRef.current = null;
    pendingStopRef.current = false;
    isStoppingRef.current = false;

    const prevSessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    setCurrentSessionId(null);
    setIsOnboardingSession(false);
    setOnboardingState(null);
    setErrorMessage(null);

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
              audioQueueRef.current.push({ b64: closing.audio_b64 });
              processAudioQueue();
              // Wait until playback truly finishes (isPlayingRef → false).
              // Queue-idle fires too early (as soon as item is dequeued, before onended).
              await new Promise<void>((resolve) => {
                const safety = setTimeout(resolve, 40000); // hard 40s cap
                const poll = setInterval(() => {
                  if (!isPlayingRef.current) {
                    clearInterval(poll);
                    clearTimeout(safety);
                    resolve();
                  }
                }, 200);
              });
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

    // Hard-end: mark session in DB + trigger consolidation
    if (prevSessionId) {
      await sessionService.end(prevSessionId, reason).catch(console.error);
    }

    setIsEnding(false);
    setClosingText(null);
    setMessages([]);
    setStatus('ready');
    isEndingRef.current = false;

    await initSession();
  }, [initSession, processAudioQueue, waitForAudioQueueIdle]);

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
          setStatus('ready');
          return;
        }
        if (isEndSessionIntent(transcript)) {
          setMessages((prev) => {
            const withoutPending = prev.filter((m) => !m.pending);
            return transcript.trim()
              ? [...withoutPending, { role: 'user' as const, text: transcript }]
              : withoutPending;
          });
          void endSession('voice_intent');
          return;
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

    const ensureSession = sessionIdRef.current
      ? Promise.resolve()
      : sessionService.start().then(({ session_id, is_first_session }) => {
          sessionIdRef.current = session_id;
          setCurrentSessionId(session_id);
          setIsOnboardingSession(Boolean(is_first_session));
        });
    ensureSession
      .then(() => startRecording())
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
        setErrorMessage('Failed to start recording');
      });
  }, [startRecording, runStop]);

  const stopMic = useCallback(() => {
    if (statusRef.current !== 'recording') return;
    if (isStoppingRef.current) return;
    // Recorder not ready yet — queue the stop and let startMic's .then() drain it.
    if (!recorderRef.current || recorderRef.current.state !== 'recording') {
      pendingStopRef.current = true;
      return;
    }
    runStop();
  }, [runStop]);


  const startNewSession = useCallback(() => {
    // Exit review mode if active
    setReviewMode(false);
    setReviewSessionId(null);
    reviewSessionIdRef.current = null;
    reviewPageRef.current = 1;
    setReviewHasMore(false);

    // Close any active STT WebSocket
    if (sttWsRef.current) {
      sttWsRef.current.close();
      sttWsRef.current = null;
    }
    sttDoneResolverRef.current = null;

    // End the previous session (fire-and-forget) so consolidation triggers
    const prevSessionId = sessionIdRef.current;
    if (prevSessionId) {
      sessionService.end(prevSessionId, 'user_clicked').catch(console.error);
      sessionIdRef.current = null;
      setCurrentSessionId(null);
    }

    // The button click is a user gesture — use it to resume the AudioContext so the
    // greeting audio plays immediately without waiting for a subsequent interaction.
    const ctx = sharedPlaybackCtxRef.current;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
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
    currentSessionId,
    sessionTitle,
    sessionTitleUpdate,
    reviewMode,
    reviewSessionId,
    reviewHasMore,
    reviewLoading,
    isOnboardingSession,
    onboardingState,
    isEnding,
    closingText,
    startMic,
    stopMic,
    endSession,
    startNewSession,
    enterReview,
    exitReview,
    loadMoreReview,
  };
}
