'use client';

import { useRef } from 'react';
import type { MessageInputProps } from './message-input.types';

export function MessageInput({ onStartMic, onStopMic, isRecording, disabled, disabledReason, hideMic }: MessageInputProps) {
  const micBtnRef = useRef<HTMLButtonElement>(null);
  const activePointerIdRef = useRef<number | null>(null);

  if (hideMic) return null;

  return (
    <div className="px-6 pb-8 flex justify-center">
      <div className="relative flex flex-col items-center gap-4">
        {/* Ambient glow ring */}
        <div
          className={`pointer-events-none absolute inset-0 m-auto rounded-full transition-all duration-300 ${
            isRecording
              ? 'h-28 w-28 bg-rose-400/30 blur-xl scale-125 animate-pulse'
              : 'h-28 w-28 bg-[#8447FF]/20 blur-xl scale-100'
          }`}
        />

        {/* Mic button — Duolingo lip style */}
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
          className={`relative h-[88px] w-[88px] rounded-full flex items-center justify-center text-white select-none touch-none transition-all duration-200
            disabled:opacity-40 disabled:cursor-not-allowed
            ${isRecording
              ? 'scale-110 ring-8 ring-rose-200/80 animate-pulse'
              : 'hover:scale-105'
            }
          `}
          style={
            disabled
              ? {
                  background: disabledReason ? '#2f3437' : '#ccc',
                  boxShadow: disabledReason ? '0 6px 0 #171a1c' : '0 6px 0 #aaa',
                  borderRadius: '50%',
                }
              : isRecording
              ? { background: 'linear-gradient(145deg, #ff6b7a, #e53e3e)', boxShadow: '0 6px 0 #a31b1b', borderRadius: '50%' }
              : { background: 'linear-gradient(145deg, #9B6BFF, #8447FF)', boxShadow: '0 6px 0 #5c2fd6', borderRadius: '50%' }
          }
          onMouseDown={(e) => {
            if (!disabled && !isRecording) {
              (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.05) translateY(6px)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = isRecording
                ? '0 0 0 #a31b1b'
                : '0 0 0 #5c2fd6';
            }
          }}
          onMouseUp={(e) => {
            if (!disabled) {
              (e.currentTarget as HTMLButtonElement).style.transform = '';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = isRecording
                ? '0 6px 0 #a31b1b'
                : '0 6px 0 #5c2fd6';
            }
          }}
        >
          {/* Inner highlight ring */}
          <span className="absolute inset-2 rounded-full bg-white/15" />
          {isRecording ? <StopIcon /> : <MicIcon />}
        </button>

        {/* Label */}
        <div className="relative flex flex-col items-center gap-0.5">
          <p className="text-xs font-extrabold tracking-widest uppercase" style={{ color: isRecording ? '#e53e3e' : disabled ? (disabledReason ? '#2f3437' : '#c0c0c0') : '#8447FF' }}>
            {disabled && disabledReason ? disabledReason : isRecording ? 'Recording' : disabled ? 'Listen first' : 'Hold to speak'}
          </p>
          {!disabled && !isRecording && (
            <p className="text-[10px] font-medium" style={{ color: '#c0c0c0' }}>Release to send</p>
          )}
        </div>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg className="relative z-10 h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="relative z-10 h-8 w-8" viewBox="0 0 24 24" fill="white">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
