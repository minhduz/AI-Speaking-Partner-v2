'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { MessageInput } from '@/components/chat/message-input/message-input';
import { useAuth } from '@/hooks/use-auth';
import { useChat } from '@/hooks/use-chat';
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
    quotaWarning,
    currentSessionId,
    toggleMic,
    startNewSession,
    dismissQuotaWarning,
  } = useChat();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevSessionId = useRef<string | null>(null);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);

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
        <header className="flex items-center justify-between px-6 py-4 bg-[#F5F2EA] border-b border-[#EAE6DF]">
          <div className="w-8" />
          <StatusBadge status={status} />
          <div className="w-8" />
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
          {/* Pre-session: greeting sentences appear one by one with fade-in */}
          {!hasSession && greetingSentences.length > 0 && (
            <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
              {greetingSentences.map((sentence, i) => (
                <p key={i} className="text-2xl font-medium text-gray-700 leading-relaxed max-w-xl animate-reveal">
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
              <div className="w-8 h-8 rounded-full border-2 border-[#4A6741] border-t-transparent animate-spin" />
            </div>
          )}

          {/* Session active: message bubbles */}
          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}

          {/* Quota warning banner */}
          {quotaWarning && (
            <div className="flex justify-center my-2">
              <div className="flex items-center gap-3 bg-amber-50 text-amber-700 px-4 py-2.5 rounded-2xl text-sm font-medium shadow-sm border border-amber-200 max-w-md">
                <span>You&apos;ve used {quotaWarning.percent_used}% of your monthly quota.</span>
                <a
                  href={quotaWarning.upgrade_url}
                  className="shrink-0 px-3 py-1 bg-[#4A6741] text-white rounded-lg text-xs font-semibold hover:bg-[#3D5535] transition-colors"
                >
                  Upgrade
                </a>
                <button onClick={dismissQuotaWarning} className="shrink-0 text-amber-400 hover:text-amber-600 transition-colors">
                  ✕
                </button>
              </div>
            </div>
          )}

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
          onToggleMic={toggleMic}
          isRecording={isRecording}
          disabled={micDisabled}
        />
      </main>
    </>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isAi = message.role === 'ai';
  return (
    <div className={`flex ${isAi ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isAi
            ? 'bg-white text-gray-800 rounded-tl-sm shadow-sm'
            : 'bg-[#4A6741] text-white rounded-tr-sm'
        }`}
      >
        {message.pending ? (
          <ThinkingDots />
        ) : isAi && message.sentences && message.sentences.length > 0 ? (
          <div className="flex flex-col gap-1">
            {message.sentences.map((s, i) => (
              <p key={i} className="animate-reveal">{s}</p>
            ))}
          </div>
        ) : (
          <p>{message.text}</p>
        )}
        {!message.pending && message.pronunciationScore !== undefined && (
          <p className={`text-xs mt-1 font-medium ${isAi ? 'text-gray-400' : 'text-green-200'}`}>
            Pronunciation: {Math.round(message.pronunciationScore * 100)}%
          </p>
        )}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex gap-1 items-center h-5 text-gray-400 font-medium animate-pulse">
      Thinking...
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
    greeting: 'text-blue-500',
    ready: 'text-[#4A6741]',
    recording: 'text-red-500',
    processing: 'text-amber-500',
    error: 'text-red-400',
  };
  return (
    <span className={`text-xs font-medium ${colors[status] ?? 'text-gray-400'}`}>
      {labels[status] ?? status}
    </span>
  );
}
