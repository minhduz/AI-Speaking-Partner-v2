'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { sessionService } from '@/services/session.service';
import { useAuthContext } from '@/contexts/auth-context';
import type { ChatMessage, TurnHistoryItem } from '@/types/session.types';

function splitSentences(text: string): string[] {
  if (!text?.trim()) return text ? [text] : [];
  const parts = text.split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

// Greeting cache — survives client-side navigation (cleared on logout/full reload).
// Stores sentences as rendered so restore matches the live-stream layout.
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
  currentSessionId: string | null;
  sessionTitle: string | null;
  sessionTitleUpdate: { sessionId: string; title: string } | null;
  reviewMode: boolean;
  reviewSessionId: string | null;
  reviewHasMore: boolean;
  reviewLoading: boolean;
  startMic: () => void;
  stopMic: () => void;
  startNewSession: () => void;
  enterReview: (sessionId: string) => Promise<void>;
  exitReview: () => void;
  loadMoreReview: () => Promise<void>;
}

// Reveal `text` word-by-word over `durationMs`. Returns a promise that resolves
// when the last word is shown so callers can sequence the next segment cleanly.
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
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [sessionTitleUpdate, setSessionTitleUpdate] = useState<{ sessionId: string; title: string } | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null);
  const [reviewHasMore, setReviewHasMore] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);

  const statusRef = useRef<ChatStatus>('idle');
  const sessionIdRef = useRef<string | null>(null);
  const reviewSessionIdRef = useRef<string | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const reviewPageRef = useRef(1);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const initializedRef = useRef(false);

  const segmentQueueRef = useRef<SegmentQueueItem[]>([]);
  const segmentIdleResolversRef = useRef<(() => void)[]>([]);
  const isPlayingRef = useRef(false);
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

  const enterReview = useCallback(async (sessionId: string) => {
    setReviewMode(true);
    setReviewSessionId(sessionId);
    reviewSessionIdRef.current = sessionId;
    reviewPageRef.current = 1;
    setMessages([]);
    setReviewHasMore(false);
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
    setSessionTitle(null);
    sessionIdRef.current = null;
    setCurrentSessionId(null);
    if (_greetingTextCache && _greetingTextCache.length > 0) {
      setGreetingSentences(_greetingTextCache);
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
    if (initialSessionId) {
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
      sessionService.endBeacon(sid);
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
        setMessages((prev) => {
          const msgs = [...prev];
          const idx = msgs.findLastIndex((m) => m.role === 'user' && m.pending);
          if (idx >= 0) msgs[idx] = { ...msgs[idx], text: data.text };
          return msgs;
        });
      } else if (data.type === 'done' || data.type === 'error') {
        sttWsRef.current = null;
        ws.close();
        sttDoneResolverRef.current?.(data.transcript ?? '');
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
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    setStatus('processing');
    setErrorMessage(null);
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

    try {
      const stream = await sessionService.streamTurnText(sessionId, transcript);
      for await (const event of stream) {
        if (event.type === 'segment') {
          enqueueSegment(event.audio_b64, event.text, false);
          void processSegmentQueue();
        } else if (event.type === 'title') {
          setSessionTitleUpdate({ sessionId, title: event.text });
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
          setStatus('ready');
          return;
        } else if (event.type === 'error') {
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
      setErrorMessage(err instanceof Error ? err.message : 'Turn failed');
      setStatus('error');
    }
  }, [enqueueSegment, processSegmentQueue, waitForSegmentIdle]);

  const exitReview = useCallback(() => {
    setReviewMode(false);
    setReviewSessionId(null);
    reviewSessionIdRef.current = null;
    reviewPageRef.current = 1;
    setMessages([]);
    setReviewHasMore(false);
  }, []);

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
        return processTurn(transcript);
      })
      .catch((err) => {
        isStoppingRef.current = false;
        console.error(err);
      });
  }, [stopRecording, processTurn]);

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
      : sessionService.start().then(({ session_id }) => {
          sessionIdRef.current = session_id;
          setCurrentSessionId(session_id);
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

    const prevSessionId = sessionIdRef.current;
    if (prevSessionId) {
      sessionService.end(prevSessionId).catch(console.error);
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
    currentSessionId,
    sessionTitle,
    sessionTitleUpdate,
    reviewMode,
    reviewSessionId,
    reviewHasMore,
    reviewLoading,
    startMic,
    stopMic,
    startNewSession,
    enterReview,
    exitReview,
    loadMoreReview,
  };
}
