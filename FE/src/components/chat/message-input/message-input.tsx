'use client';

import { useEffect, useRef } from 'react';
import type { MessageInputProps } from './message-input.types';

export function MessageInput({ onStartMic, onStopMic, isRecording, disabled, disabledReason, hideMic }: MessageInputProps) {
  const micBtnRef = useRef<HTMLButtonElement>(null);
  const activePointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (activePointerIdRef.current === null) return;
      activePointerIdRef.current = null;
      onStopMic();
    };
  }, [onStopMic]);

  if (hideMic) return null;

  const buttonStyle = disabled
    ? {
        background: disabledReason ? '#f3f3f3' : '#f3f3f3',
        color: disabledReason ? '#6f7b64' : '#afafaf',
        boxShadow: '0 6px 0 #e2e2e2',
        border: '2px solid #e2e2e2',
      }
    : isRecording
      ? {
          background: '#ff5c5c',
          color: '#ffffff',
          boxShadow: '0 6px 0 #c73232',
          border: '2px solid #e54848',
        }
      : {
          background: '#58cc02',
          color: '#ffffff',
          boxShadow: '0 6px 0 #46a302',
          border: '2px solid #46a302',
        };

  return (
    <div
      className="px-6 flex justify-center"
      style={{
        paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))',
        fontFamily: 'Lexend, sans-serif',
      }}
    >
      <div className="relative flex flex-col items-center gap-3">
        <div
          className={`pointer-events-none absolute inset-0 m-auto rounded-full transition-all duration-300 ${
            isRecording
              ? 'h-28 w-28 bg-[#ff5c5c]/20 blur-xl scale-125 animate-pulse'
              : 'h-28 w-28 bg-[#58cc02]/20 blur-xl scale-100'
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
          className={`relative h-[88px] w-[88px] rounded-[30px] flex items-center justify-center select-none touch-none transition-all duration-200
            disabled:opacity-70 disabled:cursor-not-allowed
            ${isRecording ? 'scale-105 animate-pulse' : disabled ? '' : 'hover:-translate-y-0.5 hover:brightness-[1.03] active:translate-y-1'}
          `}
          style={buttonStyle}
        >
          <span className="absolute inset-2 rounded-[24px] bg-white/20" />
          {isRecording ? <StopIcon /> : <MicIcon />}
        </button>

        <div className="relative flex flex-col items-center gap-0.5">
          <p className="text-[11px] font-extrabold tracking-widest uppercase" style={{ color: isRecording ? '#c73232' : disabled ? '#afafaf' : '#2b6c00' }}>
            {disabled && disabledReason ? disabledReason : isRecording ? 'Recording' : disabled ? 'Listen first' : 'Hold to speak'}
          </p>
          {!disabled && !isRecording && (
            <p className="text-[10px] font-semibold" style={{ color: '#afafaf' }}>Release to send</p>
          )}
        </div>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg className="relative z-10 h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
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
      <rect x="6" y="6" width="12" height="12" rx="3" />
    </svg>
  );
}
