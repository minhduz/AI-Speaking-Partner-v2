'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { sessionService } from '@/services/session.service';
import { useAuthContext } from '@/contexts/auth-context';
import type { ChatMessage } from '@/types/session.types';

export type ChatStatus = 'idle' | 'greeting' | 'ready' | 'recording' | 'processing' | 'error';

export interface UseChatReturn {
  messages: ChatMessage[];
  status: ChatStatus;
  streamingText: string;
  isRecording: boolean;
  analyser: AnalyserNode | null;
  errorMessage: string | null;
  toggleMic: () => void;
  startNewSession: () => void;
}

async function playAudioB64(b64: string): Promise<void> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ctx = new AudioContext();
  const buffer = await ctx.decodeAudioData(bytes.buffer);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
  return new Promise((resolve) => {
    source.onended = () => { ctx.close(); resolve(); };
  });
}

export function useChat(): UseChatReturn {
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [streamingText, setStreamingText] = useState('');
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Prevent double-init from React StrictMode
  const initializedRef = useRef(false);

  const runGreeting = useCallback(async (sessionId: string) => {
    setStatus('greeting');
    setStreamingText('');
    try {
      const stream = await sessionService.streamGreeting(sessionId);
      let accText = '';
      for await (const event of stream) {
        if (event.type === 'text') {
          accText += event.chunk;
          setStreamingText(accText);
        } else if (event.type === 'audio') {
          playAudioB64(event.audio_b64).catch(console.error);
        } else if (event.type === 'done') {
          setMessages((prev) => [...prev, { role: 'ai', text: event.greeting }]);
          setStreamingText('');
          setStatus('ready');
          return;
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
      // Stream closed without a 'done' event — use whatever text accumulated
      if (accText) {
        setMessages((prev) => [...prev, { role: 'ai', text: accText }]);
      }
    } catch (err) {
      // Non-fatal: log but let user still talk
      console.error('[greeting]', err);
    } finally {
      setStreamingText('');
      setStatus('ready');
    }
  }, []);

  const initSession = useCallback(async () => {
    setStatus('idle');
    setMessages([]);
    setStreamingText('');
    setErrorMessage(null);
    sessionIdRef.current = null;
    try {
      const { session_id } = await sessionService.start();
      sessionIdRef.current = session_id;
      await runGreeting(session_id);
    } catch (err) {
      console.error('[initSession]', err);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to start session');
      setStatus('error');
    }
  }, [runGreeting]);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    if (initializedRef.current) return;
    initializedRef.current = true;
    initSession();
  }, [authLoading, isAuthenticated, initSession]);

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
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
    recorder.start();
    setStatus('recording');
  }, []);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
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

    // Show a pending user bubble immediately so the user sees something happened
    setMessages((prev) => [...prev, { role: 'user', text: '', pending: true }]);

    try {
      const result = await sessionService.sendTurn(sessionId, audioBlob);

      // Replace the pending bubble with the real transcript, then append AI response
      setMessages((prev) => {
        const withoutPending = prev.filter((m) => !m.pending);
        return [
          ...withoutPending,
          {
            role: 'user',
            text: result.transcript,
            pronunciationScore: result.pronunciation?.score ?? undefined,
          },
          { role: 'ai', text: result.response_text },
        ];
      });

      if (result.audio_b64) {
        playAudioB64(result.audio_b64).catch(console.error);
      }

      setStatus('ready');
    } catch (err) {
      setMessages((prev) => prev.filter((m) => !m.pending));
      setErrorMessage(err instanceof Error ? err.message : 'Turn failed');
      setStatus('error');
    }
  }, []);

  const toggleMic = useCallback(() => {
    if (status === 'recording') {
      stopRecording().then(processTurn).catch(console.error);
    } else if (status === 'ready') {
      startRecording().catch(console.error);
    }
  }, [status, startRecording, stopRecording, processTurn]);

  const startNewSession = useCallback(() => {
    initializedRef.current = false;
    initSession().then(() => { initializedRef.current = true; });
  }, [initSession]);

  return {
    messages,
    status,
    streamingText,
    isRecording: status === 'recording',
    analyser,
    errorMessage,
    toggleMic,
    startNewSession,
  };
}
