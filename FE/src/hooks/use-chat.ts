'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { sessionService } from '@/services/session.service';
import { useAuthContext } from '@/contexts/auth-context';
import type { ChatMessage, TurnHistoryItem } from '@/types/session.types';

// Greeting text cache — survives client-side navigation but resets on full page reload.
// Prevents re-streaming the greeting when the user navigates away and returns.
let _greetingTextCache: string | null = null;

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
  startMic: () => void;
  stopMic: () => void;
  startNewSession: () => void;
  enterReview: (sessionId: string) => Promise<void>;
  exitReview: () => void;
  loadMoreReview: () => Promise<void>;
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
): Promise<void> {
  console.log(`[Audio] playAudioWithSentence — ctx state: ${ctx.state}, b64 len: ${b64?.length ?? 0}, text: "${text?.slice(0, 40) ?? 'none'}"`);
  if (ctx.state === 'suspended') {
    console.warn('[Audio] shared ctx still suspended — skipping audio, showing text');
    if (text && onText) onText(text);
    else if (text && onWordReveal) revealWordsOverTime(text, text.split(/\s+/).length * 150, onWordReveal);
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
  source.connect(ctx.destination);
  source.start(0);
  console.log('[Audio] source.start(0) called — playing');
  if (text && onWordReveal) {
    revealWordsOverTime(text, audioBuffer.duration * 1000, onWordReveal);
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

  const sessionIdRef = useRef<string | null>(null);
  const reviewSessionIdRef = useRef<string | null>(null);
  const reviewPageRef = useRef(1);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const initializedRef = useRef(false);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const audioQueueRef = useRef<{ b64: string; text?: string; isGreeting?: boolean }[]>([]);
  const isPlayingRef = useRef(false);
  const isStoppingRef = useRef(false);
  // Set when stopMic is called before startRecording has finished setting up the
  // MediaRecorder — drains in startMic's .then() so the stop isn't lost.
  const pendingStopRef = useRef(false);
  // Point to the module-level singleton — always exists on the client before any effect.
  const sharedPlaybackCtxRef = useRef<AudioContext | null>(getSharedAudioCtx());

  const turnsToMessages = useCallback((items: TurnHistoryItem[]): ChatMessage[] => {
    const msgs: ChatMessage[] = [];
    for (const t of items) {
      msgs.push({ role: 'user', text: t.transcript, pronunciationScore: t.pronunciationScore ?? undefined });
      msgs.push({ role: 'ai', text: t.responseText, sentences: [t.responseText] });
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
            onText = (t: string) =>
              setMessages((prev) => {
                const msgs = [...prev];
                const idx = msgs.findLastIndex((m) => m.role === 'ai');
                if (idx >= 0) {
                  const existing = msgs[idx];
                  const sentences = [...(existing.sentences ?? []), t];
                  msgs[idx] = { ...existing, pending: false, text: sentences.join(' '), sentences };
                }
                return msgs;
              });
          }
        }

        try {
          await playAudioWithSentence(ctx, item.b64, item.text, onText, onWordReveal);
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
    }
  }, [setMessages, setGreetingSentences]);

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
          // If TTS failed and no audio events carried text, fall back to the full LLM text
          if (!hadAudioText && fullText.trim()) {
            setGreetingSentences([fullText.trim()]);
          }
          if (fullText.trim()) _greetingTextCache = fullText.trim();
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
  }, [processAudioQueue]);

  const initSession = useCallback(async () => {
    setStatus('idle');
    setMessages([]);
    setErrorMessage(null);
    setSessionTitle(null);
    sessionIdRef.current = null;
    setCurrentSessionId(null);
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
    if (initialSessionId) {
      enterReview(initialSessionId);
    } else {
      initSession();
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
      // Clear inactivity timer on unmount to avoid stale closures
      if (inactivityTimerRef.current !== null) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      if (ctx.state !== 'closed') {
        ctx.close();
      }
      _sharedAudioCtx = null;
      sharedPlaybackCtxRef.current = null;
    };
  }, []);

  const hasSpokenRef = useRef(false);
  const checkVolumeIntervalRef = useRef<number | null>(null);

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const audioCtx = new AudioContext();
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

      // RMS > 0.03 is considered speech.
      // We require at least 3 frames (~300ms) to filter out mouse clicks and brief static.
      if (rms > 0.03) {
        spokenFrames++;
        if (spokenFrames >= 3) {
          hasSpokenRef.current = true;
        }
      }
    }, 100);

    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
    recorder.start();
    setStatus('recording');
  }, []);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      if (checkVolumeIntervalRef.current !== null) {
        window.clearInterval(checkVolumeIntervalRef.current);
        checkVolumeIntervalRef.current = null;
      }
      const recorder = recorderRef.current!;
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: 'audio/webm' }));
      recorder.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const recCtx = audioCtxRef.current;
      if (recCtx && recCtx.state !== 'closed') recCtx.close();
      setAnalyser(null);
    });
  }, []);

  const processTurn = useCallback(async (audioBlob: Blob) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    // Cancel any running inactivity timer — user is active again
    if (inactivityTimerRef.current !== null) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    setStatus('processing');
    setErrorMessage(null);

    setMessages((prev) => [...prev, { role: 'user', text: '', pending: true }]);

    try {
      const stream = await sessionService.streamTurn(sessionId, audioBlob);
      let aiFullText = '';
      let hadAudioText = false;

      for await (const event of stream) {
        if (event.type === 'transcript') {
          // Conversation has started — remove the greeting
          setGreetingSentences([]);
          setMessages((prev) => {
            const withoutPending = prev.filter((m) => !m.pending);
            return [
              ...withoutPending,
              { role: 'user', text: event.text },
              { role: 'ai', text: '', pending: true },
            ];
          });
        } else if (event.type === 'pronunciation') {
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastUserIndex = newMessages.findLastIndex((m) => m.role === 'user');
            if (lastUserIndex >= 0) {
              const userMsg = newMessages[lastUserIndex];
              if (userMsg.text && userMsg.text.trim().length > 0) {
                newMessages[lastUserIndex] = {
                  ...userMsg,
                  pronunciationScore: event.data.score ?? undefined
                };
              }
            }
            return newMessages;
          });
        } else if (event.type === 'text') {
          aiFullText += event.chunk;
        } else if (event.type === 'audio') {
          console.log(`[Audio][turn] audio event received — b64 len: ${event.audio_b64?.length ?? 0}`);
          if (event.text) hadAudioText = true;
          audioQueueRef.current.push({ b64: event.audio_b64, text: event.text, isGreeting: false });
          processAudioQueue();
        } else if (event.type === 'title') {
          setSessionTitleUpdate({ sessionId, title: event.text });
        } else if (event.type === 'done') {
          // If TTS failed and audio events never carried text, fall back to the full LLM text
          if (!hadAudioText && aiFullText.trim()) {
            setMessages((prev) => {
              const msgs = [...prev];
              const idx = msgs.findLastIndex((m) => m.role === 'ai' && m.pending);
              if (idx >= 0) msgs[idx] = { ...msgs[idx], pending: false, text: aiFullText.trim() };
              return msgs;
            });
          }
          setStatus('ready');

          // Start 15-second inactivity timer — triggers consolidation if user goes quiet
          inactivityTimerRef.current = setTimeout(() => {
            const sid = sessionIdRef.current;
            if (!sid) return;
            console.log('[Session] 15s inactivity — ending session to trigger consolidation');
            sessionService.end(sid).catch(console.error);
            sessionIdRef.current = null;
            setCurrentSessionId(null);
            inactivityTimerRef.current = null;
          }, 15_000);

          return;
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
      setStatus('ready');
    } catch (err) {
      setMessages((prev) => prev.filter((m) => !m.pending));
      setErrorMessage(err instanceof Error ? err.message : 'Turn failed');
      setStatus('error');
    }
  }, [processAudioQueue]);

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
      .then((blob) => {
        isStoppingRef.current = false;
        if (!hasSpokenRef.current) {
          setErrorMessage("You didn't say anything. Please try again.");
          setStatus('ready');
          return;
        }
        return processTurn(blob);
      })
      .catch((err) => {
        isStoppingRef.current = false;
        console.error(err);
      });
  }, [stopRecording, processTurn]);

  const startMic = useCallback(() => {
    if (status !== 'ready') return;
    isStoppingRef.current = false;
    pendingStopRef.current = false;
    // Optimistic — closes the race where user releases before startRecording's
    // setStatus fires, leaving the mic stuck.
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
        // User released before the recorder was actually set up — drain the queued stop.
        if (pendingStopRef.current) {
          pendingStopRef.current = false;
          runStop();
        }
      })
      .catch((err) => {
        console.error('[startMic]', err);
        pendingStopRef.current = false;
        setStatus('ready');
        setErrorMessage('Failed to start recording');
      });
  }, [status, startRecording, runStop]);

  const stopMic = useCallback(() => {
    if (status !== 'recording') return;
    if (isStoppingRef.current) return;
    // Recorder not ready yet — queue the stop and let startMic's .then() drain it.
    if (!recorderRef.current || recorderRef.current.state !== 'recording') {
      pendingStopRef.current = true;
      return;
    }
    runStop();
  }, [status, runStop]);


  const startNewSession = useCallback(() => {
    // Cancel any pending inactivity consolidation — we're starting fresh
    if (inactivityTimerRef.current !== null) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    // Exit review mode if active
    setReviewMode(false);
    setReviewSessionId(null);
    reviewSessionIdRef.current = null;
    reviewPageRef.current = 1;
    setReviewHasMore(false);

    // End the previous session (fire-and-forget) so consolidation triggers
    const prevSessionId = sessionIdRef.current;
    if (prevSessionId) {
      sessionService.end(prevSessionId).catch(console.error);
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
    startMic,
    stopMic,
    startNewSession,
    enterReview,
    exitReview,
    loadMoreReview,
  };
}
