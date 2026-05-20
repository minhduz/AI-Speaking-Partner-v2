'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Clock3, X, Mic2, Sparkles, Waves, BarChart3 } from 'lucide-react';
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { MessageInput } from '@/components/chat/message-input/message-input';
import { DictionaryPopup } from '@/components/chat/dictionary-popup/dictionary-popup';
import { MissionCard } from '@/components/chat/mission-card/mission-card';
import { OnboardingPanel } from '@/components/chat/onboarding-panel/onboarding-panel';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/hooks/use-auth';
import { useChat } from '@/hooks/use-chat';
import { useDictionary } from '@/hooks/use-dictionary';
import type { ChatMessage, SessionSummary } from '@/types/session.types';
import { sessionService, type DeckCard, type ExerciseDeck, type SessionEvaluation } from '@/services/session.service';

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
    reviewEvaluation,
    isOnboardingSession,
    onboardingState,
    isEnding,
    closingText,
    endChoices,
    evaluation,
    evaluationLoading,
    viewEvaluation,
    exitSession,
    sessionStarted,
    currentDeck,
    lighterMode,
    advanceDeckCard,
    skipDeckCard,
    acceptDeckChallenge,
    rejectDeckChallenge,
    chooseDeckFreeTalk,
    chooseDeckEnd,
    enterLighterMode,
    completeLighterDeck,
    startMic,
    stopMic,
    endSession,
    startNewSession,
    enterReview,
    exitReview,
    loadMoreReview,
  } = useChat(urlSessionId);

  // Local UI state: confirm dialog before ending
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySessions, setHistorySessions] = useState<SessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reviewTitle, setReviewTitle] = useState<string | null>(null);
  const [initialMicHold, setInitialMicHold] = useState(false);
  // Mobile-only breakdown sheet — the side aside is hidden below md.
  const [mobileBreakdownOpen, setMobileBreakdownOpen] = useState(false);
  useEffect(() => {
    if (!reviewMode) setMobileBreakdownOpen(false);
  }, [reviewMode]);

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
    setReviewTitle(session.title ?? 'New conversation');
    enterReview(session.id);
  }, [enterReview]);

  const openHistory = useCallback(async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const data = await sessionService.list(1, 25);
      setHistorySessions(data.items);
    } catch (err) {
      console.error('[mobile history]', err);
      setHistorySessions([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const handleStartMic = useCallback(() => {
    if (!sessionStarted && status === 'ready') {
      setInitialMicHold(true);
    }
    startMic();
  }, [sessionStarted, startMic, status]);

  const handleStopMic = useCallback(() => {
    setInitialMicHold(false);
    stopMic();
  }, [stopMic]);

  // Sidebar highlights: reviewed session takes priority over live session
  const activeSidebarSessionId = reviewSessionId ?? currentSessionId;
  const activeReviewTitle =
    reviewSessionId && sessionTitleUpdate?.sessionId === reviewSessionId
      ? sessionTitleUpdate.title
      : reviewTitle;

  // Layout switches to focused (no sidebar) only when the user has tapped mic at
  // least once — not when the session is eagerly created in the background.
  const isFocusedLiveSession = !reviewMode && sessionStarted && !initialMicHold;

  // The not_started deck card is revealed only after the AI has delivered a
  // transition sentence (session 1: MINI_CHALLENGE, session 2+: soft challenge offer).
  // We detect this by scanning the last AI message for known transition keywords.
  // Once in_progress (user accepted), always show regardless.
  const TRANSITION_KEYWORDS = ['real practice', 'quick practice', 'short exercise', "let's try", "ready for a quick", "i've got a short"];
  const lastAiText = [...messages].reverse().find((m) => m.role === 'ai')?.text?.toLowerCase() ?? '';
  const aiHasTransitioned = TRANSITION_KEYWORDS.some((kw) => lastAiText.includes(kw));

  const onboardingDeckReady =
    currentDeck?.status === 'in_progress' ||
    aiHasTransitioned;

  const deckVisible =
    currentDeck !== null &&
    onboardingDeckReady &&
    (currentDeck.status === 'not_started' || currentDeck.status === 'in_progress') &&
    currentDeck.cards.length > 0;

  // ── CLOSING_MODE overlay ────────────────────────────────────────────────────
  // Three phases: (1) farewell playing, (2) choices [View breakdown]/[Exit],
  // (3) the evaluation board. Blocks all interaction until the user exits.
  if (isEnding) {
    // Phase 3 — evaluation board
    if (evaluation) {
      return <EvaluationBoard evaluation={evaluation} onExit={exitSession} />;
    }

    return (
      <main className="flex flex-1 flex-col items-center justify-center bg-[#f9f9f9] px-5 py-8 text-center" style={{ fontFamily: 'Lexend, sans-serif' }}>
        <div className="w-full max-w-[420px] rounded-[28px] bg-white px-5 py-6 sm:px-7 sm:py-7" style={{ border: '2px solid #e2e2e2', boxShadow: '0 5px 0 #e2e2e2' }}>
          <div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: '#f0e8ff', border: '2px solid #e0d0ff', boxShadow: '0 4px 0 #e0d0ff' }}
          >
            {closingText ? (
              <Sparkles size={28} strokeWidth={3} style={{ color: '#8447FF' }} />
            ) : (
              <div className="h-7 w-7 rounded-full border-[3px] border-[#8447FF] border-t-transparent animate-spin" />
            )}
          </div>
          <div>
            <p className="mt-5 text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#8447FF' }}>
              Session ending
            </p>
            {closingText ? (
              <p className="mx-auto mt-3 max-w-[320px] text-base font-bold leading-relaxed" style={{ color: '#1a1c1c' }}>
                {closingText}
              </p>
            ) : (
              <p className="mt-3 text-sm font-bold animate-pulse" style={{ color: '#6f7b64' }}>
                Preparing your recap…
              </p>
            )}
          </div>

          {/* Phase 2 — choices, shown once the farewell finished playing */}
          {endChoices && (
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={exitSession}
                className="vp-btn-ghost h-12 px-5 text-sm"
                style={{ borderRadius: '16px', color: '#6f7b64' }}
              >
                Exit
              </button>
              <button
                type="button"
                onClick={() => void viewEvaluation()}
                disabled={evaluationLoading}
                className="vp-btn-primary h-12 px-5 text-sm disabled:opacity-60"
                style={{ borderRadius: '16px' }}
              >
                {evaluationLoading ? 'Loading…' : 'View breakdown'}
              </button>
            </div>
          )}
        </div>
      </main>
    );
  }

  // ── Confirm dialog ──────────────────────────────────────────────────────────
  // Shown when user clicks the End button before the closing flow starts.
  if (confirmEnd) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center bg-[#f9f9f9] px-5 py-8 text-center" style={{ fontFamily: 'Lexend, sans-serif' }}>
        <div className="w-full max-w-[420px] rounded-[28px] bg-white px-5 py-6 sm:px-7 sm:py-7" style={{ border: '2px solid #e2e2e2', boxShadow: '0 5px 0 #e2e2e2' }}>
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-[0px]"
          style={{ background: '#fff0f0', color: '#ba1a1a', border: '2px solid #ffd7d5', boxShadow: '0 4px 0 #ffd7d5' }}
        >
          <X size={28} strokeWidth={3} />
          🛑
        </div>
        <div>
          <p className="mt-5 text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#ba1a1a' }}>End session</p>
          <h2 className="mt-2 text-2xl font-black leading-tight" style={{ color: '#1a1c1c' }}>Wrap up this practice?</h2>
          <p className="mx-auto mt-3 max-w-[310px] text-sm font-bold leading-relaxed" style={{ color: '#6f7b64' }}>
            Your AI coach will prepare a short recap before you leave.
          </p>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setConfirmEnd(false)}
            className="vp-btn-ghost h-12 px-5 text-sm"
            style={{ borderRadius: '16px', color: '#6f7b64' }}
          >
            Keep talking
          </button>
          <button
            type="button"
            onClick={() => { setConfirmEnd(false); void endSession('user_clicked'); }}
            className="vp-btn-danger h-12 px-5 text-sm"
            style={{ borderRadius: '16px' }}
          >
            End session
          </button>
        </div>
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
        {/* AI presence indicator — replaces the normal header.
            Symmetric side columns so the orb sits exactly on the horizontal center. */}
        <div
          className="shrink-0 grid grid-cols-[118px_1fr_118px] items-start px-4 pb-2"
          style={{ paddingTop: 'max(24px, env(safe-area-inset-top, 24px))' }}
        >
          <div />
          <AiPresence isRecording={isRecording} status={status} />
          <div className="flex justify-end">
            <EndSessionButton onClick={() => setConfirmEnd(true)} />
          </div>
        </div>

        {/* Exercise dock — compact floating card so it never takes over the chat.
            Centered horizontally so wider phones don't leave a lopsided gap on the right. */}
        {deckVisible && (
          <div className="pointer-events-none fixed left-1/2 -translate-x-1/2 top-24 z-30 w-[min(360px,calc(100vw-48px))]">
            <div className="pointer-events-auto">
              <DeckCardView
                key={`${currentDeck!.id}-${currentDeck!.current_card_index}-${currentDeck!.status}`}
                deck={currentDeck!}
                isLighter={lighterMode}
                isProcessing={status === 'processing'}
                onAccept={() => void acceptDeckChallenge()}
                onReject={() => void rejectDeckChallenge()}
                onFreeTalk={() => void chooseDeckFreeTalk()}
                onLighterMode={() => void enterLighterMode()}
                onEnd={() => void chooseDeckEnd()}
                onNext={() => lighterMode ? void completeLighterDeck() : void advanceDeckCard()}
                onSkip={() => void skipDeckCard()}
              />
            </div>
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
          onStartMic={handleStartMic}
          onStopMic={handleStopMic}
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
        className="flex flex-1 flex-col overflow-hidden pb-[72px] lg:pb-0"
        style={{ background: '#f9f9f9' }}
      >
        <PageHeader
          title={reviewMode ? (activeReviewTitle ?? 'History') : 'Learn'}
          onBack={reviewMode ? () => {
            setReviewTitle(null);
            exitReview();
          } : undefined}
          rightSlot={(
            <div className="flex items-center gap-2 sm:gap-3">
              <StatusBadge status={status} reviewMode={reviewMode} isLimitReached={isLimitReached} />
              {!reviewMode && sessionStarted && (
                <EndSessionButton onClick={() => setConfirmEnd(true)} />
              )}
            </div>
          )}
        />
        {/* ── Content row: transcript scroller (+ breakdown panel in History) ── */}
        <div className="flex flex-1 overflow-hidden">
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
              onStartSession={handleStartMic}
              onOpenHistory={openHistory}
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

        {/* ── Breakdown panel — History only (md+ side rail) ── */}
        {reviewMode && (
          <aside
            className="hidden md:block w-[420px] xl:w-[460px] shrink-0 overflow-y-auto border-l px-5 py-6"
            style={{ borderColor: '#ececec', background: '#ffffff' }}
          >
            {reviewEvaluation ? (
              <EvaluationContent evaluation={reviewEvaluation} compact />
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <p className="text-sm font-medium" style={{ color: '#afafaf', fontFamily: 'Lexend, sans-serif' }}>
                  No breakdown available for this session.
                </p>
              </div>
            )}
          </aside>
        )}
        </div>

        {/* ── Mobile breakdown trigger (FAB) ── */}
        {/* Wrap in md:hidden div because .vp-btn-primary sets display:inline-flex */}
        {/* which beats Tailwind's md:hidden on the button itself. */}
        {reviewMode && (
          <div className="md:hidden">
            <button
              type="button"
              onClick={() => setMobileBreakdownOpen(true)}
              className="vp-btn-primary fixed right-4 z-40 gap-2 text-sm"
              style={{
                // Bottom nav is ~72px tall + safe-area padding; add a 24px breathing gap.
                bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
                padding: '12px 18px',
                borderRadius: '999px',
                boxShadow: '0 4px 0 #1f5100, 0 6px 16px rgba(0,0,0,0.18)',
              }}
              aria-label="View breakdown"
            >
              <BarChart3 size={18} strokeWidth={3} />
              View breakdown
            </button>
          </div>
        )}

        {/* ── Mobile breakdown sheet (z-[60] to sit above the lg:hidden bottom nav at z-50) ── */}
        {reviewMode && mobileBreakdownOpen && (
          <div
            className="md:hidden fixed inset-0 z-60 flex flex-col"
            style={{ background: 'rgba(0,0,0,0.45)' }}
            onClick={() => setMobileBreakdownOpen(false)}
          >
            <div
              className="mt-auto flex flex-col rounded-t-[28px] bg-white"
              style={{
                maxHeight: '92vh',
                border: '2px solid #e2e2e2',
                borderBottom: 'none',
                fontFamily: 'Lexend, sans-serif',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-xl"
                    style={{ background: '#e9ffd5', border: '2px solid #d7ffb8' }}
                  >
                    <BarChart3 size={18} strokeWidth={3} style={{ color: '#2b6c00' }} />
                  </span>
                  <p className="text-base font-black" style={{ color: '#1a1c1c' }}>Breakdown</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileBreakdownOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full"
                  style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}
                  aria-label="Close breakdown"
                >
                  <X size={18} strokeWidth={3} style={{ color: '#6f7b64' }} />
                </button>
              </div>
              <div
                className="overflow-y-auto px-4 pb-6"
                style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
              >
                {reviewEvaluation ? (
                  <EvaluationContent evaluation={reviewEvaluation} compact />
                ) : (
                  <div className="flex h-40 items-center justify-center text-center">
                    <p className="text-sm font-medium" style={{ color: '#afafaf' }}>
                      No breakdown available for this session.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Waveform */}
        {!reviewMode && isRecording && (
          <div className="flex justify-center py-2">
            <Waveform isRecording={isRecording} analyser={analyser} />
          </div>
        )}

        <MessageInput
          onSendText={() => {}}
          onStartMic={handleStartMic}
          onStopMic={handleStopMic}
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
      <HistorySheet
        open={historyOpen}
        sessions={historySessions}
        loading={historyLoading}
        activeSessionId={activeSidebarSessionId}
        onClose={() => setHistoryOpen(false)}
        onNewChat={() => {
          setHistoryOpen(false);
          setReviewTitle(null);
          startNewSession();
        }}
        onSelect={(session) => {
          setHistoryOpen(false);
          handleSessionClick(session);
        }}
      />
    </>
  );
}

function HistorySheet({
  open,
  sessions,
  loading,
  activeSessionId,
  onClose,
  onNewChat,
  onSelect,
}: {
  open: boolean;
  sessions: SessionSummary[];
  loading: boolean;
  activeSessionId: string | null;
  onClose: () => void;
  onNewChat: () => void;
  onSelect: (session: SessionSummary) => void;
}) {
  if (!open) return null;

  const groups = groupHistoryByDate(sessions);

  return (
    <div className="fixed inset-0 z-[70] lg:hidden" style={{ fontFamily: 'Lexend, sans-serif' }}>
      <button
        type="button"
        aria-label="Close history"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      <section
        className="absolute inset-x-0 bottom-0 max-h-[86dvh] overflow-hidden rounded-t-[28px]"
        style={{
          background: '#ffffff',
          border: '2px solid #e2e2e2',
          boxShadow: '0 -4px 0 #e2e2e2, 0 -18px 45px rgba(0,0,0,0.14)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: '2px solid #f3f3f3' }}>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#becbb1' }}>Sessions</p>
            <h2 className="text-xl font-black" style={{ color: '#1a1c1c' }}>History</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history"
            className="flex h-10 w-10 items-center justify-center rounded-2xl active:scale-95"
            style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 3px 0 #e2e2e2', color: '#6f7b64' }}
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>

        <div className="max-h-[calc(86dvh-82px)] overflow-y-auto px-5 py-4">
          <button
            type="button"
            onClick={onNewChat}
            className="mb-4 h-12 w-full rounded-2xl text-sm font-black active:translate-y-1"
            style={{ background: '#58cc02', color: '#1e5000', boxShadow: '0 4px 0 #46a302' }}
          >
            New chat
          </button>

          {loading ? (
            <div className="flex justify-center py-10">
              <div className="h-7 w-7 rounded-full border-4 border-[#58cc02]/25 border-t-[#58cc02] animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex min-h-[220px] items-center justify-center rounded-3xl text-center" style={{ background: '#f9f9f9', border: '2px dashed #e2e2e2' }}>
              <p className="text-sm font-bold" style={{ color: '#becbb1' }}>Your sessions will appear here.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#becbb1' }}>
                    {group.label}
                  </p>
                  <div className="grid gap-2">
                    {group.items.map((session) => {
                      const active = session.id === activeSessionId;
                      return (
                        <button
                          key={session.id}
                          type="button"
                          onClick={() => onSelect(session)}
                          className="w-full rounded-2xl px-4 py-3 text-left active:translate-y-0.5"
                          style={active
                            ? { background: '#d7ffb8', border: '2px solid #58cc02', boxShadow: '0 3px 0 #46a302' }
                            : { background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 3px 0 #e2e2e2' }}
                        >
                          <span className="block truncate text-sm font-black" style={{ color: active ? '#1e5000' : '#1a1c1c' }}>
                            {session.title ?? 'New conversation'}
                          </span>
                          <span className="mt-1 block text-[11px] font-bold" style={{ color: active ? '#2b6c00' : '#6f7b64' }}>
                            {new Date(session.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function groupHistoryByDate(sessions: SessionSummary[]): { label: string; items: SessionSummary[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const groups = [
    { label: 'Today', items: [] as SessionSummary[] },
    { label: 'Yesterday', items: [] as SessionSummary[] },
    { label: 'Older', items: [] as SessionSummary[] },
  ];
  for (const session of sessions) {
    const d = new Date(session.startedAt);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (day >= today) groups[0].items.push(session);
    else if (day >= yesterday) groups[1].items.push(session);
    else groups[2].items.push(session);
  }
  return groups.filter((group) => group.items.length > 0);
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
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-bold select-none"
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

// Hand-built SVG radar chart so we don't pull in a chart library.
// Maps skill levels (Strong=3, Okay=2, Needs work=1) onto an N-axis polygon.
function SkillRadarChart({ skills, compact = false }: { skills: { skill: string; level: string }[]; compact?: boolean }) {
  if (skills.length < 3) return null;
  const size = compact ? 280 : 340;
  const cx = size / 2;
  const cy = size / 2;
  const R = compact ? 84 : 108;
  const labelFont = compact ? 10 : 11;
  const labelGap = compact ? 18 : 24;
  const N = skills.length;
  const value = (l: string) => (l === 'Strong' ? 3 : l === 'Okay' ? 2 : 1);
  const pointAt = (i: number, r: number) => {
    const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
  };
  const skillPts = skills.map((s, i) => pointAt(i, (R * value(s.level)) / 3));

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[340px]">
      {[1, 2, 3].map((lvl) => {
        const pts = Array.from({ length: N }, (_, i) => pointAt(i, (R * lvl) / 3));
        return (
          <polygon
            key={lvl}
            points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
            fill={lvl === 3 ? '#f9f9f9' : 'none'}
            stroke="#e2e2e2"
            strokeWidth={1.5}
          />
        );
      })}
      {skills.map((_, i) => {
        const [x, y] = pointAt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e2e2e2" strokeWidth={1.5} />;
      })}
      <polygon
        points={skillPts.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="#58cc02"
        fillOpacity={0.28}
        stroke="#2b6c00"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      {skillPts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={5} fill="#58cc02" stroke="#2b6c00" strokeWidth={2} />
      ))}
      {skills.map((s, i) => {
        const [x, y] = pointAt(i, R + labelGap);
        const cos = Math.cos((i / N) * Math.PI * 2 - Math.PI / 2);
        const anchor = Math.abs(cos) < 0.25 ? 'middle' : cos > 0 ? 'start' : 'end';
        return (
          <text
            key={s.skill}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            style={{ fill: '#1a1c1c', fontSize: labelFont, fontWeight: 800, fontFamily: 'Lexend, sans-serif' }}
          >
            {s.skill}
          </text>
        );
      })}
    </svg>
  );
}

// Circular completion ring used in the exercises card.
function CompletionRing({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const r = 38;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-[96px] w-[96px] shrink-0">
      <svg viewBox="0 0 96 96" className="h-full w-full -rotate-90">
        <circle cx={48} cy={48} r={r} fill="none" stroke="#e2e2e2" strokeWidth={9} />
        <circle
          cx={48}
          cy={48}
          r={r}
          fill="none"
          stroke="#58cc02"
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-base font-black leading-none" style={{ color: '#1a1c1c' }}>{done}/{total}</p>
        <p className="mt-0.5 text-[9px] font-extrabold uppercase tracking-wide" style={{ color: '#6f7b64' }}>Done</p>
      </div>
    </div>
  );
}

// Reusable breakdown body — used full-screen after a session (EvaluationBoard)
// and embedded in the History split view. `compact` collapses the dual-column
// layouts and shrinks typography so the same component fits a ~420px aside.
function EvaluationContent({ evaluation, compact = false }: { evaluation: SessionEvaluation; compact?: boolean }) {
  const s = evaluation.stats;
  const highlights = evaluation.highlights ?? [];
  const growthAreas = evaluation.growth_areas ?? [];
  const cards = evaluation.cards ?? [];
  const spokenSamples = evaluation.spoken_samples ?? [];
  const corrections = evaluation.corrections ?? [];
  const skillRadar = evaluation.skill_radar ?? [];
  const recurringPattern = evaluation.recurring_pattern;
  const nextDrill = evaluation.next_drill;
  const resultColor = (r: string | null) =>
    r === 'passed' ? '#2b6c00' : r === 'partial' ? '#683a00' : r === 'not_passed' ? '#9b1c1c' : '#6f7b64';
  const resultLabel = (r: string | null) =>
    r === 'passed' ? 'Passed' : r === 'partial' ? 'Partial' : r === 'not_passed' ? 'Needs work' : 'Skipped';
  const levelColor = (level: string) =>
    level === 'Strong' ? '#2b6c00' : level === 'Needs work' ? '#9b1c1c' : '#683a00';
  const levelDot = (level: string) =>
    level === 'Strong' ? '#58cc02' : level === 'Needs work' ? '#ff6b6b' : '#e8a200';

  const hasHighlights = highlights.length > 0;
  const hasGrowth = growthAreas.length > 0;
  const hasNextDrill = !!nextDrill;
  const hasNextFocus = !!evaluation.next_focus;
  const totalExercises = s.cards_total || cards.length;

  return (
    <div className="grid gap-5" style={{ fontFamily: 'Lexend, sans-serif' }}>
      {/* ── Hero: summary + stats ── */}
      <section className={`rounded-[28px] bg-white ${compact ? 'p-4' : 'p-5 sm:p-6'}`} style={{ border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
        <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#2b6c00' }}>Session breakdown</p>
        <p className={`mt-3 font-black leading-tight ${compact ? 'text-lg' : 'text-2xl sm:text-3xl'}`} style={{ color: '#1a1c1c' }}>{evaluation.summary}</p>
        <div className={`mt-5 grid grid-cols-3 ${compact ? 'gap-2' : 'gap-2 sm:gap-3'}`}>
          {[
            { label: 'Turns', value: String(s.user_turns) },
            { label: 'Exercises', value: s.cards_total ? `${s.cards_completed}/${s.cards_total}` : '-' },
            { label: 'Minutes', value: s.duration_minutes != null ? String(s.duration_minutes) : '-' },
          ].map((stat) => (
            <div key={stat.label} className={`rounded-2xl text-center ${compact ? 'px-1 py-2' : 'px-2 py-3'}`} style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}>
              <p className={`font-black ${compact ? 'text-lg' : 'text-2xl'}`} style={{ color: '#1a1c1c' }}>{stat.value}</p>
              <p className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: '#6f7b64' }}>{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Skill radar (SVG chart + per-skill evidence list) ── */}
      {skillRadar.length > 0 && (
        <section className={`rounded-[28px] bg-white ${compact ? 'p-4' : 'p-5 sm:p-6'}`} style={{ border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
          <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#2b6c00' }}>Skill radar</p>
          <div className={`mt-4 grid items-center gap-5 ${compact ? '' : 'lg:grid-cols-[minmax(280px,360px)_1fr]'}`}>
            <div className="flex justify-center">
              <SkillRadarChart skills={skillRadar} compact={compact} />
            </div>
            <div className="grid gap-2">
              {skillRadar.map((item) => (
                <div key={item.skill} className="rounded-2xl px-3 py-2.5" style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: levelDot(item.level) }} />
                      <p className="truncate text-sm font-black" style={{ color: '#1a1c1c' }}>{item.skill}</p>
                    </div>
                    <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-wide" style={{ color: levelColor(item.level) }}>
                      {item.level}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-semibold leading-snug" style={{ color: '#6f7b64' }}>{item.evidence}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── What went well / To work on (paired side-by-side when both exist) ── */}
      {(hasHighlights || hasGrowth) && (
        <div className={`grid gap-5 ${hasHighlights && hasGrowth && !compact ? 'md:grid-cols-2' : ''}`}>
          {hasHighlights && (
            <section className="rounded-[24px] bg-white p-4 sm:p-5" style={{ border: '2px solid #d7ffb8', boxShadow: '0 4px 0 #d7ffb8' }}>
              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#2b6c00' }}>What went well</p>
              <ul className="grid gap-1.5">
                {highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm font-semibold" style={{ color: '#3c3c3c' }}>
                    <span className="mt-0.5 shrink-0" style={{ color: '#58cc02' }}>✓</span>{h}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {hasGrowth && (
            <section className="rounded-[24px] bg-white p-4 sm:p-5" style={{ border: '2px solid #f1dfb8', boxShadow: '0 4px 0 #f1dfb8' }}>
              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#683a00' }}>To work on</p>
              <ul className="grid gap-1.5">
                {growthAreas.map((g, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm font-semibold" style={{ color: '#3c3c3c' }}>
                    <span className="mt-0.5 shrink-0" style={{ color: '#e8a200' }}>→</span>{g}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* ── Recurring pattern (attention card, full width) ── */}
      {recurringPattern && (
        <section className="rounded-[24px] p-4 sm:p-5" style={{ background: '#fff8e8', border: '2px solid #f1dfb8', boxShadow: '0 4px 0 #f1dfb8' }}>
          <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#683a00' }}>Recurring pattern</p>
          <p className="mt-1 text-base font-black leading-snug" style={{ color: '#1a1c1c' }}>{recurringPattern.title}</p>
          <p className="mt-1 text-xs font-semibold leading-snug" style={{ color: '#6f7b64' }}>{recurringPattern.evidence}</p>
          <p className="mt-2 text-xs font-bold leading-snug" style={{ color: '#683a00' }}>{recurringPattern.practice_tip}</p>
        </section>
      )}

      {/* ── Exercises with completion ring ── */}
      {cards.length > 0 && (
        <section className="rounded-[24px] bg-white p-4 sm:p-5" style={{ border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
          <div className="flex items-center gap-4">
            <CompletionRing done={s.cards_completed} total={totalExercises} />
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Exercises</p>
              <p className="mt-1 text-base font-black leading-snug" style={{ color: '#1a1c1c' }}>
                {s.cards_completed} of {totalExercises} completed
              </p>
              <p className="text-xs font-semibold leading-snug" style={{ color: '#6f7b64' }}>
                {s.cards_completed === 0 ? 'No drill finished this session.' : 'Keep stacking the streak.'}
              </p>
            </div>
          </div>
          <div className={`mt-4 grid gap-2 ${compact ? '' : 'sm:grid-cols-2'}`}>
            {cards.map((c, i) => (
              <div key={i} className="rounded-2xl px-3 py-2.5" style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-bold" style={{ color: '#1a1c1c' }}>{c.title}</p>
                  <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-wide" style={{ color: resultColor(c.result) }}>
                    {resultLabel(c.result)}
                  </span>
                </div>
                {c.feedback && <p className="mt-1 text-xs font-semibold leading-snug" style={{ color: '#6f7b64' }}>{c.feedback}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Corrections ── */}
      {corrections.length > 0 && (
        <section className="rounded-[24px] bg-white p-4 sm:p-5" style={{ border: '2px solid #c8e6ff', boxShadow: '0 4px 0 #c8e6ff' }}>
          <p className="mb-3 text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#0f6f8f' }}>Top corrections</p>
          <div className={`grid gap-2 ${compact ? '' : 'md:grid-cols-2'}`}>
            {corrections.map((c, i) => (
              <div key={i} className="rounded-2xl px-3 py-3" style={{ background: '#f8fbff', border: '2px solid #d8edf7' }}>
                <div className="grid gap-2">
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: '#6f7b64' }}>You said</p>
                    <p className="text-sm font-semibold leading-snug" style={{ color: '#3c3c3c' }}>&quot;{c.you_said}&quot;</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: '#2b6c00' }}>Try this</p>
                    <p className="text-sm font-black leading-snug" style={{ color: '#1a1c1c' }}>&quot;{c.try_this}&quot;</p>
                  </div>
                  <p className="text-xs font-semibold leading-snug" style={{ color: '#0f6f8f' }}>{c.why}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Things you said (full width, two-column grid of quotes) ── */}
      {spokenSamples.length > 0 && (
        <section className="rounded-[24px] bg-white p-4 sm:p-5" style={{ border: '2px solid #ebe0ff', boxShadow: '0 4px 0 #ebe0ff' }}>
          <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Things you said</p>
          <div className={`grid gap-1.5 ${compact ? '' : 'sm:grid-cols-2'}`}>
            {spokenSamples.map((q, i) => (
              <p key={i} className="rounded-2xl px-3 py-2 text-sm font-medium italic leading-snug" style={{ background: '#f4efff', color: '#3c3c3c' }}>
                “{q}”
              </p>
            ))}
          </div>
        </section>
      )}

      {/* ── Next drill / Next time (paired bottom CTA) ── */}
      {(hasNextDrill || hasNextFocus) && (
        <div className={`grid gap-5 ${hasNextDrill && hasNextFocus && !compact ? 'md:grid-cols-2' : ''}`}>
          {hasNextDrill && nextDrill && (
            <section className="rounded-[24px] bg-white p-4 sm:p-5" style={{ border: '2px solid #ebe0ff', boxShadow: '0 4px 0 #ebe0ff' }}>
              <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#8447ff' }}>Next drill</p>
              <p className="mt-1 text-base font-black leading-snug" style={{ color: '#1a1c1c' }}>{nextDrill.title}</p>
              <ul className="mt-2 grid gap-1.5">
                {nextDrill.steps.map((step, i) => (
                  <li key={i} className="text-xs font-semibold leading-snug" style={{ color: '#3c3c3c' }}>
                    {i + 1}. {step}
                  </li>
                ))}
              </ul>
              {nextDrill.success_criteria && (
                <p className="mt-2 text-xs font-bold leading-snug" style={{ color: '#8447ff' }}>{nextDrill.success_criteria}</p>
              )}
            </section>
          )}
          {hasNextFocus && (
            <section className="rounded-[24px] p-4 sm:p-5" style={{ background: '#f4efff', border: '2px solid #ebe0ff', boxShadow: '0 4px 0 #ebe0ff' }}>
              <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#8447ff' }}>Next time</p>
              <p className="mt-1 text-sm font-bold leading-snug" style={{ color: '#1a1c1c' }}>{evaluation.next_focus}</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function EvaluationBoard({ evaluation, onExit }: { evaluation: SessionEvaluation; onExit: () => void }) {
  return (
    <main className="flex flex-1 flex-col bg-[#f9f9f9]" style={{ fontFamily: 'Lexend, sans-serif' }}>
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-5xl">
          <EvaluationContent evaluation={evaluation} />
        </div>
      </div>

      <div className="shrink-0 border-t px-4 py-4 sm:px-6" style={{ background: '#ffffff', borderColor: '#e2e2e2' }}>
        <div className="mx-auto flex w-full max-w-5xl justify-end">
          <button
            type="button"
            onClick={onExit}
            className="vp-btn-primary h-12 w-full text-sm sm:w-[180px]"
            style={{ borderRadius: '16px' }}
          >
            Done
          </button>
        </div>
      </div>
    </main>
  );
}

function AiPresence({ isRecording, status }: { isRecording: boolean; status: string }) {
  const isThinking = status === 'processing' || status === 'greeting';
  const label = isRecording ? 'Listening' : isThinking ? 'Thinking' : 'AI Partner';
  const subLabel = isRecording ? 'I’m hearing you' : isThinking ? 'Preparing reply' : 'Ready to practice';

  return (
    <div className="justify-self-center flex items-center gap-3 rounded-[24px] px-3 py-2" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2', fontFamily: 'Lexend, sans-serif' }}>
      <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: isRecording ? '#ffe0e0' : '#d7ffb8', color: isRecording ? '#9b1c1c' : '#2b6c00', border: isRecording ? '2px solid #ffc6c6' : '2px solid #c8f2a4' }}>
        <span className="absolute inset-0 rounded-2xl animate-ping opacity-20" style={{ background: isRecording ? '#ff5c5c' : '#58cc02' }} />
        <span className="relative w-7 h-7 rounded-xl flex items-center justify-center" style={{ background: '#ffffff' }}>
          <Sparkles size={16} strokeWidth={2.8} />
        </span>
      </div>
      <div className="hidden sm:block min-w-[116px]">
        <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: isRecording ? '#9b1c1c' : '#2b6c00' }}>{label}</p>
        <p className="text-[11px] font-bold" style={{ color: '#6f7b64' }}>{subLabel}</p>
      </div>
      <div className="hidden sm:flex items-end gap-1 h-6 pl-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 rounded-full animate-pulse"
            style={{
              height: `${10 + i * 5}px`,
              background: isRecording ? '#ff5c5c' : i === 1 ? '#2fb8ff' : '#58cc02',
              animationDelay: `${i * 140}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// Splits a sentence into alternating word / non-word tokens so each word can be
// rendered as its own tap target. Words = letters/numbers/marks/apostrophes;
// everything else (spaces, punctuation) is a non-word chunk preserved as-is.
function tokenizeForTap(text: string): { token: string; isWord: boolean }[] {
  const matches = text.match(/[\p{L}\p{N}\p{M}']+|[^\p{L}\p{N}\p{M}']+/gu) ?? [];
  return matches.map((token) => ({ token, isWord: /[\p{L}\p{N}\p{M}]/u.test(token) }));
}

function TappableText({
  text,
  color,
  onTapWord,
}: {
  text: string;
  color: string;
  onTapWord: (word: string, e: React.MouseEvent) => void;
}) {
  return (
    <>
      {tokenizeForTap(text).map((t, j) =>
        t.isWord ? (
          <span
            key={j}
            onClick={(e) => onTapWord(t.token.replace(/^['’]+|['’]+$/g, ''), e)}
            className="cursor-pointer rounded-sm transition-colors hover:bg-[#fff5b0] active:bg-[#ffe680]"
            style={{ color, WebkitTapHighlightColor: 'transparent' }}
          >
            {t.token}
          </span>
        ) : (
          <span key={j} style={{ color }}>
            {t.token}
          </span>
        ),
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

  // Single tap on a word triggers the lookup — works on both desktop click and
  // mobile tap, and avoids the awkward double-tap-zoom issue on phones.
  const handleTapWord = useCallback((word: string, e: React.MouseEvent) => {
    if (word.length > 0) onWordDoubleClick(word, e);
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
  const userColor = '#afafaf';
  const aiColor = '#1a1c1c';

  return (
    <div className={`flex w-full ${isAi ? 'justify-start' : 'justify-end'} px-2 py-1`} style={{ fontFamily: 'Lexend, sans-serif' }}>
      <div
        className={`max-w-[85%] md:max-w-[75%] flex flex-col select-text ${isAi ? 'items-start' : 'items-end'}`}
      >
        {showThinkingDots ? (
          <ThinkingDots />
        ) : isAi && aiSentences ? (
          <div className="flex flex-col gap-1.5">
            {aiSentences.map((s, i) => (
              <p key={i} className="text-xl md:text-2xl font-black leading-relaxed tracking-tight">
                <TappableText text={s} color={aiColor} onTapWord={handleTapWord} />
              </p>
            ))}
          </div>
        ) : message.pending ? (
          <p className="text-xl md:text-2xl font-black leading-relaxed tracking-tight">
            <TappableText text={message.text || '…'} color={userColor} onTapWord={handleTapWord} />
          </p>
        ) : (
          <p className="text-xl md:text-2xl font-black leading-relaxed tracking-tight">
            <TappableText text={message.text} color={isAi ? aiColor : userColor} onTapWord={handleTapWord} />
          </p>
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
  isProcessing,
  onAccept,
  onReject,
  onFreeTalk,
  onLighterMode,
  onEnd,
  onNext,
  onSkip,
}: {
  deck: ExerciseDeck;
  isLighter: boolean;
  isProcessing: boolean;
  onAccept: () => void;
  onReject: () => void;
  onFreeTalk: () => void;
  onLighterMode: () => void;
  onEnd: () => void;
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
    <div className="w-full rounded-[28px] p-4 flex flex-col gap-3" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2', fontFamily: 'Lexend, sans-serif' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>{cardLabel}</p>
          {isContinuation && deck.status === 'not_started' && (
            <p className="mt-1 text-[11px] font-bold" style={{ color: '#8447ff' }}>↩ Picking up from last session</p>
          )}
        </div>
        <span className="px-2 py-1 rounded-full text-[10px] font-extrabold shrink-0" style={{ background: isLighter ? '#dceeff' : '#d7ffb8', color: isLighter ? '#004666' : '#2b6c00' }}>
          {isLighter ? 'Quick' : 'Practice'}
        </span>
      </div>

      {!isLighter && (
        <div className="rounded-2xl px-3 py-2" style={{ background: '#f4efff', border: '2px solid #ebe0ff' }}>
          <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#8447ff' }}>Mission</p>
          <p className="mt-1 text-xs font-bold leading-snug" style={{ color: '#1a1c1c' }}>{deck.mission}</p>
          {deck.reason && <p className="mt-1 text-[11px] font-semibold leading-snug" style={{ color: '#6f7b64' }}>{deck.reason}</p>}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-black leading-snug" style={{ color: '#1a1c1c' }}>{card.title}</h2>
        <p className="text-sm font-semibold leading-relaxed" style={{ color: '#6f7b64' }}>{card.task}</p>

        {!isLighter && Array.isArray(card.success_criteria) && card.success_criteria.length > 0 && (
          <ul className="grid gap-1 mt-1">
            {card.success_criteria.slice(0, 2).map((criterion, i) => (
              <li key={i} className="flex items-start gap-2 text-xs font-semibold" style={{ color: '#6f7b64' }}>
                <span className="mt-0.5 shrink-0" style={{ color: '#58cc02' }}>✓</span>
                {criterion}
              </li>
            ))}
          </ul>
        )}

        {card.result && card.feedback && (
          <p
            className="text-xs font-bold italic mt-1 leading-snug"
            style={{ color: card.result === 'passed' ? '#2b6c00' : card.result === 'partial' ? '#683a00' : '#9b1c1c' }}
          >
            {card.feedback}
          </p>
        )}
      </div>

      {deck.status === 'not_started' && !showRejectOptions && (
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            onClick={onAccept}
            className="vp-btn-primary h-11 px-4 text-xs"
            style={{ borderRadius: '14px' }}
          >
            {acceptLabel}
          </button>
          <button
            type="button"
            onClick={isOnboarding ? onReject : () => setShowRejectOptions(true)}
            className="vp-btn-ghost h-11 px-4 text-xs"
            style={{ borderRadius: '14px', color: '#6f7b64' }}
          >
            {isOnboarding ? 'Maybe later' : 'Not today'}
          </button>
        </div>
      )}

      {!isOnboarding && deck.status === 'not_started' && showRejectOptions && (
        <div className="grid gap-2 pt-1">
          <p className="text-[11px] font-bold text-center" style={{ color: '#6f7b64' }}>What would you prefer?</p>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={onFreeTalk} className="h-10 rounded-xl px-2 text-[11px] font-extrabold transition active:translate-y-0.5" style={{ background: '#ffffff', color: '#6f7b64', border: '2px solid #e2e2e2', boxShadow: '0 3px 0 #e2e2e2' }}>Free talk</button>
            <button type="button" onClick={onLighterMode} className="h-10 rounded-xl px-2 text-[11px] font-extrabold transition active:translate-y-0.5" style={{ background: '#f4efff', color: '#8447ff', border: '2px solid #ebe0ff', boxShadow: '0 3px 0 #ebe0ff' }}>Quick</button>
            <button type="button" onClick={onEnd} className="h-10 rounded-xl px-2 text-[11px] font-extrabold transition active:translate-y-0.5" style={{ background: '#fff0f0', color: '#ba1a1a', border: '2px solid #ffd7d5', boxShadow: '0 3px 0 #ffd7d5' }}>End</button>
          </div>
        </div>
      )}

      {deck.status === 'in_progress' && (
        <DeckCardActions
          card={card}
          isLighter={isLighter}
          isOnboarding={isOnboarding}
          isProcessing={isProcessing}
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
  isProcessing,
  onNext,
  onSkip,
}: {
  card: DeckCard;
  isLighter: boolean;
  isOnboarding: boolean;
  isProcessing: boolean;
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
          disabled={isProcessing}
          className="h-9 px-4 rounded-full text-sm font-medium text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:pointer-events-none"
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
  onOpenHistory,
}: {
  status: string;
  greetingSentences: string[];
  onStartSession: () => void;
  onOpenHistory: () => void;
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
                <div className="flex items-center gap-2 mb-4">
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

                {/* Scrollable greeting text — caps height so long messages don't overflow */}
                <div className="overflow-y-auto mb-5" style={{ maxHeight: '38vh' }}>
                  <h2
                    className="text-xl sm:text-2xl font-extrabold leading-snug"
                    style={{ color: '#ffffff', letterSpacing: '-0.01em' }}
                  >
                    {greetingSentences.join(' ')}
                  </h2>
                </div>

                {status === 'ready' && (
                  <div className="flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.75)' }}>
                    <Waves size={17} strokeWidth={2.5} className="shrink-0" />
                    <p className="text-sm font-bold">Hold the mic below to reply.</p>
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
        <button
          type="button"
          onClick={onOpenHistory}
          className="mx-auto mt-10 hidden h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black active:translate-y-1 max-lg:flex"
          style={{
            background: '#ffffff',
            color: '#6f7b64',
            border: '2px solid #e2e2e2',
            boxShadow: '0 4px 0 #e2e2e2',
          }}
        >
          <Clock3 size={17} strokeWidth={2.5} />
          History
        </button>
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
    ready:      { label: 'Ready',            bg: '#ffffff', color: '#2b6c00', dot: '#58cc02' },
    recording:  { label: 'Listening…',      bg: '#ffdad6', color: '#93000a', dot: '#ba1a1a' },
    processing: { label: 'Thinking…',       bg: '#ffdcbf', color: '#683a00', dot: '#8c5000' },
    error:      { label: 'Error — try again', bg: '#ffdad6', color: '#93000a' },
    limit:      { label: 'Limit reached',    bg: '#ffdad6', color: '#93000a' },
  };
  const activeStatus = isLimitReached ? 'limit' : status;
  const cfg = configs[activeStatus] ?? { label: activeStatus, bg: '#eeeeee', color: '#6f7b64' };
  return (
    <span
      className="inline-flex h-10 items-center gap-2 rounded-2xl px-3 text-sm font-black"
      style={{
        background: cfg.bg,
        color: cfg.color,
        border: '2px solid #e2e2e2',
        boxShadow: '0 3px 0 #e2e2e2',
        fontFamily: 'Lexend, sans-serif',
      }}
    >
      {cfg.dot && <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: cfg.dot }} />}
      {cfg.label}
    </span>
  );
}
