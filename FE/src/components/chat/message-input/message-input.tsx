'use client';

import { useRef } from 'react';
import type { MessageInputProps } from './message-input.types';

export function MessageInput({ onStartMic, onStopMic, isRecording, disabled, hideMic }: MessageInputProps) {
  const micBtnRef = useRef<HTMLButtonElement>(null);
  const activePointerIdRef = useRef<number | null>(null);

  if (hideMic) return null;

  return (
    <div className="px-6 pb-6 flex justify-center">
      <div className="relative flex flex-col items-center gap-3">
        <div
          className={`pointer-events-none absolute inset-0 m-auto h-24 w-24 rounded-full transition-all duration-300 ${
            isRecording
              ? 'bg-rose-400/25 blur-md scale-125 animate-pulse'
              : 'bg-[#8447FF]/15 blur-lg scale-100'
          }`}
        />
        <button
          ref={micBtnRef}
          disabled={disabled}
          aria-label={isRecording ? 'Release to send' : 'Hold to talk'}
          onPointerDown={(e) => {
            if (disabled || activePointerIdRef.current !== null) return;
            e.preventDefault();
            activePointerIdRef.current = e.pointerId;
            e.currentTarget.setPointerCapture(e.pointerId);
            onStartMic();
          }}
          onPointerUp={(e) => {
            if (activePointerIdRef.current !== e.pointerId) return;
            e.preventDefault();
            activePointerIdRef.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            onStopMic();
          }}
          onPointerCancel={(e) => {
            if (activePointerIdRef.current !== e.pointerId) return;
            activePointerIdRef.current = null;
            onStopMic();
          }}
          className={`relative h-20 w-20 rounded-full flex items-center justify-center text-white shadow-[0_18px_45px_rgba(132,71,255,0.32)] transition-all duration-200 select-none touch-none disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none ${
            isRecording
              ? 'bg-gradient-to-br from-rose-400 to-rose-600 scale-110 ring-8 ring-rose-200/80 animate-pulse'
              : 'bg-gradient-to-br from-[#9B6BFF] via-[#8447FF] to-[#6D35E8] hover:scale-105 active:scale-95'
          }`}
        >
          <span className="absolute inset-2 rounded-full bg-white/15" />
          <MicIcon />
        </button>
        <p className="relative text-[11px] font-semibold tracking-wide text-gray-400">
          {isRecording ? 'Release to send' : disabled ? 'Listen first…' : 'Hold to speak'}
        </p>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg className="relative z-10 h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2">
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}
