'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { MessageInput } from '@/components/chat/message-input/message-input';
import { DictionaryPopup } from '@/components/chat/dictionary-popup/dictionary-popup';
import { useAuth } from '@/hooks/use-auth';
import { useChat } from '@/hooks/use-chat';
import { useDictionary } from '@/hooks/use-dictionary';
import type { ChatMessage } from '@/types/session.types';

const Waveform = dynamic(
  () => import('@/components/chat/waveform/waveform').then((m) => m.Waveform),
  { ssr: false, loading: () => <div style={{ height: '100px' }} /> },
);

export default function ChatPage() {
  const { handleLogout } = useAuth();
  const {
    messages,
    status,
    greetingSentences,
    isRecording,
    analyser,
    errorMessage,
    currentSessionId,
    startMic,
    stopMic,
    startNewSession,
  } = useChat();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevSessionId = useRef<string | null>(null);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);

  const wordDictionary = useDictionary();
  const [dictAnchor, setDictAnchor] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, greetingSentences]);

  // Increment sidebar refresh key whenever a new session is created
  useEffect(() => {
    if (currentSessionId && currentSessionId !== prevSessionId.current) {
      setSidebarRefreshKey((k) => k + 1);
    }
    prevSessionId.current = currentSessionId;
  }, [currentSessionId]);

  const handleWordDoubleClick = useCallback((word: string, e: React.MouseEvent) => {
    const x = Math.min(e.clientX, window.innerWidth - 336);
    const y = e.clientY + 12;
    setDictAnchor({ top: y, left: x });
    wordDictionary.translate(word);
  }, [wordDictionary]);

  const handleDictClose = useCallback(() => {
    wordDictionary.close();
  }, [wordDictionary]);

  // Mic is disabled while greeting plays, processing, or idle startup
  const micDisabled = status === 'idle' || status === 'greeting' || status === 'processing';

  const hasSession = currentSessionId !== null;

  return (
    <>
      <Sidebar
        onNewChat={startNewSession}
        onLogout={handleLogout}
        currentSessionId={currentSessionId}
        refreshKey={sidebarRefreshKey}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between px-6 pt-6 pb-2 z-10 shrink-0">
          <div className="w-8" />
          <StatusBadge status={status} />
          <div className="w-8" />
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
          {/* Pre-session: greeting sentences appear one by one with fade-in */}
          {!hasSession && greetingSentences.length > 0 && (
            <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
              {greetingSentences.map((sentence, i) => (
                <p key={i} className="text-2xl font-medium text-gray-700 leading-relaxed max-w-xl">
                  {sentence}
                </p>
              ))}
              {status === 'ready' && (
                <p className="text-sm text-gray-400 animate-reveal">Press the mic button and start speaking.</p>
              )}
            </div>
          )}

          {/* Pre-session: greeting failed or skipped — fallback */}
          {!hasSession && greetingSentences.length === 0 && status === 'ready' && messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
              <p className="text-xl font-semibold text-gray-700">Ready when you are</p>
              <p className="text-sm text-gray-400">Press the mic button and start speaking.</p>
            </div>
          )}

          {/* Loading while greeting starts */}
          {!hasSession && status === 'greeting' && greetingSentences.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-[#8447FF] border-t-transparent animate-spin" />
            </div>
          )}

          {/* Session active: message bubbles */}
          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} onWordDoubleClick={handleWordDoubleClick} />
          ))}

          {/* Error banner */}
          {errorMessage && (
            <div className="flex justify-center my-2">
              <div className="flex items-center gap-2 bg-red-50 text-red-600 px-4 py-2.5 rounded-full text-sm font-medium shadow-sm border border-red-100">
                {errorMessage}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Waveform during recording */}
        {isRecording && (
          <div className="flex justify-center py-2">
            <Waveform isRecording={isRecording} analyser={analyser} />
          </div>
        )}

        <MessageInput
          onSendText={() => {}}
          onStartMic={startMic}
          onStopMic={stopMic}
          isRecording={isRecording}
          disabled={micDisabled}
        />
      </main>

      {/* Dictionary popup — fixed position relative to double-clicked word */}
      {wordDictionary.isOpen && dictAnchor && (
        <DictionaryPopup
          isOpen={wordDictionary.isOpen}
          onClose={handleDictClose}
          isLoading={wordDictionary.isLoading}
          data={wordDictionary.data}
          error={wordDictionary.error}
          style={{ position: 'fixed', top: dictAnchor.top, left: dictAnchor.left, zIndex: 100 }}
          targetLang={wordDictionary.targetLang}
          onLanguageChange={wordDictionary.changeLanguage}
          onAddFlashcard={wordDictionary.addFlashcard}
        />
      )}
    </>
  );
}

function MessageBubble({
  message,
  onWordDoubleClick,
}: {
  message: ChatMessage;
  onWordDoubleClick: (word: string, e: React.MouseEvent) => void;
}) {
  const isAi = message.role === 'ai';

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    let word = selection?.toString().trim();
    if (word) {
      word = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (word.length > 0) {
        onWordDoubleClick(word, e);
      }
    }
  }, [onWordDoubleClick]);

  return (
    <div className={`flex w-full ${isAi ? 'justify-start' : 'justify-end'} px-2 py-1`}>
      <div
        onDoubleClick={handleDoubleClick}
        className={`max-w-[85%] md:max-w-[75%] flex flex-col select-text cursor-text ${isAi ? 'items-start' : 'items-end'}`}
      >
        {message.pending ? (
          <ThinkingDots />
        ) : isAi && message.sentences && message.sentences.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {message.sentences.map((s, i) => (
              <p key={i} className="text-xl md:text-2xl font-medium text-gray-900 leading-relaxed tracking-tight animate-reveal">
                {s}
              </p>
            ))}
          </div>
        ) : (
          <p className={`text-xl md:text-2xl font-medium leading-relaxed tracking-tight ${isAi ? 'text-gray-900' : 'text-gray-400'}`}>
            {message.text}
          </p>
        )}
        {!message.pending && message.pronunciationScore !== undefined && (
          <div className={`mt-2 inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase ${isAi ? 'bg-gray-100 text-gray-400' : 'bg-violet-50 text-[#8447FF]'}`}>
            Pronunciation: {Math.round(message.pronunciationScore * 100)}%
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex gap-1 items-center h-5 px-1">
      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    idle: 'Starting…',
    greeting: 'Speaking…',
    ready: 'Ready',
    recording: 'Listening…',
    processing: 'Thinking…',
    error: 'Error — tap mic to retry',
  };
  const colors: Record<string, string> = {
    idle: 'text-gray-400',
    greeting: 'text-violet-500',
    ready: 'text-[#8447FF]',
    recording: 'text-rose-500',
    processing: 'text-amber-500',
    error: 'text-rose-400',
  };
  return (
    <span className={`text-xs font-medium ${colors[status] ?? 'text-gray-400'}`}>
      {labels[status] ?? status}
    </span>
  );
}
