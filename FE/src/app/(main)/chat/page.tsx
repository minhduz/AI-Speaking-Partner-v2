'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { MessageInput } from '@/components/chat/message-input/message-input';
import { DictionaryPopup } from '@/components/chat/dictionary-popup/dictionary-popup';
import { MissionCard } from '@/components/chat/mission-card/mission-card';
import { OnboardingPanel } from '@/components/chat/onboarding-panel/onboarding-panel';
import { useAuth } from '@/hooks/use-auth';
import { useChat } from '@/hooks/use-chat';
import { useDictionary } from '@/hooks/use-dictionary';
import type { ChatMessage, SessionSummary } from '@/types/session.types';

const POPUP_W = 320;
const POPUP_H = 440;
const SNAP_M = 12;

// Pick the corner opposite to where the user clicked so the popup never covers the word.
function getSnapCorner(cx: number, cy: number) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  return {
    top:  cy >= H / 2 ? SNAP_M : H - POPUP_H - SNAP_M,
    left: cx >= W / 2 ? SNAP_M : W - POPUP_W - SNAP_M,
  };
}

const CORNER_STYLES: React.CSSProperties[] = [
  { top: SNAP_M, left: SNAP_M },
  { top: SNAP_M, right: SNAP_M },
  { bottom: SNAP_M, left: SNAP_M },
  { bottom: SNAP_M, right: SNAP_M },
];

const Waveform = dynamic(
  () => import('@/components/chat/waveform/waveform').then((m) => m.Waveform),
  { ssr: false, loading: () => <div style={{ height: '100px' }} /> },
);

