'use client';

import { useState, useRef, useEffect } from 'react';
import type { MessageInputProps } from './message-input.types';
import { DictionaryPopup } from '../dictionary-popup/dictionary-popup';
import { useDictionary } from '@/hooks/use-dictionary';

export function MessageInput({ onSendText, onStartMic, onStopMic, isRecording, disabled, hideMic }: MessageInputProps) {
  const [text, setText] = useState('');
  const micBtnRef = useRef<HTMLButtonElement>(null);

  // Non-passive touch listeners so e.preventDefault() works, preventing the browser
  // from also firing synthetic mouse events (mousedown/mouseup) after touch events.
  // Without this, startMic gets called twice on touch (touchstart + mousedown).
  useEffect(() => {
    const btn = micBtnRef.current;
    if (!btn || hideMic) return;
    const handleTouchStart = (e: TouchEvent) => { e.preventDefault(); onStartMic(); };
    const handleTouchEnd = (e: TouchEvent) => { e.preventDefault(); onStopMic(); };
    btn.addEventListener('touchstart', handleTouchStart, { passive: false });
    btn.addEventListener('touchend', handleTouchEnd, { passive: false });
    btn.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    return () => {
      btn.removeEventListener('touchstart', handleTouchStart);
      btn.removeEventListener('touchend', handleTouchEnd);
      btn.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [hideMic, onStartMic, onStopMic]);
  const dictionary = useDictionary();

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
      <div className="flex items-center w-full max-w-2xl rounded-2xl border border-[#E5E0D8] bg-white px-4 py-3 gap-3 relative">
        <DictionaryPopup
          isOpen={dictionary.isOpen}
          onClose={dictionary.close}
          isLoading={dictionary.isLoading}
          data={dictionary.data}
          error={dictionary.error}
          targetLang={dictionary.targetLang}
          onLanguageChange={dictionary.changeLanguage}
          onAddFlashcard={dictionary.addFlashcard}
        />

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
            onClick={() => dictionary.translate(text)}
            disabled={isRecording}
            className="p-2 rounded-xl transition-colors shrink-0 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label="Translate"
          >
            <TranslateIcon />
          </button>
        )}

        {text.trim() ? (
          <button
            onClick={handleSend}
            className="w-10 h-10 rounded-full bg-[#8447FF] text-white flex items-center justify-center shadow-md hover:bg-[#7C3AED] active:scale-95 transition-all shrink-0"
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        ) : !hideMic ? (
          <button
            ref={micBtnRef}
            disabled={disabled}
            aria-label={isRecording ? 'Release to send' : 'Hold to talk'}
            onMouseDown={onStartMic}
            onMouseUp={onStopMic}
            onMouseLeave={onStopMic}
            className={`w-10 h-10 rounded-full flex items-center justify-center shadow-md transition-all select-none disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ${
              isRecording
                ? 'bg-rose-500 scale-110 ring-4 ring-rose-200 animate-pulse'
                : 'bg-[#8447FF] hover:bg-[#7C3AED] active:scale-95'
            }`}
          >
            <MicIcon />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
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
