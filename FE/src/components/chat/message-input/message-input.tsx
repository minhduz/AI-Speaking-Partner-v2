'use client';

import { useState } from 'react';
import type { MessageInputProps } from './message-input.types';
import { DictionaryPopup } from '../dictionary-popup/dictionary-popup';
import { useDictionary } from '@/hooks/use-dictionary';

export function MessageInput({ onSendText, onStartMic, onStopMic, isRecording, disabled }: MessageInputProps) {
  const [text, setText] = useState('');
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
    <div className="px-4 pb-6 pt-2 w-full flex justify-center bg-gradient-to-t from-[#F8F9FB] to-transparent">
      <div className="flex items-end w-full max-w-3xl gap-2 md:gap-3 relative">
        {/* Input Pill */}
        <div className="flex-1 flex items-center rounded-3xl border border-gray-200 bg-white shadow-sm focus-within:border-violet-300 focus-within:ring-4 focus-within:ring-violet-50 transition-all pl-2 pr-4 py-1.5 min-h-[56px]">
          <DictionaryPopup 
            isOpen={dictionary.isOpen} 
            onClose={dictionary.close} 
            isLoading={dictionary.isLoading} 
            data={dictionary.data}
            error={dictionary.error}
          />
          <input
            type="text"
            placeholder={isRecording ? "Listening..." : "Type or speak..."}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || isRecording}
            className="flex-1 px-3 bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none disabled:opacity-50"
          />
          <button
            onClick={() => dictionary.translate(text)}
            disabled={!text.trim() || isRecording}
            className={`p-2 rounded-xl transition-colors shrink-0 ${text.trim() ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-800' : 'text-gray-300'}`}
            aria-label="Translate"
          >
            <TranslateIcon />
          </button>
        </div>

        {/* Action Button (Mic / Send) */}
        <div className="shrink-0 flex items-center h-[56px]">
          {text.trim() ? (
            <button
              onClick={handleSend}
              className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-[#8447FF] text-white flex items-center justify-center shadow-md hover:bg-[#7C3AED] active:scale-95 transition-all"
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          ) : (
            <button
              disabled={disabled}
              aria-label={isRecording ? 'Release to send' : 'Hold to talk'}
              onMouseDown={onStartMic}
              onMouseUp={onStopMic}
              onMouseLeave={onStopMic}
              onTouchStart={(e) => { e.preventDefault(); onStartMic(); }}
              onTouchEnd={(e) => { e.preventDefault(); onStopMic(); }}
              onTouchCancel={(e) => { e.preventDefault(); onStopMic(); }}
              className={`w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center shadow-md transition-all select-none disabled:opacity-50 disabled:cursor-not-allowed ${
                isRecording
                  ? 'bg-rose-500 scale-110 ring-4 ring-rose-200 animate-pulse'
                  : 'bg-[#8447FF] hover:bg-[#7C3AED] active:scale-95'
              }`}
            >
              <MicIcon />
            </button>
          )}
        </div>
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
