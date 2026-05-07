'use client';

import { useState } from 'react';
import type { MessageInputProps } from './message-input.types';

export function MessageInput({ onSendText, onToggleMic, isRecording, disabled }: MessageInputProps) {
  const [text, setText] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
      e.preventDefault();
      onSendText(text.trim());
      setText('');
    }
  };

  const handleSend = () => {
    if (text.trim()) {
      onSendText(text.trim());
      setText('');
    }
  };

  return (
    <div className="px-6 pb-6 flex flex-col items-center gap-3">
      <button
        onClick={onToggleMic}
        disabled={disabled}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
          isRecording
            ? 'bg-red-500 hover:bg-red-600 scale-110'
            : 'bg-[#4A6741] hover:bg-[#3D5535]'
        }`}
      >
        {isRecording ? <StopIcon /> : <MicIcon />}
      </button>

      <div className="flex items-center w-full max-w-2xl rounded-2xl border border-[#E5E0D8] bg-white px-4 py-3 gap-3">
        <input
          type="text"
          placeholder="Type"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isRecording}
          className="flex-1 text-sm text-gray-700 placeholder:text-gray-400 outline-none bg-transparent disabled:cursor-not-allowed"
        />
        {text.trim() && (
          <button
            onClick={handleSend}
            className="text-[#4A6741] hover:text-[#3D5535] transition-colors shrink-0"
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        )}
        <button
          className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
          aria-label="Translate"
        >
          <TranslateIcon />
        </button>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function TranslateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 8l6 6" />
      <path d="M4 14l6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="M22 22l-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  );
}
