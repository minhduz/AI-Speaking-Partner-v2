'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { sessionService } from '@/services/session.service';
import { useAuthContext } from '@/contexts/auth-context';
import type { ChatMessage } from '@/types/session.types';

export type ChatStatus = 'idle' | 'greeting' | 'ready' | 'recording' | 'processing' | 'error';

export interface UseChatReturn {
  messages: ChatMessage[];
  status: ChatStatus;
  greetingSentences: string[];
  isRecording: boolean;
  analyser: AnalyserNode | null;
  errorMessage: string | null;
  currentSessionId: string | null;
  toggleMic: () => void;
  startNewSession: () => void;
}

async function playAudioWithSentence(
  ctx: AudioContext,
  b64: string,
  text: string | undefined,
  onText: ((t: string) => void) | undefined,
): Promise<void> {
  console.log(`[Audio] playAudioWithSentence — ctx state: ${ctx.state}, b64 len: ${b64?.length ?? 0}, text: "${text?.slice(0, 40) ?? 'none'}"`);
  if (ctx.state === 'suspended') {
    console.warn('[Audio] shared ctx still suspended — skipping audio, showing text');
    if (text && onText) onText(text);
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
  return new Promise((resolve) => {
    source.onended = () => {
      console.log('[Audio] source.onended — playback finished');
      resolve();
    };
  });
}

export function useChat(): UseChatReturn {
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [greetingSentences, setGreetingSentences] = useState<string[]>([]);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const initializedRef = useRef(false);

  const audioQueueRef = useRef<{ b64: string; text?: string; isGreeting?: boolean }[]>([]);
  const isPlayingRef = useRef(false);
  const sharedPlaybackCtxRef = useRef<AudioContext | null>(null);

  const processAudioQueue = useCallback(async () => {
    const ctx = sharedPlaybackCtxRef.current;
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
    while (audioQueueRef.current.length > 0) {
      const item = audioQueueRef.current.shift()!;
      console.log(`[Audio] dequeued item — queue remaining: ${audioQueueRef.current.length}`);
      const onText = item.text
        ? item.isGreeting
          ? (t: string) => setGreetingSentences((prev) => [...prev, t])
          : (t: string) => setMessages((prev) => {
              const msgs = [...prev];
              const idx = msgs.findLastIndex((m) => m.role === 'ai');
              if (idx >= 0) {
                const existing = msgs[idx];
                const sentences = [...(existing.sentences ?? []), t];
                msgs[idx] = { ...existing, pending: false, text: sentences.join(' '), sentences };
              }
              return msgs;
            })
        : undefined;
      try {
        await playAudioWithSentence(ctx, item.b64, item.text, onText);
      } catch (err) {
        console.error('[Audio] playback error:', err);
        if (item.text && onText) onText(item.text);
      }
    }
    console.log('[Audio] queue empty — isPlaying reset to false');
    isPlayingRef.current = false;
  }, [setMessages, setGreetingSentences]);

  // Greeting does not require a session — it's a pre-session welcome stream
  const runGreeting = useCallback(async () => {
    setStatus('greeting');
    setGreetingSentences([]);
    try {
      const stream = await sessionService.streamGreetingAnon();
      for await (const event of stream) {
        if (event.type === 'audio') {
          console.log(`[Audio][greeting] audio event received — b64 len: ${event.audio_b64?.length ?? 0}`);
          audioQueueRef.current.push({ b64: event.audio_b64, text: event.text, isGreeting: true });
          processAudioQueue();
        } else if (event.type === 'done') {
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
    setGreetingSentences([]);
    setErrorMessage(null);
    sessionIdRef.current = null;
    setCurrentSessionId(null);
    await runGreeting();
  }, [runGreeting]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    if (initializedRef.current) return;
    initializedRef.current = true;
    initSession();
  }, [authLoading, isAuthenticated, initSession]);

  // Create one shared AudioContext on mount; resume it on every user gesture so it's
  // running by the time any audio plays (Chrome blocks autoplay without a user gesture).
  useEffect(() => {
    const ctx = new AudioContext();
    sharedPlaybackCtxRef.current = ctx;
    console.log(`[Audio] shared AudioContext created — state: ${ctx.state}`);

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
      ctx.close();
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
      audioCtxRef.current?.close();
      setAnalyser(null);
    });
  }, []);

  const processTurn = useCallback(async (audioBlob: Blob) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    setStatus('processing');
    setErrorMessage(null);

    setMessages((prev) => [...prev, { role: 'user', text: '', pending: true }]);

    try {
      const stream = await sessionService.streamTurn(sessionId, audioBlob);

      for await (const event of stream) {
        if (event.type === 'transcript') {
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
        } else if (event.type === 'audio') {
          console.log(`[Audio][turn] audio event received — b64 len: ${event.audio_b64?.length ?? 0}`);
          audioQueueRef.current.push({ b64: event.audio_b64, text: event.text, isGreeting: false });
          processAudioQueue();
        } else if (event.type === 'done') {
          setStatus('ready');
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

  const toggleMic = useCallback(() => {
    if (status === 'recording') {
      stopRecording()
        .then((blob) => {
          if (!hasSpokenRef.current) {
            setErrorMessage("You didn't say anything. Please try again.");
            setStatus('ready');
            return;
          }
          return processTurn(blob);
        })
        .catch(console.error);
    } else if (status === 'ready') {
      // Create session on first mic click, then start recording
      const ensureSession = sessionIdRef.current
        ? Promise.resolve()
        : sessionService.start().then(({ session_id }) => {
            sessionIdRef.current = session_id;
            setCurrentSessionId(session_id);
          });

      ensureSession
        .then(() => startRecording())
        .catch((err) => {
          console.error('[createSession]', err);
          setErrorMessage('Failed to start session');
        });
    }
  }, [status, startRecording, stopRecording, processTurn]);

  const startNewSession = useCallback(() => {
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
    toggleMic,
    startNewSession,
  };
}
