'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { X, Mic2, Sparkles, Waves } from 'lucide-react';
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { MessageInput } from '@/components/chat/message-input/message-input';
import { DictionaryPopup } from '@/components/chat/dictionary-popup/dictionary-popup';
import { MissionCard } from '@/components/chat/mission-card/mission-card';
import { OnboardingPanel } from '@/components/chat/onboarding-panel/onboarding-panel';
import { useAuth } from '@/hooks/use-auth';
import { useChat } from '@/hooks/use-chat';
import { useDictionary } from '@/hooks/use-dictionary';
import type { ChatMessage, SessionSummary } from '@/types/session.types';
import type { DeckCard, ExerciseDeck } from '@/services/session.service';

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
    sessionStarted,
    currentDeck,
    lighterMode,
    advanceDeckCard,
    skipDeckCard,
    acceptDeckChallenge,
    rejectDeckChallenge,
    enterLighterMode,
    completeLighterDeck,
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
  const isLimitReached = billingLimitCode !== null;
  const micDisabled = isLimitReached || status === 'idle' || status === 'greeting' || status === 'processing';

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

  // Sidebar highlights: reviewed session takes priority over live session
  const activeSidebarSessionId = reviewSessionId ?? currentSessionId;

  // Layout switches to focused (no sidebar) only when the user has tapped mic at
  // least once — not when the session is eagerly created in the background.
  const isFocusedLiveSession = !reviewMode && sessionStarted;

  // For onboarding, the not_started deck card is revealed only after the AI
  // has delivered its MINI_CHALLENGE transition sentence. We detect this by
  // scanning the last AI message for known transition keywords.
  // Once in_progress (user accepted), always show regardless.
  const TRANSITION_KEYWORDS = ['real practice', 'quick practice', 'short exercise', "let's try", "ready for a quick", "i've got a short"];
  const lastAiText = [...messages].reverse().find((m) => m.role === 'ai')?.text?.toLowerCase() ?? '';
  const aiHasTransitioned = TRANSITION_KEYWORDS.some((kw) => lastAiText.includes(kw));

  const onboardingDeckReady =
    !isOnboardingSession ||
    currentDeck?.status === 'in_progress' ||
    aiHasTransitioned;

  const deckVisible =
    currentDeck !== null &&
    onboardingDeckReady &&
    (currentDeck.status === 'not_started' || currentDeck.status === 'in_progress') &&
    currentDeck.cards.length > 0;

  // ── CLOSING_MODE overlay ────────────────────────────────────────────────────
  // Shown while the AI farewell message is playing. Blocks all interaction.
  if (isEnding) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-white px-8 text-center">
        <div
          className="h-16 w-16 rounded-2xl flex items-center justify-center"
          style={{ background: '#f0e8ff' }}
        >
          {closingText ? (
            <div className="h-8 w-8 rounded-full animate-pulse" style={{ background: '#8447FF' }} />
          ) : (
            <div className="h-8 w-8 rounded-full border-[3px] border-[#8447FF] border-t-transparent animate-spin" />
          )}
        </div>
        <div className="max-w-md">
          <p className="text-[10px] font-extrabold uppercase tracking-widest mb-3" style={{ color: '#afafaf' }}>
            Session ending
          </p>
          {closingText ? (
            <p className="text-xl font-bold leading-relaxed" style={{ color: '#3c3c3c' }}>
              {closingText}
            </p>
          ) : (
            <p className="text-sm font-medium animate-pulse" style={{ color: '#c0c0c0' }}>Preparing your recap…</p>
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
        <div
          className="h-16 w-16 rounded-2xl flex items-center justify-center text-3xl"
          style={{ background: '#fff1f0', boxShadow: '0 4px 0 #ffd7d5' }}
        >
          🛑
        </div>
        <div className="max-w-xs">
          <p className="text-xl font-extrabold mb-2" style={{ color: '#3c3c3c' }}>End this session?</p>
          <p className="text-sm font-medium" style={{ color: '#afafaf' }}>
            The AI will give you a short recap before wrapping up.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setConfirmEnd(false)}
            className="lip-btn lip-btn-ghost h-11 px-6 text-sm"
            style={{ '--btn-radius': '14px' } as React.CSSProperties}
          >
            Keep talking
          </button>
          <button
            type="button"
            onClick={() => { setConfirmEnd(false); void endSession('user_clicked'); }}
            className="lip-btn h-11 px-6 text-sm"
            style={{
              '--btn-radius': '14px',
              background: '#e53e3e',
              color: '#fff',
            } as React.CSSProperties}
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
  if (isFocusedLiveSession) {
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

        {/* Deck card — pinned above the conversation when a deck is active.
            Replaces the previous "deck OR bubbles" toggle so the user can see
            what they said and what the AI replied while the card stays in view. */}
        {deckVisible && (
          <div className="shrink-0 border-b border-gray-100 px-6 py-3">
            <DeckCardView
              key={`${currentDeck!.id}-${currentDeck!.current_card_index}-${currentDeck!.status}`}
              deck={currentDeck!}
              isLighter={lighterMode}
              onAccept={() => void acceptDeckChallenge()}
              onReject={() => void rejectDeckChallenge()}
              onLighterMode={() => void enterLighterMode()}
              onEndSession={() => void endSession('user_clicked')}
              onNext={() => lighterMode ? void completeLighterDeck() : void advanceDeckCard()}
              onSkip={() => void skipDeckCard()}
            />
          </div>
        )}

        {/* Conversation — greeting + message bubbles, always rendered. */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-6 py-4 flex flex-col items-center gap-3"
        >
          <div className="w-full max-w-md flex flex-col gap-3">
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

            {messages.length === 0 && status === 'ready' && greetingSentences.length > 0 && !deckVisible && (
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

        {wordDictionary.isOpen && CORNER_STYLES.map((cs, i) => (
          <div key={i} style={{ position: 'fixed', ...cs, width: 14, height: 14, borderRadius: 4, border: '2px solid rgba(132,71,255,0.35)', background: 'rgba(132,71,255,0.08)', zIndex: 99, pointerEvents: 'none' }} />
        ))}
        {wordDictionary.isOpen && dictAnchor && (
          <DictionaryPopup
            key={wordDictionary.lookupKey}
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

      <main
        className="flex flex-1 flex-col overflow-hidden"
        style={{ background: '#f9f9f9' }}
      >
        {/* ── Top bar ── */}
        <header
          className="flex items-center justify-between px-10 h-20 shrink-0 sticky top-0 z-40"
          style={{ background: '#f9f9f9' }}
        >
          {reviewMode ? (
            <h2
              className="text-2xl font-black"
              style={{ fontFamily: 'Lexend, sans-serif', color: '#1a1c1c', letterSpacing: '-0.01em' }}
            >
              History
            </h2>
          ) : (
            <h2
              className="text-2xl font-black"
              style={{ fontFamily: 'Lexend, sans-serif', color: '#2b6c00', letterSpacing: '-0.01em' }}
            >
              Focus Dashboard
            </h2>
          )}

          <div className="flex items-center gap-6">
            {/* Status badge */}
            <StatusBadge status={status} reviewMode={reviewMode} isLimitReached={isLimitReached} />
            {/* End session */}
            {!reviewMode && sessionStarted && (
              <EndSessionButton onClick={() => setConfirmEnd(true)} />
            )}
          </div>
        </header>

        {/* ── Scrollable content ── */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto"
          onScroll={reviewMode ? handleReviewScroll : undefined}
        >
          {/* Review spinners */}
          {reviewMode && reviewLoading && messages.length === 0 && (
            <div className="flex items-center justify-center h-64">
              <div className="w-10 h-10 rounded-full border-4 border-[#58cc02]/30 border-t-[#58cc02] animate-spin" />
            </div>
          )}
          {reviewMode && reviewLoading && messages.length > 0 && (
            <div className="flex justify-center py-3">
              <div className="w-4 h-4 rounded-full border-2 border-[#58cc02] border-t-transparent animate-spin" />
            </div>
          )}

          {/* ── HOME SCREEN ── */}
          {!reviewMode && !sessionStarted && (
            <HomeDashboard
              status={status}
              greetingSentences={greetingSentences}
              onStartSession={startMic}
              insight={null /* MissionCard handles its own fetch */}
            />
          )}

          {/* ── Message bubbles (live + review) ── */}
          {(reviewMode || sessionStarted) && (
            <div className="flex flex-col gap-3 px-10 py-6">
              {messages.map((msg, i) => (
                <MessageBubble key={i} message={msg} onWordDoubleClick={handleWordDoubleClick} />
              ))}
              {!reviewMode && errorMessage && (
                <div className="flex justify-center my-2">
                  <ErrorBanner message={errorMessage} showUpgrade={billingLimitCode !== null} />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Error banner pre-session */}
          {!reviewMode && !sessionStarted && errorMessage && (
            <div className="flex justify-center px-10 my-2">
              <ErrorBanner message={errorMessage} showUpgrade={billingLimitCode !== null} />
            </div>
          )}
        </div>

        {/* Waveform */}
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
          disabledReason={isLimitReached ? 'Limit reached' : undefined}
          hideMic={reviewMode}
        />
      </main>

      {/* Corner snap indicators */}
      {wordDictionary.isOpen && CORNER_STYLES.map((cs, i) => (
        <div
          key={i}
          style={{ position: 'fixed', ...cs, width: 14, height: 14, borderRadius: 4, border: '2px solid rgba(88,204,2,0.35)', background: 'rgba(88,204,2,0.08)', zIndex: 99, pointerEvents: 'none' }}
        />
      ))}
      {wordDictionary.isOpen && dictAnchor && (
        <DictionaryPopup
          key={wordDictionary.lookupKey}
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

function TipCard({ emoji, title, desc, color, textColor }: { emoji: string; title: string; desc: string; color: string; textColor: string }) {
  return (
    <div
      className="rounded-2xl px-4 py-3.5 flex flex-col gap-1"
      style={{ background: color, border: `2px solid ${color}` }}
    >
      <span className="text-xl" role="img">{emoji}</span>
      <p className="text-sm font-extrabold" style={{ color: textColor }}>{title}</p>
      <p className="text-xs font-medium" style={{ color: textColor, opacity: 0.75 }}>{desc}</p>
    </div>
  );
}

function ErrorBanner({ message, showUpgrade }: { message: string; showUpgrade: boolean }) {
  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-3 rounded-2xl text-sm font-bold"
      style={{
        background: '#ffdad6',
        color: '#93000a',
        border: '2px solid #f2b8b5',
      }}
    >
      <span>{message}</span>
      {showUpgrade && (
        <Link href="/billing">
          <button
            className="vp-btn-secondary shrink-0 text-xs"
            style={{ padding: '6px 14px', borderRadius: '12px' }}
          >
            Upgrade
          </button>
        </Link>
      )}
    </div>
  );
}

function EndSessionButton({ onClick }: { onClick: () => void }) {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      aria-label="End session"
      className="inline-flex items-center gap-1.5 text-xs font-bold select-none"
      style={{
        fontFamily: 'Lexend, sans-serif',
        padding: '8px 16px',
        borderRadius: '12px',
        background: hovered ? '#ffe0de' : '#fff0f0',
        color: '#ba1a1a',
        boxShadow: pressed ? '0 1px 0 #f2b8b5' : hovered ? '0 4px 0 #f2b8b5' : '0 3px 0 #f2b8b5',
        transform: pressed ? 'translateY(2px)' : hovered ? 'translateY(-1px)' : 'translateY(0)',
        transition: 'transform 100ms ease, box-shadow 100ms ease, background 100ms ease',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <X size={14} strokeWidth={2.5} />
      End session
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

function DeckCardView({
  deck,
  isLighter,
  onAccept,
  onReject,
  onLighterMode,
  onEndSession,
  onNext,
  onSkip,
}: {
  deck: ExerciseDeck;
  isLighter: boolean;
  onAccept: () => void;
  onReject: () => void;
  onLighterMode: () => void;
  onEndSession: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [showRejectOptions, setShowRejectOptions] = useState(false);

  // In lighter mode: auto-advance as soon as any result arrives (no retry).
  // Normal non-onboarding mode: auto-advance only when AI sets next_action = 'next_card'.
  // Onboarding diagnostic: never auto-advance — wait for the user to press Next/Skip
  // so the first-session flow feels deliberate and conversational.
  const card = deck.cards[deck.current_card_index];
  const isOnboarding = deck.session_type === 'onboarding_diagnostic';
  useEffect(() => {
    if (!card?.result) return;

    // Final onboarding card: briefly show completion state, then finalize the deck
    // so the AI can give the first-session wrap-up without another user click.
    if (isOnboarding && card.next_action === 'finish_session') {
      const t = setTimeout(() => onNext(), 1600);
      return () => clearTimeout(t);
    }

    if (isOnboarding) return;
    if (!isLighter && card.next_action !== 'next_card') return;
    const t = setTimeout(() => onNext(), 2000);
    return () => clearTimeout(t);
  }, [card, card?.result, card?.next_action, isLighter, isOnboarding, onNext]);

  if (!card) return null;

  let cardLabel: string;
  if (isLighter)        cardLabel = 'Quick task';
  else if (isOnboarding) cardLabel = `Mini check ${deck.current_card_index + 1} / ${deck.cards.length}`;
  else                   cardLabel = `Exercise ${deck.current_card_index + 1} / ${deck.cards.length}`;

  const isContinuation = deck.is_continuation === true;
  const acceptLabel = isContinuation ? 'Continue' : "Let’s go";

  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-5 pt-2 pb-4">
      {/* Continuation banner */}
      {isContinuation && deck.status === 'not_started' && (
        <p className="text-xs font-medium text-violet-500 flex items-center gap-1">
          ↩ Picking up from last session
        </p>
      )}

      {/* Mission — hidden in lighter mode to keep it low-pressure */}
      {!isLighter && (
        <div className="bg-violet-50 rounded-2xl px-4 py-3.5">
          <p className="text-[10px] font-semibold text-violet-500 uppercase tracking-widest mb-1">Mission</p>
          <p className="text-sm font-medium text-gray-800 leading-snug">{deck.mission}</p>
          {deck.reason && (
            <p className="text-xs text-gray-500 mt-1.5 leading-snug">{deck.reason}</p>
          )}
        </div>
      )}

      {/* Card */}
      <div className="flex flex-col gap-3">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
          {cardLabel}
          {!isLighter && card.attempts > 0 && (
            <span className="ml-2 normal-case font-normal text-gray-400">
              · Attempt {card.attempts + 1}
            </span>
          )}
        </span>
        <h2 className="text-2xl font-semibold text-gray-900 leading-snug">{card.title}</h2>
        <p className="text-base text-gray-600 leading-relaxed">{card.task}</p>

        {/* Success criteria — hidden in lighter mode */}
        {!isLighter && Array.isArray(card.success_criteria) && card.success_criteria.length > 0 && (
          <ul className="flex flex-col gap-1.5 mt-1">
            {card.success_criteria.map((criterion, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-500">
                <span className="text-violet-400 mt-0.5 shrink-0">✓</span>
                {criterion}
              </li>
            ))}
          </ul>
        )}

        {card.result && card.feedback && (
          <p
            className={`text-sm italic mt-2 leading-snug ${
              card.result === 'passed'
                ? 'text-emerald-600'
                : card.result === 'partial'
                ? 'text-amber-600'
                : 'text-rose-600'
            }`}
          >
            {card.feedback}
          </p>
        )}
      </div>

      {/* Actions */}
      {deck.status === 'not_started' && !showRejectOptions && (
        <div className="flex gap-3">
          <button
            onClick={onAccept}
            className="lip-btn lip-btn-green flex-1 py-3 text-sm"
            style={{ '--btn-radius': '14px' } as React.CSSProperties}
          >
            {acceptLabel}
          </button>
          {isOnboarding ? (
            <button
              onClick={onReject}
              className="lip-btn lip-btn-ghost flex-1 py-3 text-sm"
              style={{ '--btn-radius': '14px' } as React.CSSProperties}
            >
              Maybe later
            </button>
          ) : (
            <button
              onClick={() => setShowRejectOptions(true)}
              className="lip-btn lip-btn-ghost flex-1 py-3 text-sm"
              style={{ '--btn-radius': '14px' } as React.CSSProperties}
            >
              Not today
            </button>
          )}
        </div>
      )}

      {!isOnboarding && deck.status === 'not_started' && showRejectOptions && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-400 text-center tracking-wide">What would you prefer?</p>
          <div className="flex gap-2">
            <button
              onClick={onReject}
              className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 active:scale-95 transition-all"
            >
              Free talk
            </button>
            <button
              onClick={onLighterMode}
              className="flex-1 py-2.5 rounded-xl bg-violet-50 text-violet-700 text-sm font-semibold hover:bg-violet-100 active:scale-95 transition-all"
            >
              Quick task
            </button>
            <button
              onClick={onEndSession}
              className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-500 text-sm font-semibold hover:bg-gray-200 active:scale-95 transition-all"
            >
              That&apos;s all
            </button>
          </div>
        </div>
      )}

      {deck.status === 'in_progress' && (
        <DeckCardActions
          card={card}
          isLighter={isLighter}
          isOnboarding={isOnboarding}
          onNext={onNext}
          onSkip={onSkip}
        />
      )}
    </div>
  );
}

function DeckCardActions({
  card,
  isLighter,
  isOnboarding,
  onNext,
  onSkip,
}: {
  card: DeckCard;
  isLighter: boolean;
  isOnboarding: boolean;
  onNext: () => void;
  onSkip: () => void;
}) {
  const isFinalBoss = card.type === 'final_boss';
  const hasEval = !!card.result;

  // Lighter mode: never show Retry; auto-advance handles progression.
  const showRetry =
    !isLighter && hasEval && card.next_action === 'retry' && card.retry_allowed && (card.attempts ?? 0) < 3;
  const showFinish =
    hasEval && (card.next_action === 'finish_session' || (isFinalBoss && card.result === 'passed'));
  const showNext = hasEval && !showFinish && card.next_action !== 'retry';

  return (
    <div className="flex justify-end gap-2 pt-1">
      {!isLighter && (
        <button
          type="button"
          onClick={onSkip}
          className="h-9 px-4 rounded-full text-sm font-medium text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip
        </button>
      )}
      {showRetry && (
        <button
          type="button"
          className="h-9 px-4 rounded-full border border-gray-200 text-sm font-medium text-gray-500 hover:border-gray-300 hover:bg-gray-50 transition-colors"
        >
          Retry
        </button>
      )}
      {showNext && (
        <button
          type="button"
          onClick={onNext}
          className="vp-btn-primary text-sm"
          style={{ padding: '8px 20px', borderRadius: '12px' }}
        >
          {isLighter ? 'Done ✓' : 'Next →'}
        </button>
      )}
      {showFinish && isOnboarding && (
        <span
          className="inline-flex items-center gap-1.5 h-9 px-5 rounded-full text-sm font-semibold animate-pulse"
          style={{ background: '#e8f9d3', color: '#2b6c00' }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Completed today
        </span>
      )}
      {showFinish && !isOnboarding && (
        <button
          type="button"
          onClick={onNext}
          className="vp-btn-primary text-sm"
          style={{ padding: '8px 20px', borderRadius: '12px', background: '#58cc02', boxShadow: '0 4px 0 #1f5100' }}
        >
          Finish ✓
        </button>
      )}
    </div>
  );
}

// ── HomeDashboard ─────────────────────────────────────────────────────────────────────
function HomeDashboard({
  status,
  greetingSentences,
  onStartSession,
}: {
  status: string;
  greetingSentences: string[];
  onStartSession: () => void;
  insight: null;
}) {
  const [startPressed, setStartPressed] = useState(false);
  const [startHovered, setStartHovered] = useState(false);

  return (
    <div
      className="flex-1 flex flex-col items-center justify-center p-8 w-full"
      style={{ fontFamily: 'Lexend, sans-serif' }}
    >
      <div className="w-full max-w-[700px]">
        <div
          className="rounded-3xl flex flex-col relative overflow-hidden p-8 sm:p-10"
          style={{
            background: 'linear-gradient(145deg, #312e81 0%, #4338ca 55%, #6366f1 100%)',
            boxShadow: '0 6px 0 #1e1b4b',
          }}
        >
          {/* Decorative blobs */}
          <div aria-hidden="true" className="pointer-events-none absolute top-0 right-0 overflow-hidden w-56 h-56 opacity-[0.18]">
            <div className="absolute -top-8 -right-8 w-48 h-48 rounded-full border-[16px] border-white" />
            <div className="absolute top-12 right-2 w-24 h-24 rounded-full border-[10px] border-white" />
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-8 -left-8 w-36 h-36 rounded-full opacity-[0.1]"
            style={{ background: 'white' }} />

          <div className="relative z-10">
            {greetingSentences.length > 0 ? (
              <>
                {/* AI Coach label */}
                <div className="flex items-center gap-2 mb-5">
                  <span
                    className="inline-flex items-center justify-center rounded-xl"
                    style={{ width: 30, height: 30, background: 'rgba(255,255,255,0.2)', color: '#fff' }}
                  >
                    <Sparkles size={15} strokeWidth={2.5} />
                  </span>
                  <p className="text-xs font-extrabold uppercase tracking-[0.14em]" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    AI Coach says…
                  </p>
                </div>

                <h2
                  className="text-3xl sm:text-4xl font-extrabold mb-6 leading-tight"
                  style={{ color: '#ffffff', letterSpacing: '-0.01em' }}
                >
                  {greetingSentences.join(' ')}
                </h2>

                {status === 'ready' && (
                  <div className="flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.75)' }}>
                    <Waves size={17} strokeWidth={2.5} className="shrink-0" />
                    <p className="text-base font-bold">Hold the mic below to reply.</p>
                  </div>
                )}
              </>
            ) : status === 'greeting' ? (
              <>
                {/* Loading state */}
                <div className="flex items-center gap-3 mb-5">
                  <span
                    className="inline-flex items-center justify-center rounded-xl"
                    style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.2)', color: '#fff' }}
                  >
                    <Mic2 size={18} strokeWidth={2.5} />
                  </span>
                  <div className="flex gap-1.5 items-center">
                    <div className="w-2 h-2 rounded-full bg-white animate-bounce" style={{ animationDelay: '0ms', opacity: 0.8 }} />
                    <div className="w-2 h-2 rounded-full bg-white animate-bounce" style={{ animationDelay: '150ms', opacity: 0.8 }} />
                    <div className="w-2 h-2 rounded-full bg-white animate-bounce" style={{ animationDelay: '300ms', opacity: 0.8 }} />
                  </div>
                </div>
                <h2 className="text-3xl sm:text-4xl font-extrabold mb-3" style={{ color: '#fff', letterSpacing: '-0.01em' }}>
                  Hold on…
                </h2>
                <p className="text-lg font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  Your AI coach is getting ready.
                </p>
              </>
            ) : (
              <>
                {/* Default idle state */}
                <div className="flex items-center gap-2 mb-5">
                  <span
                    className="inline-flex items-center justify-center rounded-xl"
                    style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.2)', color: '#fff' }}
                  >
                    <Sparkles size={18} strokeWidth={2.5} />
                  </span>
                  <span
                    className="text-xs font-extrabold uppercase tracking-widest px-3 py-1 rounded-full"
                    style={{ background: 'rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.9)' }}
                  >
                    Let&apos;s go!
                  </span>
                </div>

                <h2
                  className="text-3xl sm:text-4xl font-extrabold mb-3 leading-tight"
                  style={{ color: '#ffffff', letterSpacing: '-0.01em' }}
                >
                  Ready to practice?
                </h2>
                <p className="text-lg font-medium mb-8" style={{ color: 'rgba(255,255,255,0.72)' }}>
                  Start a conversation with your AI coach.
                </p>

                {/* Lip-press Start Session button */}
                <button
                  onClick={onStartSession}
                  onMouseEnter={() => setStartHovered(true)}
                  onMouseDown={() => { setStartHovered(false); setStartPressed(true); }}
                  onMouseUp={() => setStartPressed(false)}
                  onMouseLeave={() => { setStartHovered(false); setStartPressed(false); }}
                  onTouchStart={() => setStartPressed(true)}
                  onTouchEnd={() => { setStartPressed(false); onStartSession(); }}
                  className="inline-flex items-center gap-3 text-lg font-extrabold select-none"
                  style={{
                    fontFamily: 'Lexend, sans-serif',
                    padding: '14px 32px',
                    borderRadius: '16px',
                    background: startHovered ? '#67dd0d' : '#58cc02',
                    color: '#1e5000',
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: startPressed
                      ? '0 1px 0 #1f5100'
                      : startHovered
                      ? '0 7px 0 #1f5100'
                      : '0 5px 0 #1f5100',
                    transform: startPressed
                      ? 'translateY(4px)'
                      : startHovered
                      ? 'translateY(-2px)'
                      : 'translateY(0)',
                    transition: 'transform 100ms ease, box-shadow 100ms ease, background 120ms ease',
                  }}
                >
                  <Mic2 size={22} strokeWidth={2.5} />
                  Start Session
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MicButtonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function StatusBadge({ status, reviewMode, isLimitReached }: { status: string; reviewMode?: boolean; isLimitReached?: boolean }) {
  if (reviewMode) return null;
  const configs: Record<string, { label: string; bg: string; color: string; dot?: string }> = {
    idle:       { label: 'Starting…',        bg: '#eeeeee', color: '#6f7b64' },
    greeting:   { label: 'AI Speaking',      bg: '#c8e6ff', color: '#004666', dot: '#006590' },
    ready:      { label: 'Ready',            bg: '#58cc02', color: '#1e5000', dot: '#1f5100' },
    recording:  { label: 'Listening…',      bg: '#ffdad6', color: '#93000a', dot: '#ba1a1a' },
    processing: { label: 'Thinking…',       bg: '#ffdcbf', color: '#683a00', dot: '#8c5000' },
    error:      { label: 'Error — try again', bg: '#ffdad6', color: '#93000a' },
    limit:      { label: 'Limit reached',    bg: '#ffdad6', color: '#93000a' },
  };
  const activeStatus = isLimitReached ? 'limit' : status;
  const cfg = configs[activeStatus] ?? { label: activeStatus, bg: '#eeeeee', color: '#6f7b64' };
  return (
    <span
      className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold"
      style={{ background: cfg.bg, color: cfg.color, fontFamily: 'Lexend, sans-serif' }}
    >
      {cfg.dot && <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: cfg.dot }} />}
      {cfg.label}
    </span>
  );
}