export default function ChatPage() {
  const searchParams = useSearchParams();
  const urlSessionId = searchParams.get('sessionId') ?? undefined;

  const { handleLogout } = useAuth();
  const {
    messages,
    status,
    greetingSentences,
    isRecording,
    analyser,
    errorMessage,
    billingLimitCode,
    currentSessionId,
    sessionTitleUpdate,
    reviewMode,
    reviewSessionId,
    reviewHasMore,
    reviewLoading,
    isOnboardingSession,
    onboardingState,
    isEnding,
    closingText,
    startMic,
    stopMic,
    endSession,
    startNewSession,
    enterReview,
    loadMoreReview,
  } = useChat(urlSessionId);

  // Local UI state: confirm dialog before ending
  const [confirmEnd, setConfirmEnd] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollHeightBeforeRef = useRef(0);
  const prevSessionId = useRef<string | null>(null);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);

  const wordDictionary = useDictionary(sessionTitleUpdate?.title);
  const [dictAnchor, setDictAnchor] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (reviewMode) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, greetingSentences, reviewMode]);

  // After prepend in review mode, restore scroll position so view doesn't jump
  useEffect(() => {
    if (!reviewMode || !scrollHeightBeforeRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const diff = el.scrollHeight - scrollHeightBeforeRef.current;
    if (diff > 0) {
      el.scrollTop += diff;
      scrollHeightBeforeRef.current = 0;
    }
  }, [messages, reviewMode]);

  // Increment sidebar refresh key whenever a new live session is created
  useEffect(() => {
    if (currentSessionId && currentSessionId !== prevSessionId.current) {
      setSidebarRefreshKey((k) => k + 1);
    }
    prevSessionId.current = currentSessionId;
  }, [currentSessionId]);

  const handleWordDoubleClick = useCallback((word: string, e: React.MouseEvent) => {
    setDictAnchor(getSnapCorner(e.clientX, e.clientY));
    wordDictionary.translate(word);
  }, [wordDictionary]);

  const handleDictClose = useCallback(() => {
    wordDictionary.close();
  }, [wordDictionary]);

  // Mic is disabled while greeting plays, processing, or idle startup
  const micDisabled = status === 'idle' || status === 'greeting' || status === 'processing';

  // Scroll-up handler for review mode: load earlier messages when near top
  const handleReviewScroll = useCallback(() => {
    if (!reviewMode || !reviewHasMore || reviewLoading) return;
    const el = scrollContainerRef.current;
    if (!el || el.scrollTop > 80) return;
    scrollHeightBeforeRef.current = el.scrollHeight;
    loadMoreReview();
  }, [reviewMode, reviewHasMore, reviewLoading, loadMoreReview]);

  const handleSessionClick = useCallback((session: SessionSummary) => {
    enterReview(session.id);
  }, [enterReview]);

  const hasSession = currentSessionId !== null;

  // Sidebar highlights: reviewed session takes priority over live session
  const activeSidebarSessionId = reviewSessionId ?? currentSessionId;

  const isFocusedLiveSession = !reviewMode && hasSession;

  // ── CLOSING_MODE overlay ────────────────────────────────────────────────────
  // Shown while the AI farewell message is playing. Blocks all interaction.
  if (isEnding) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-white px-8 text-center">
        <div className="h-14 w-14 rounded-full bg-violet-100 flex items-center justify-center">
          {closingText ? (
            <div className="h-7 w-7 rounded-full bg-[#8447FF] animate-pulse" />
          ) : (
            <div className="h-7 w-7 rounded-full border-[3px] border-[#8447FF] border-t-transparent animate-spin" />
          )}
        </div>
        <div className="max-w-md">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-widest mb-3">
            Session ending
          </p>
          {closingText ? (
            <p className="text-xl font-medium text-gray-800 leading-relaxed">
              {closingText}
            </p>
          ) : (
            <p className="text-sm text-gray-400 animate-pulse">Preparing your recap…</p>
          )}
        </div>
      </main>
    );
  }

  // ── Confirm dialog ──────────────────────────────────────────────────────────
  // Shown when user clicks the End button before the closing flow starts.
  if (confirmEnd) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-white px-8 text-center">
        <p className="text-lg font-semibold text-gray-800">End this session?</p>
        <p className="text-sm text-gray-400 max-w-xs">
          The AI will give you a short recap before wrapping up.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setConfirmEnd(false)}
            className="h-10 px-5 rounded-full border border-gray-200 text-sm font-medium text-gray-600 hover:border-gray-300 transition-colors"
          >
            Keep talking
          </button>
          <button
            type="button"
            onClick={() => { setConfirmEnd(false); void endSession('user_clicked'); }}
            className="h-10 px-5 rounded-full bg-[#8447FF] text-white text-sm font-medium hover:bg-violet-700 transition-colors"
          >
            End session
          </button>
        </div>
      </main>
    );
  }

  // ── Focused live-session layout ─────────────────────────────────────────────
  // Sidebar-less view shown once the user starts talking.
  // Also shown during the first onboarding session (with the onboarding panel).
  if (isFocusedLiveSession || isOnboardingSession) {
    return (
      <main className="flex flex-1 flex-col overflow-hidden bg-white">
        {/* AI presence indicator — replaces the normal header */}
        <div className="shrink-0 grid grid-cols-[80px_1fr_80px] items-start px-4 pt-6 pb-2">
          <div />
          <div className="h-12 w-12 justify-self-center rounded-full bg-violet-100 flex items-center justify-center animate-pulse">
            <div className="h-6 w-6 rounded-full bg-[#8447FF]" />
          </div>
          <div className="flex justify-end">
            <EndSessionButton onClick={() => setConfirmEnd(true)} />
          </div>
        </div>

        {/* Scrolling conversation area — same pattern as normal mode */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-6 py-4 flex flex-col items-center gap-3"
        >
          <div className="w-full max-w-md flex flex-col gap-3">
            {/* Greeting shown large until the user replies */}
            {messages.length === 0 && greetingSentences.length > 0 && (
              <div className="text-center text-2xl md:text-3xl font-medium leading-snug text-gray-800 mt-6">
                {greetingSentences.map((sentence, index) => (
                  <p key={index}>{sentence}</p>
                ))}
              </div>
            )}

            {messages.map((msg, i) => (
              <MessageBubble key={i} message={msg} onWordDoubleClick={handleWordDoubleClick} />
            ))}

            {errorMessage && (
              <div className="flex justify-center my-2">
                <ErrorBanner message={errorMessage} showUpgrade={billingLimitCode !== null} />
              </div>
            )}

            {messages.length === 0 && status === 'ready' && greetingSentences.length > 0 && (
              <p className="text-sm text-gray-400 text-center mt-2 animate-reveal">Tap the mic to reply.</p>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {isRecording && (
          <div className="flex justify-center py-2 shrink-0">
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

        <OnboardingPanel isVisible={isOnboardingSession} state={onboardingState} />
      </main>
    );
  }

  // ── Normal layout (pre-session + review) ────────────────────────────────────
  return (
    <>
      <Sidebar
        onNewChat={startNewSession}
        onLogout={handleLogout}
        onSessionClick={handleSessionClick}
        currentSessionId={activeSidebarSessionId}
        refreshKey={sidebarRefreshKey}
        titleUpdate={sessionTitleUpdate}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between px-6 pt-6 pb-2 z-10 shrink-0">
          <div className="w-20" />
          {reviewMode
            ? <span className="text-xs font-medium text-gray-400">History</span>
            : <StatusBadge status={status} />
          }
          <div className="w-20 flex justify-end">
            {!reviewMode && hasSession && (
              <EndSessionButton onClick={() => setConfirmEnd(true)} />
            )}
          </div>
        </header>

        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3"
          onScroll={reviewMode ? handleReviewScroll : undefined}
        >
          {/* Review mode: full-screen spinner on initial session load */}
          {reviewMode && reviewLoading && messages.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-10 h-10 rounded-full border-4 border-[#4A6741]/30 border-t-[#4A6741] animate-spin" />
            </div>
          )}

          {/* Review mode: small top spinner when loading earlier messages (not initial load) */}
          {reviewMode && reviewLoading && messages.length > 0 && (
            <div className="flex justify-center py-3">
              <div className="w-4 h-4 rounded-full border-2 border-[#4A6741] border-t-transparent animate-spin" />
            </div>
          )}

          {/* Mission card — pre-session anchor showing last-session continuity.
              Hidden once a live session starts or while reviewing history. */}
          {!reviewMode && !hasSession && (
            <div className="px-4 pt-2">
              <MissionCard />
            </div>
          )}

          {/* Live mode: greeting */}
          {!reviewMode && !hasSession && greetingSentences.length > 0 && (
            <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
              <p className="text-2xl font-medium text-gray-700 leading-relaxed max-w-xl">
                {greetingSentences.join(' ')}
              </p>
              {status === 'ready' && (
                <p className="text-sm text-gray-400 animate-reveal">Press the mic button and start speaking.</p>
              )}
            </div>
          )}

          {/* Live mode: greeting fallback */}
          {!reviewMode && !hasSession && greetingSentences.length === 0 && status === 'ready' && messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
              <p className="text-xl font-semibold text-gray-700">Ready when you are</p>
              <p className="text-sm text-gray-400">Press the mic button and start speaking.</p>
            </div>
          )}

          {/* Live mode: greeting loading spinner */}
          {!reviewMode && !hasSession && status === 'greeting' && greetingSentences.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-[#8447FF] border-t-transparent animate-spin" />
            </div>
          )}

          {/* Message bubbles (live and review) */}
          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} onWordDoubleClick={handleWordDoubleClick} />
          ))}

          {/* Error banner (live mode only) */}
          {!reviewMode && errorMessage && (
            <div className="flex justify-center my-2">
              <ErrorBanner message={errorMessage} showUpgrade={billingLimitCode !== null} />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Waveform — live mode only */}
        {!reviewMode && isRecording && (
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
          hideMic={reviewMode}
        />
      </main>

      {/* 4 corner snap indicators — visible while popup is open */}
      {wordDictionary.isOpen && CORNER_STYLES.map((cs, i) => (
        <div
          key={i}
          style={{ position: 'fixed', ...cs, width: 14, height: 14, borderRadius: 4, border: '2px solid rgba(132,71,255,0.35)', background: 'rgba(132,71,255,0.08)', zIndex: 99, pointerEvents: 'none' }}
        />
      ))}

      {/* Dictionary popup — snaps to one of 4 corners, draggable between them */}
      {wordDictionary.isOpen && dictAnchor && (
        <DictionaryPopup
          key={`${dictAnchor.top}-${dictAnchor.left}`}
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

function ErrorBanner({ message, showUpgrade }: { message: string; showUpgrade: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-red-50 text-red-600 px-4 py-2.5 rounded-2xl text-sm font-medium shadow-sm border border-red-100">
      <span>{message}</span>
      {showUpgrade && (
        <Link
          href="/billing"
          className="inline-flex h-8 shrink-0 items-center justify-center rounded-full bg-[#8447FF] px-3 text-xs font-semibold text-white hover:bg-violet-700 transition-colors"
        >
          Upgrade
        </Link>
      )}
    </div>
  );
}

function EndSessionButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-500 shadow-sm transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-500"
      aria-label="End session"
      title="End session"
    >
      <X className="h-4 w-4" aria-hidden="true" />
      <span>End</span>
    </button>
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

  // AI bubbles always render as a sentence-per-line list. While streaming, the
  // last item is the currently-revealing segment (filled in word-by-word). When
  // pending flips to false, the layout is unchanged — same flex column, same
  // gap — so there is no visual jump at end-of-turn.
  const aiSentences = isAi
    ? (message.sentences && message.sentences.length > 0
        ? message.sentences
        : message.text
          ? [message.text]
          : [])
    : null;
  const showThinkingDots = message.pending && isAi && (aiSentences?.length ?? 0) === 0;

  return (
    <div className={`flex w-full ${isAi ? 'justify-start' : 'justify-end'} px-2 py-1`}>
      <div
        onDoubleClick={handleDoubleClick}
        className={`max-w-[85%] md:max-w-[75%] flex flex-col select-text cursor-text ${isAi ? 'items-start' : 'items-end'}`}
      >
        {showThinkingDots ? (
          <ThinkingDots />
        ) : isAi && aiSentences ? (
          <div className="flex flex-col gap-1.5">
            {aiSentences.map((s, i) => (
              <p key={i} className="text-xl md:text-2xl font-medium text-gray-900 leading-relaxed tracking-tight">
                {s}
              </p>
            ))}
          </div>
        ) : message.pending ? (
          <p className="text-xl md:text-2xl font-medium leading-relaxed tracking-tight text-gray-300">
            {message.text || '…'}
          </p>
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
