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

  const audioQueueRef = useRef<{ b64: string; text?: string; isGreeting?: boolean }[]>([]);
  const isPlayingRef = useRef(false);

  const processAudioQueue = useCallback(async () => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;
    while (audioQueueRef.current.length > 0) {
      const item = audioQueueRef.current.shift()!;
      
      if (item.text) {
        if (item.isGreeting) {
          setStreamingText((prev) => prev + item.text);
        } else {
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastAiMsgIndex = newMessages.findLastIndex((m) => m.role === 'ai');
            if (lastAiMsgIndex >= 0) {
              const currentText = newMessages[lastAiMsgIndex].text;
              newMessages[lastAiMsgIndex] = { 
                ...newMessages[lastAiMsgIndex], 
                text: currentText ? currentText + ' ' + item.text : item.text! 
              };
            }
            return newMessages;
          });
        }
      }

      try {
        await playAudioB64(item.b64);
      } catch (err) {
        console.error('Audio playback error', err);
      }
    }
    isPlayingRef.current = false;
  }, []);

  const runGreeting = useCallback(async (sessionId: string) => {
    setStatus('greeting');
    setStreamingText('');
    try {
      const stream = await sessionService.streamGreeting(sessionId);
      for await (const event of stream) {
        if (event.type === 'text') {
          // backend no longer sends raw text chunks, it sends text with audio
        } else if (event.type === 'audio') {
          audioQueueRef.current.push({ b64: event.audio_b64, text: event.text, isGreeting: true });
          processAudioQueue();
        } else if (event.type === 'done') {
          setMessages((prev) => [...prev, { role: 'ai', text: event.greeting }]);
          setStreamingText('');
          setStatus('ready');
          return;
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
    } catch (err) {
      // Non-fatal: log but let user still talk
      console.error('[greeting]', err);
    } finally {
      setStreamingText('');
      setStatus('ready');
    }
  }, [processAudioQueue]);

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

    // Show a pending user bubble immediately so the user sees something happened
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
              { role: 'ai', text: '', pending: true }, // placeholder for AI response
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
          // Text arrives with audio chunks instead
        } else if (event.type === 'audio') {
          audioQueueRef.current.push({ b64: event.audio_b64, text: event.text, isGreeting: false });
          processAudioQueue();
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastAiMsgIndex = newMessages.findLastIndex((m) => m.role === 'ai');
            if (lastAiMsgIndex >= 0) {
              newMessages[lastAiMsgIndex] = { ...newMessages[lastAiMsgIndex], pending: false };
            }
            return newMessages;
          });
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
