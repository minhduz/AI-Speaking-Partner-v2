'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter } from 'next/navigation';
import { Clock3, X, Mic2, Sparkles, Waves, BarChart3 } from 'lucide-react';
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { MessageInput } from '@/components/chat/message-input/message-input';
import { DictionaryPopup } from '@/components/chat/dictionary-popup/dictionary-popup';
import { OnboardingPanel, hasOnboardingPanelContent } from '@/components/chat/onboarding-panel/onboarding-panel';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/hooks/use-auth';
import { useChat } from '@/hooks/use-chat';
import { useDictionary } from '@/hooks/use-dictionary';
import type { ChatMessage, SessionSummary } from '@/types/session.types';
import { sessionService, type DeckCard, type ExerciseDeck, type SessionEvaluation } from '@/services/session.service';
import {
  lessonService,
  type LessonAttemptResult,
  type AiReview,
  type TeacherReviewView,
  type TeacherReviewFeedback,
} from '@/services/lesson.service';
import { LessonToolbox, LessonToolboxTrigger } from '@/components/chat/lesson-toolbox/lesson-toolbox';
import type { LessonToolboxContext } from '@/components/chat/lesson-toolbox/lesson-toolbox';
import { httpClient } from '@/lib/http-client';

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
  // Curriculum-first: a freshly minted lesson session is passed via
  // ?liveSessionId=... so we know to bootstrap it live (not as a review).
  const liveSessionIdFromUrl = searchParams.get('liveSessionId') ?? undefined;
  // Free Talk CTA from Home appends ?mode=free_talk so the hook actually
  // requests free_talk instead of inheriting the last guided mode from storage.
  const urlModeOverride = searchParams.get('mode');
  const requestedModeOverride =
    urlModeOverride === 'free_talk' || urlModeOverride === 'guided_learning'
      ? (urlModeOverride as 'free_talk' | 'guided_learning')
      : undefined;

  const { handleLogout } = useAuth();
  const {
    messages,
    status,
    isSpeaking,
    greetingSentences,
    isRecording,
    analyser,
    errorMessage,
    currentSessionId,
    sessionTitleUpdate,
    reviewMode,
    reviewSessionId,
    reviewHasMore,
    reviewLoading,
    reviewEvaluation,
    isOnboardingSession,
    onboardingState,
    nextSessionMode,
    modeSelectionLocked,
    setNextSessionMode,
    activeSessionMode,
    isEnding,
    closingText,
    endChoices,
    evaluation,
    evaluationLoading,
    endedLessonAttemptId,
    viewEvaluation,
    exitSession,
    sessionStarted,
    currentDeck,
    lighterMode,
    isAdvancingDeck,
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
  } = useChat(urlSessionId, liveSessionIdFromUrl, requestedModeOverride);

  // Local UI state: confirm dialog before ending
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySessions, setHistorySessions] = useState<SessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reviewTitle, setReviewTitle] = useState<string | null>(null);
  const [reviewSessionMode, setReviewSessionMode] = useState<SessionSummary['mode'] | null>(null);
  const [initialMicHold, setInitialMicHold] = useState(false);
  // Mobile-only breakdown sheet — the side aside is hidden below md.
  const [mobileBreakdownOpen, setMobileBreakdownOpen] = useState(false);
  // Lesson toolbox
  const [toolboxOpen, setToolboxOpen] = useState(false);
  useEffect(() => {
    if (reviewMode) return;
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      setMobileBreakdownOpen(false);
      setReviewSessionMode(null);
    });
    return () => { cancelled = true; };
  }, [reviewMode]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollHeightBeforeRef = useRef(0);
  const prevSessionId = useRef<string | null>(null);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);

  const wordDictionary = useDictionary();
  const [dictAnchor, setDictAnchor] = useState<{ top: number; left: number } | null>(null);

  const handleToolboxAddFlashcard = useCallback(async (word: string, meaning: string, example: string, pronunciation?: string) => {
    void meaning; void pronunciation;
    const result = await httpClient.get<{ cacheId?: string }>(`/api/dictionary?word=${encodeURIComponent(word)}&context=${encodeURIComponent(example)}&targetLang=vi`);
    if (result?.cacheId) {
      await wordDictionary.addFlashcard(result.cacheId);
    }
  }, [wordDictionary]);

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
  const isLimitReached = false;
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
    setReviewSessionMode(session.mode ?? null);
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
  const reviewPanelIsFreeTalk = reviewEvaluation?.mode === 'free_talk' || reviewSessionMode === 'free_talk';
  const reviewPanelLabel = reviewPanelIsFreeTalk ? 'recap' : 'breakdown';

  // Layout switches to focused (no sidebar) only when the user has tapped mic at
  // least once — not when the session is eagerly created in the background.
  const isFocusedLiveSession = !reviewMode && sessionStarted && !initialMicHold;

  // The not_started deck card is normally revealed only after the AI has
  // delivered a soft transition sentence ("quick practice"...). That gate
  // belongs to the legacy "optional challenge" flow — a Lesson is NOT
  // optional, so for lesson_runtime decks we show the card immediately.
  // Once in_progress (user accepted), always show regardless.
  const TRANSITION_KEYWORDS = ['real practice', 'quick practice', 'short exercise', "let's try", "ready for a quick", "i've got a short"];
  const lastAiText = [...messages].reverse().find((m) => m.role === 'ai')?.text?.toLowerCase() ?? '';
  const aiHasTransitioned = TRANSITION_KEYWORDS.some((kw) => lastAiText.includes(kw));
  const isLessonDeck = currentDeck?.session_type === 'lesson_runtime' || !!currentDeck?.lesson_attempt_id;
  const isLiveLessonSession =
    !reviewMode &&
    sessionStarted &&
    activeSessionMode !== 'free_talk' &&
    (!!liveSessionIdFromUrl || isLessonDeck);
  const lessonDeckLoading = isLiveLessonSession && currentDeck === null;



  const onboardingDeckReady =
    currentDeck?.status === 'in_progress' ||
    isLessonDeck ||
    aiHasTransitioned;

  // Free Talk sessions never show the deck/mission card — pure conversation.
  // Belt-and-suspenders: BE also skips deck generation when mode=free_talk, so
  // currentDeck should be null anyway. This guard handles any race or stale state.
  const deckVisible =
    activeSessionMode !== 'free_talk' &&
    currentDeck !== null &&
    onboardingDeckReady &&
    (currentDeck.status === 'not_started' || currentDeck.status === 'in_progress') &&
    currentDeck.cards.length > 0;
  const onboardingPanelVisible = hasOnboardingPanelContent(isOnboardingSession, onboardingState);

  // Card the deck is currently sitting on (only meaningful while in_progress).
  const activeDeckCard =
    currentDeck && currentDeck.status === 'in_progress'
      ? currentDeck.cards[currentDeck.current_card_index]
      : null;

  // Build toolbox context from active deck/lesson info
  const toolboxCtx: LessonToolboxContext = {
    sessionId: currentSessionId ?? undefined,
    topic: currentDeck?.lesson_title ?? currentDeck?.mission_source ?? undefined,
    level: currentDeck?.level ?? undefined,
    currentTask: activeDeckCard?.task
      ?? (currentDeck?.status === 'in_progress' ? currentDeck.cards[currentDeck.current_card_index]?.task : undefined)
      ?? undefined,
    cardIndex: currentDeck?.current_card_index ?? 0,
  };
  // After an eval, the card shows Next/Finish (next_action 'next_card' | 'finish_session').
  // 'retry' is excluded — there the user must speak again, so the mic stays open.
  const deckAwaitingAdvance =
    deckVisible && !!activeDeckCard?.result && activeDeckCard?.next_action !== 'retry';

  // Block the mic so the user can't talk over the agent / is forced to use the card:
  //  - not_started: agent is presenting the challenge; user must tap Accept/Reject.
  //  - awaiting advance: eval is in, Next/Finish is the only way forward — force the tap.
  // (Once accepted and mid-challenge, the mic is open so they can actually answer.)
  const micBlockedByDeck =
    lessonDeckLoading ||
    (deckVisible && currentDeck?.status === 'not_started') || deckAwaitingAdvance;

  // ── CLOSING_MODE overlay ────────────────────────────────────────────────────
  // Three phases: (1) farewell playing, (2) choices [View recap/breakdown]/[Exit],
  // (3) the evaluation board. Blocks all interaction until the user exits.
  if (isEnding) {
    // Phase 3 — evaluation board
    if (evaluation) {
      return (
        <EvaluationBoard
          evaluation={evaluation}
          lessonAttemptId={endedLessonAttemptId}
          onExit={exitSession}
        />
      );
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
                <TappableText text={closingText} />
              </p>
            ) : (
              <p className="mt-3 text-sm font-bold animate-pulse" style={{ color: '#6f7b64' }}>
                Preparing your recap…
              </p>
            )}
          </div>

          {/* Phase 2 — choices, shown once the farewell finished playing.
              Free Talk uses a softer label ("View recap") since there's no
              skill breakdown to view — just a light conversation summary. */}
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
                {evaluationLoading
                  ? 'Loading…'
                  : activeSessionMode === 'free_talk' ? 'View recap' : 'View breakdown'}
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
      <main className="relative flex flex-1 flex-col overflow-hidden bg-white">
        {/* AI presence indicator — floating header.
            Symmetric side columns so the orb sits exactly on the horizontal center. */}
        <div
          className="absolute top-0 left-0 right-0 z-50 grid grid-cols-[118px_1fr_118px] items-start px-4 pb-2 pointer-events-none"
          style={{ paddingTop: 'max(24px, env(safe-area-inset-top, 24px))' }}
        >
          <div className="flex items-start pt-1 pointer-events-auto">
            {isLiveLessonSession && (
              <LessonToolboxTrigger
                onClick={() => setToolboxOpen((v) => !v)}
                isOpen={toolboxOpen}
              />
            )}
          </div>
          <div className="pointer-events-auto justify-self-center">
            <AiPresence isRecording={isRecording} status={status} />
          </div>
          <div className="flex justify-end pointer-events-auto">
            <EndSessionButton onClick={() => setConfirmEnd(true)} />
          </div>
        </div>

        {/* Exercise dock — compact floating card so it never takes over the chat.
            Centered horizontally so wider phones don't leave a lopsided gap on the right. */}
        {(lessonDeckLoading || deckVisible) && (
          <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-[104px] z-40 w-[min(360px,calc(100vw-48px))] md:left-8 md:translate-x-0 lg:left-10">
            <div className="pointer-events-auto max-h-[calc(100dvh-250px)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-[28px]" style={{ paddingBottom: '4px' }}>
              {lessonDeckLoading ? (
                <LessonDeckLoading />
              ) : (
                <DeckCardView
                  key={`${currentDeck!.id}-${currentDeck!.current_card_index}-${currentDeck!.status}`}
                  deck={currentDeck!}
                  isLighter={lighterMode}
                  isProcessing={status === 'processing' || status === 'greeting' || isSpeaking}
                  onAccept={() => void acceptDeckChallenge()}
                  onReject={() => void rejectDeckChallenge()}
                  onFreeTalk={() => void chooseDeckFreeTalk()}
                  onLighterMode={() => void enterLighterMode()}
                  onEnd={() => void chooseDeckEnd()}
                  onNext={() => lighterMode ? void completeLighterDeck() : void advanceDeckCard()}
                  onSkip={() => void skipDeckCard()}
                  isAdvancing={isAdvancingDeck}
                  sessionId={currentSessionId ?? undefined}
                />
              )}
            </div>
          </div>
        )}

        {/* Insight rail — floats on the right so the chat stays centered on screen
            (mirrors the deck card, which floats on the left). Hidden on mobile. */}
        {onboardingPanelVisible && (
          <div className="pointer-events-none absolute top-[104px] right-8 z-40 hidden w-[260px] md:block lg:right-10 lg:w-[280px]">
            <div className="pointer-events-auto max-h-[calc(100dvh-250px)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-[28px]" style={{ paddingBottom: '4px' }}>
              <OnboardingPanel
                isVisible={isOnboardingSession}
                state={onboardingState}
              />
            </div>
          </div>
        )}

        {/* Conversation — greeting + message bubbles. Always centered; side cards float over. */}
        <div className="min-h-0 flex-1 overflow-hidden px-4 sm:px-6">
          <div className="h-full">
            <div
              ref={scrollContainerRef}
              className="h-full min-h-0 overflow-y-auto py-4 flex flex-col items-center gap-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              style={{
                paddingTop: '120px',
                maskImage: 'linear-gradient(to bottom, transparent 0px, transparent 40px, black 120px)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0px, transparent 40px, black 120px)',
              }}
            >
              <div className="w-full max-w-md flex flex-col gap-3">
            {messages.length === 0 && greetingSentences.length > 0 && (
              <div className="text-center text-2xl md:text-3xl font-medium leading-snug text-gray-800 mt-6">
                {greetingSentences.map((sentence, index) => (
                  <p key={index}>
                    <TappableText text={sentence} />
                  </p>
                ))}
              </div>
            )}

            {messages.map((msg, i) => (
              <MessageBubble key={i} message={msg} onWordDoubleClick={handleWordDoubleClick} />
            ))}

            {errorMessage && (
              <div className="flex justify-center my-2">
                <ErrorBanner message={errorMessage} />
              </div>
            )}

            {messages.length === 0 && status === 'ready' && greetingSentences.length > 0 && !lessonDeckLoading && !deckVisible && (
              <p className="text-sm text-gray-400 text-center mt-2 animate-reveal">Tap the mic to reply.</p>
            )}

                <div ref={messagesEndRef} />
              </div>
            </div>
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
          disabled={micDisabled || micBlockedByDeck}
        />

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

        {/* Lesson Toolbox — desktop right rail + mobile sheet */}
        {isLiveLessonSession && (
          <>
            {toolboxOpen && (
              <div
                className="hidden md:flex fixed top-20 right-4 z-40 w-72 xl:w-80"
                style={{ bottom: 88, flexDirection: 'column' }}
              >
                <LessonToolbox
                  isOpen
                  onClose={() => setToolboxOpen(false)}
                  ctx={toolboxCtx}
                  mode="panel"
                  onAddFlashcard={handleToolboxAddFlashcard}
                />
              </div>
            )}
            <div className="md:hidden">
              <LessonToolbox
                isOpen={toolboxOpen}
                onClose={() => setToolboxOpen(false)}
                ctx={toolboxCtx}
                mode="sheet"
                onAddFlashcard={handleToolboxAddFlashcard}
              />
            </div>
          </>
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
              nextSessionMode={nextSessionMode}
              modeSelectionLocked={modeSelectionLocked}
              onModeChange={setNextSessionMode}
            />
          )}

          {/* ── Message bubbles (live + review) ── */}
          {(reviewMode || sessionStarted) && (
            <div className="flex flex-col gap-3 px-10 py-6">
              {!reviewMode && lessonDeckLoading && (
                <div className="mx-auto w-full max-w-md">
                  <LessonDeckLoading />
                </div>
              )}
              {!reviewMode && deckVisible && !isFocusedLiveSession && (
                <div className="mx-auto w-full max-w-md">
                  <DeckCardView
                    key={`${currentDeck!.id}-${currentDeck!.current_card_index}-${currentDeck!.status}-inline`}
                    deck={currentDeck!}
                    isLighter={lighterMode}
                    isProcessing={status === 'processing' || status === 'greeting' || isSpeaking}
                    onAccept={() => void acceptDeckChallenge()}
                    onReject={() => void rejectDeckChallenge()}
                    onFreeTalk={() => void chooseDeckFreeTalk()}
                    onLighterMode={() => void enterLighterMode()}
                    onEnd={() => void chooseDeckEnd()}
                    onNext={() => lighterMode ? void completeLighterDeck() : void advanceDeckCard()}
                    onSkip={() => void skipDeckCard()}
                    isAdvancing={isAdvancingDeck}
                    sessionId={currentSessionId ?? undefined}
                  />
                </div>
              )}
              {messages.map((msg, i) => (
                <MessageBubble key={i} message={msg} onWordDoubleClick={handleWordDoubleClick} />
              ))}
              {!reviewMode && errorMessage && (
                <div className="flex justify-center my-2">
                  <ErrorBanner message={errorMessage} />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Error banner pre-session */}
          {!reviewMode && !sessionStarted && errorMessage && (
            <div className="flex justify-center px-10 my-2">
              <ErrorBanner message={errorMessage} />
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
              reviewEvaluation.mode === 'free_talk'
                ? <FreeTalkRecap evaluation={reviewEvaluation} />
                : <EvaluationContent evaluation={reviewEvaluation} compact />
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <p className="text-sm font-medium" style={{ color: '#afafaf', fontFamily: 'Lexend, sans-serif' }}>
                  No {reviewPanelLabel} available for this session.
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
              aria-label={`View ${reviewPanelLabel}`}
            >
              <BarChart3 size={18} strokeWidth={3} />
              View {reviewPanelLabel}
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
                    style={{
                      background: reviewPanelIsFreeTalk ? '#f4efff' : '#e9ffd5',
                      border: `2px solid ${reviewPanelIsFreeTalk ? '#ebe0ff' : '#d7ffb8'}`,
                    }}
                  >
                    <BarChart3 size={18} strokeWidth={3} style={{ color: reviewPanelIsFreeTalk ? '#8447ff' : '#2b6c00' }} />
                  </span>
                  <p className="text-base font-black" style={{ color: '#1a1c1c' }}>
                    {reviewPanelIsFreeTalk ? 'Recap' : 'Breakdown'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileBreakdownOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full"
                  style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}
                  aria-label={`Close ${reviewPanelLabel}`}
                >
                  <X size={18} strokeWidth={3} style={{ color: '#6f7b64' }} />
                </button>
              </div>
              <div
                className="overflow-y-auto px-4 pb-6"
                style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
              >
                {reviewEvaluation ? (
                  reviewEvaluation.mode === 'free_talk'
                    ? <FreeTalkRecap evaluation={reviewEvaluation} />
                    : <EvaluationContent evaluation={reviewEvaluation} compact />
                ) : (
                  <div className="flex h-40 items-center justify-center text-center">
                    <p className="text-sm font-medium" style={{ color: '#afafaf' }}>
                      No {reviewPanelLabel} available for this session.
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
          disabled={micDisabled || micBlockedByDeck}
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

function ErrorBanner({ message }: { message: string }) {
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
function EvaluationContent({
  evaluation,
  compact = false,
  reviewRequested,
  onReviewRequested,
}: {
  evaluation: SessionEvaluation;
  compact?: boolean;
  /** Shared with a sibling request button so both reflect the same pending state. */
  reviewRequested?: boolean;
  onReviewRequested?: () => void;
}) {
  const s = evaluation.stats;
  const highlights = evaluation.highlights ?? [];
  const growthAreas = evaluation.growth_areas ?? [];
  const cards = evaluation.cards ?? [];
  const spokenSamples = evaluation.spoken_samples ?? [];
  const corrections = evaluation.corrections ?? [];
  const skillRadar = evaluation.skill_radar ?? [];
  const recurringPattern = evaluation.recurring_pattern;
  const nextDrill = evaluation.next_drill;
  const lessonResult = evaluation.lesson_result ?? null;
  const lessonScore = lessonResult?.final_score ?? lessonResult?.score ?? null;
  const scoreLabel =
    lessonResult?.teacher_review_status === 'revised' ? 'Teacher score' :
    lessonResult?.teacher_review_status === 'approved' ? 'Teacher score' :
    'Score';
  const heroStats = [
    ...(lessonScore != null
      ? [{ label: scoreLabel, value: String(lessonScore) }]
      : []),
    { label: 'Turns', value: String(s.user_turns) },
    { label: 'Exercises', value: s.cards_total ? `${s.cards_completed}/${s.cards_total}` : '-' },
    { label: 'Minutes', value: s.duration_minutes != null ? String(s.duration_minutes) : '-' },
  ];
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
        {lessonResult?.lesson_title && (
          <p className="mt-2 text-xs font-bold" style={{ color: '#6f7b64' }}>
            {lessonResult.lesson_title}
            {lessonResult.teacher_review_status === 'revised' ? ' · teacher revised' : ''}
          </p>
        )}
        <div className={`mt-5 grid ${heroStats.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'} ${compact ? 'gap-2' : 'gap-2 sm:gap-3'}`}>
          {heroStats.map((stat) => (
            <div key={stat.label} className={`rounded-2xl text-center ${compact ? 'px-1 py-2' : 'px-2 py-3'}`} style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}>
              <p className={`font-black ${compact ? 'text-lg' : 'text-2xl'}`} style={{ color: '#1a1c1c' }}>{stat.value}</p>
              <p className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: '#6f7b64' }}>{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Score breakdown: AI vs Teacher tabs ── */}
      {lessonResult && (lessonResult.ai_review || lessonResult.teacher_review) && (
        <LessonScoreBreakdown
          aiReview={lessonResult.ai_review}
          teacherReview={lessonResult.teacher_review}
          attemptId={lessonResult.attempt_id ?? null}
          compact={compact}
          externalRequested={reviewRequested}
          onRequested={onReviewRequested}
        />
      )}

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

// ── Score breakdown: AI vs Teacher ──────────────────────────────────────────
// Two tabs over the same graph layout: the AI's fast feedback, and the optional
// human review. The teacher tab NEVER reuses AI data — it shows a clear empty /
// waiting / completed state instead.
const SKILL_ORDER = ['task_completion', 'grammar', 'vocabulary', 'pronunciation', 'fluency'] as const;
const SKILL_LABELS: Record<string, string> = {
  task_completion: 'Task completion',
  grammar: 'Grammar',
  vocabulary: 'Vocabulary',
  pronunciation: 'Pronunciation',
  fluency: 'Fluency',
};

function ScoreBars({ breakdown }: { breakdown: Record<string, number> | null }) {
  return (
    <div className="grid gap-2.5">
      {SKILL_ORDER.map((key) => {
        const raw = breakdown ? breakdown[key] : undefined;
        const has = typeof raw === 'number';
        const value = has ? Math.max(0, Math.min(100, raw as number)) : 0;
        return (
          <div key={key}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold" style={{ color: '#1a1c1c' }}>{SKILL_LABELS[key]}</p>
              <p className="text-xs font-extrabold tabular-nums" style={{ color: has ? '#1a1c1c' : '#afafaf' }}>
                {has ? value : 'Not provided'}
              </p>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full" style={{ background: '#eef0ec' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${value}%`, background: value >= 70 ? '#58cc02' : value >= 50 ? '#e8a200' : '#ff6b6b' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function reviewDateFmt(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

const TEACHER_REVIEW_WARNING =
  "Request teacher review?\n\nYour AI result will be put on hold while a teacher reviews this lesson. The teacher's score will become the final result and may change whether you pass or need to retry. While the review is pending, the next lesson will stay locked.";

function confirmTeacherReviewRequest() {
  if (typeof window === 'undefined') return true;
  return window.confirm(TEACHER_REVIEW_WARNING);
}

// Learner rates the completed teacher review (1..5 + optional comment). Upsert:
// shows the submitted state once sent, with an Edit affordance to update it.
function TeacherFeedbackSection({
  reviewId,
  feedback,
}: {
  reviewId: string;
  feedback: TeacherReviewFeedback | null;
}) {
  const [saved, setSaved] = useState<TeacherReviewFeedback | null>(feedback);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState<number>(feedback?.rating ?? 0);
  const [comment, setComment] = useState<string>(feedback?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showForm = !saved || editing;

  const submit = async () => {
    if (rating < 1 || rating > 5 || busy) {
      if (rating < 1) setError('Choose a rating from 1 to 5 stars.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await lessonService.submitReviewFeedback(reviewId, {
        rating,
        comment: comment.trim() || undefined,
      });
      // Optimistic: reflect the submitted state immediately.
      setSaved({
        rating: res.rating,
        comment: res.comment,
        created_at: res.created_at,
        updated_at: res.updated_at,
      });
      setEditing(false);
    } catch {
      setError('Could not send your feedback. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl px-3 py-3" style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}>
      <p className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: '#6f7b64' }}>
        Rate this teacher review
      </p>

      {showForm ? (
        <div className="mt-2 grid gap-2">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                aria-label={`${n} stars`}
                className="text-2xl leading-none"
                style={{ color: n <= rating ? '#e8a200' : '#d6d6d6' }}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Optional feedback for the teacher"
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={{ border: '2px solid #e2e2e2' }}
          />
          {error && <p className="text-xs font-semibold" style={{ color: '#9b1c1c' }}>{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="vp-btn-primary h-10 px-4 text-sm disabled:opacity-60"
              style={{ borderRadius: '12px' }}
            >
              {busy ? 'Sending...' : saved ? 'Update feedback' : 'Send feedback'}
            </button>
            {saved && (
              <button
                type="button"
                onClick={() => { setEditing(false); setRating(saved.rating); setComment(saved.comment ?? ''); }}
                className="h-10 px-4 text-sm font-semibold"
                style={{ color: '#6f7b64' }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2 grid gap-1">
          <p className="text-sm font-bold" style={{ color: '#1e5000' }}>Your feedback was sent.</p>
          <p className="text-lg leading-none" style={{ color: '#e8a200' }}>
            {'★'.repeat(saved!.rating)}<span style={{ color: '#d6d6d6' }}>{'★'.repeat(5 - saved!.rating)}</span>
          </p>
          {saved!.comment && <p className="text-sm font-semibold" style={{ color: '#3c3c3c' }}>“{saved!.comment}”</p>}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-1 justify-self-start text-xs font-bold"
            style={{ color: '#2b6c00' }}
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

function LessonScoreBreakdown({
  aiReview,
  teacherReview,
  attemptId,
  compact = false,
  externalRequested,
  onRequested,
}: {
  aiReview?: AiReview;
  teacherReview?: TeacherReviewView;
  attemptId?: string | null;
  compact?: boolean;
  /** Set by a sibling request button so this tab reflects the same pending state. */
  externalRequested?: boolean;
  onRequested?: () => void;
}) {
  const [tab, setTab] = useState<'ai' | 'teacher'>('ai');
  // After a "request review" (from here OR a sibling button) we optimistically
  // flip to a waiting state without a full reload. Derived (not synced via
  // effect) so the real prop data takes over once it's no longer "not_requested".
  const [internalPending, setInternalPending] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const optimisticPending = internalPending || !!externalRequested;

  const teacher: TeacherReviewView | undefined =
    optimisticPending && (!teacherReview || teacherReview.status === 'not_requested')
      ? { ...(teacherReview ?? ({} as TeacherReviewView)), requested: true, status: 'pending' }
      : teacherReview;

  const status = teacher?.status ?? 'not_requested';
  const teacherDone = status === 'completed';

  const requestReview = async () => {
    if (!attemptId || requesting) return;
    if (!confirmTeacherReviewRequest()) return;
    setRequesting(true);
    try {
      await lessonService.requestTeacherReview(attemptId);
      // Idempotent on the backend (created OR already_open) → show waiting.
      setInternalPending(true);
      onRequested?.();
    } catch {
      /* leave the empty state so the user can retry */
    } finally {
      setRequesting(false);
    }
  };

  const cardStyle = { border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' };
  const tabBtn = (active: boolean) =>
    `flex-1 rounded-xl px-3 py-2 text-xs font-extrabold uppercase tracking-wide transition ${
      active ? 'text-white' : 'text-[#6f7b64]'
    }`;

  return (
    <section className={`rounded-[28px] bg-white ${compact ? 'p-4' : 'p-5 sm:p-6'}`} style={cardStyle}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#2b6c00' }}>Score breakdown</p>
        {teacherDone && (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide" style={{ background: '#e8f9d3', color: '#1e5000' }}>
            Teacher reviewed
          </span>
        )}
      </div>

      {/* Segmented control */}
      <div className="mt-3 flex gap-1 rounded-2xl p-1" style={{ background: '#f1f3ee' }}>
        <button type="button" onClick={() => setTab('ai')} className={tabBtn(tab === 'ai')} style={tab === 'ai' ? { background: '#58cc02' } : undefined}>
          AI score
        </button>
        <button type="button" onClick={() => setTab('teacher')} className={tabBtn(tab === 'teacher')} style={tab === 'teacher' ? { background: '#58cc02' } : undefined}>
          Teacher score
        </button>
      </div>

      {/* AI tab */}
      {tab === 'ai' && (
        <div className="mt-4 grid gap-3">
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-black tabular-nums" style={{ color: '#1a1c1c' }}>{aiReview?.score ?? '–'}</p>
            <p className="text-xs font-bold" style={{ color: '#6f7b64' }}>AI score</p>
          </div>
          {aiReview?.breakdown
            ? <ScoreBars breakdown={aiReview.breakdown} />
            : <p className="text-sm font-semibold" style={{ color: '#6f7b64' }}>AI breakdown isn’t available for this attempt yet.</p>}
        </div>
      )}

      {/* Teacher tab */}
      {tab === 'teacher' && (
        <div className="mt-4 grid gap-3">
          {status === 'not_requested' && (
            <div className="grid gap-3 rounded-2xl px-4 py-4 text-center" style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}>
              <p className="text-sm font-bold" style={{ color: '#1a1c1c' }}>You have not requested a teacher review yet.</p>
              <p className="text-xs font-semibold" style={{ color: '#6f7b64' }}>Request a teacher review to get detailed human feedback.</p>
              {attemptId && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={requestReview}
                    disabled={requesting}
                    className="vp-btn-primary h-11 px-5 text-sm disabled:opacity-60"
                    style={{ borderRadius: '14px' }}
                  >
                    {requesting ? 'Sending...' : 'Request teacher review'}
                  </button>
                </div>
              )}
            </div>
          )}

          {(status === 'pending' || status === 'assigned' || status === 'escalated') && (
            <div className="grid gap-2 rounded-2xl px-4 py-4" style={{ background: '#e6efff', border: '2px solid #b7d0ff' }}>
              <p className="text-sm font-black" style={{ color: '#1e3a7a' }}>Waiting for teacher feedback</p>
              <p className="text-xs font-semibold" style={{ color: '#1e3a7a' }}>
                The AI result is on hold. The teacher score will decide the final result, and the next lesson stays locked until review is complete.
              </p>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#1e3a7a' }}>
                {status === 'assigned' ? 'Assigned to a teacher' : status === 'escalated' ? 'Prioritized for review' : 'Waiting for assignment'}
              </p>
              {teacher?.assigned_teacher && (
                <p className="text-xs font-semibold" style={{ color: '#1e3a7a' }}>
                  Teacher: {teacher.assigned_teacher.name} ({teacher.assigned_teacher.email})
                </p>
              )}
              {teacher?.review_reason && (
                <p className="text-xs font-semibold" style={{ color: '#6f7b64' }}>Reason: {teacher.review_reason}</p>
              )}
            </div>
          )}

          {status === 'rejected' && (
            <div className="grid gap-2 rounded-2xl px-4 py-4" style={{ background: '#fde2e2', border: '2px solid #ffc1c1' }}>
              <p className="text-sm font-black" style={{ color: '#7a1e1e' }}>The teacher asked you to redo this lesson</p>
              {teacher?.note && <p className="text-xs font-semibold" style={{ color: '#7a1e1e' }}>{teacher.note}</p>}
              {teacher?.reviewed_by && (
                <p className="text-xs font-semibold" style={{ color: '#6f7b64' }}>
                  By {teacher.reviewed_by.name} ({teacher.reviewed_by.email})
                </p>
              )}
            </div>
          )}

          {status === 'cancelled' && (
            <p className="rounded-2xl px-4 py-4 text-sm font-semibold" style={{ background: '#f3f3f3', color: '#6f7b64' }}>
              This teacher review request was cancelled.
            </p>
          )}

          {teacherDone && (
            <>
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-black tabular-nums" style={{ color: '#1a1c1c' }}>{teacher?.score ?? teacher?.final_score ?? '–'}</p>
                <p className="text-xs font-bold" style={{ color: '#6f7b64' }}>Teacher score</p>
              </div>
              <ScoreBars breakdown={teacher?.breakdown ?? null} />
              {teacher?.note && (
                <div className="rounded-2xl px-3 py-2.5" style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}>
                  <p className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: '#6f7b64' }}>Reviewer note</p>
                  <p className="mt-1 text-sm font-semibold leading-snug" style={{ color: '#3c3c3c' }}>{teacher.note}</p>
                </div>
              )}
              {teacher?.reviewed_by && (
                <p className="text-xs font-semibold" style={{ color: '#6f7b64' }}>
                  Reviewed by {teacher.reviewed_by.name} ({teacher.reviewed_by.email})
                  {reviewDateFmt(teacher.reviewed_at ?? teacher.completed_at) ? ` · ${reviewDateFmt(teacher.reviewed_at ?? teacher.completed_at)}` : ''}
                </p>
              )}
              {teacher?.review_id && (
                <TeacherFeedbackSection
                  key={teacher.review_id}
                  reviewId={teacher.review_id}
                  feedback={teacher.feedback ?? null}
                />
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function EvaluationBoard({
  evaluation,
  lessonAttemptId,
  onExit,
}: {
  evaluation: SessionEvaluation;
  lessonAttemptId: string | null;
  onExit: () => void;
}) {
  // Free Talk sessions get a much lighter recap — no skill_radar, no exercises
  // (none happened), no growth_areas. Just acknowledge the chat and a couple of
  // soft signals (duration, turn count, a quote or two).
  const isFreeTalk = evaluation.mode === 'free_talk';
  // Shared so the result card and Teacher tab reflect the same state immediately.
  const initialReviewRequested = Boolean(
    evaluation.lesson_result?.teacher_review?.requested &&
      evaluation.lesson_result.teacher_review.status !== 'not_requested',
  );
  const [reviewRequested, setReviewRequested] = useState(initialReviewRequested);
  const effectiveReviewRequested = reviewRequested || initialReviewRequested;
  const markRequested = () => setReviewRequested(true);
  return (
    <main className="flex flex-1 flex-col bg-[#f9f9f9]" style={{ fontFamily: 'Lexend, sans-serif' }}>
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-5xl flex flex-col gap-5">
          {lessonAttemptId && <LessonResultCard attemptId={lessonAttemptId} reviewRequested={effectiveReviewRequested} />}
          {isFreeTalk
            ? <FreeTalkRecap evaluation={evaluation} />
            : <EvaluationContent evaluation={evaluation} reviewRequested={effectiveReviewRequested} onReviewRequested={markRequested} />}
        </div>
      </div>

      <div className="shrink-0 border-t px-4 py-4 sm:px-6" style={{ background: '#ffffff', borderColor: '#e2e2e2' }}>
        <div className="mx-auto flex w-full max-w-5xl items-center justify-end gap-3">
          <button
            type="button"
            onClick={onExit}
            className="vp-btn-primary h-12 text-sm w-full sm:w-[180px]"
            style={{ borderRadius: '16px' }}
          >
            Done
          </button>
        </div>
      </div>
    </main>
  );
}

// ── LessonResultCard ───────────────────────────────────────────────────────
// Curriculum-first: shown above the breakdown for sessions that backed a
// lesson attempt. Pulls /lessons/attempts/:id, then renders status/score/next-
// action/teacher-review-status with a CTA to the next lesson or retry.
function LessonResultCard({ attemptId, reviewRequested = false }: { attemptId: string; reviewRequested?: boolean }) {
  const router = useRouter();
  const [result, setResult] = useState<LessonAttemptResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + 20000;
    const tick = async () => {
      try {
        const r = await lessonService.getAttempt(attemptId);
        if (cancelled) return;
        setResult(r);
        // BE finalizes on session.end (sync), but allow a few retries in case
        // the FE called us before the backend finished writing.
        if (r.attempt.status === 'in_progress' && Date.now() < deadline) {
          timer = setTimeout(tick, 1500);
        } else {
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [attemptId]);

  if (loading && !result) {
    return (
      <section className="rounded-[28px] bg-white p-5 sm:p-6 flex items-center gap-3" style={{ border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
        <div className="h-6 w-6 rounded-full border-[3px] border-[#58cc02] border-t-transparent animate-spin" />
        <p className="text-sm font-bold" style={{ color: '#6f7b64' }}>Scoring your lesson…</p>
      </section>
    );
  }
  if (!result) return null;

  const status =
    reviewRequested && result.attempt.status !== 'under_review'
      ? 'under_review'
      : result.attempt.status;
  const tone =
    status === 'passed'       ? { bg: '#e8f9d3', border: '#bdee8c', fg: '#1e5000' } :
    status === 'needs_retry'  ? { bg: '#fff3c4', border: '#ffe28a', fg: '#5b3f00' } :
    status === 'failed'       ? { bg: '#fde2e2', border: '#ffc1c1', fg: '#7a1e1e' } :
    status === 'abandoned'    ? { bg: '#f3f3f3', border: '#e2e2e2', fg: '#6f7b64' } :
    status === 'under_review' ? { bg: '#e6efff', border: '#b7d0ff', fg: '#1e3a7a' } :
                                { bg: '#e8f9d3', border: '#bdee8c', fg: '#1e5000' };
  const statusText: Record<typeof status, string> = {
    passed:       'Passed',
    needs_retry:  'Needs retry',
    failed:       'Failed',
    abandoned:    'Paused',
    in_progress:  'In progress',
    under_review: 'Under teacher review',
  };

  const nextActionLabel: Record<LessonAttemptResult['attempt']['next_action'], string> = {
    next_lesson:    'Open next lesson',
    retry_lesson:   'Retry lesson',
    remedial_drill: 'Try a remedial drill',
    continue_later: 'Continue later',
    none:           'Back to lessons',
  };
  const effectiveNextAction = status === 'under_review' ? 'none' : result.attempt.next_action;
  const scoreDisplay = status === 'under_review' ? '–' : (result.attempt.score ?? 0);
  const handleNext = () => {
    const na = effectiveNextAction;
    if (na === 'next_lesson' && result.lesson?.next_lesson_id) {
      router.push(`/lessons/${result.lesson.next_lesson_id}`);
    } else if (na === 'retry_lesson' && result.lesson) {
      router.push(`/lessons/${result.lesson.id}`);
    } else {
      router.push('/home');
    }
  };

  const reviewStatus = reviewRequested ? 'pending' : result.attempt.teacher_review_status;
  const reviewLabel =
    reviewStatus === 'pending'     ? 'Teacher review pending' :
    reviewStatus === 'approved'    ? 'Teacher review: approved' :
    reviewStatus === 'revised'     ? 'Teacher review: revised' :
    reviewStatus === 'rejected'    ? 'Teacher review: rejected' :
                                     null;

  return (
    <section className="rounded-[28px] bg-white p-5 sm:p-6 flex flex-col gap-3" style={{ border: `2px solid ${tone.border}`, boxShadow: `0 4px 0 ${tone.border}` }}>
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: tone.fg }}>
          Lesson result
        </p>
        <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider" style={{ background: tone.bg, color: tone.fg }}>
          {statusText[status]}
        </span>
      </div>
      <h3 className="text-2xl font-black leading-tight" style={{ color: '#1a1c1c' }}>
        {result.lesson?.title ?? 'Lesson'}
      </h3>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-2xl p-3 text-center" style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}>
          <p className="text-2xl font-black tabular-nums" style={{ color: tone.fg }}>{scoreDisplay}</p>
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#6f7b64' }}>Score</p>
        </div>
        <div className="rounded-2xl p-3 text-center" style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}>
          <p className="text-2xl font-black tabular-nums" style={{ color: '#1a1c1c' }}>
            {result.stats.cards_completed}/{result.stats.cards_total}
          </p>
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#6f7b64' }}>Cards done</p>
        </div>
        <div className="rounded-2xl p-3 text-center" style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}>
          <p className="text-2xl font-black tabular-nums" style={{ color: '#1a1c1c' }}>
            {result.lesson?.pass_score ?? '–'}
          </p>
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#6f7b64' }}>Pass score</p>
        </div>
      </div>
      {reviewLabel && (
        <p className="text-xs font-bold" style={{ color: tone.fg }}>{reviewLabel}</p>
      )}
      <button
        type="button"
        onClick={handleNext}
        className="self-end mt-1 inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl font-extrabold transition active:translate-y-0.5"
        style={{ background: '#58cc02', color: '#1e5000', boxShadow: '0 4px 0 #46a302' }}
      >
        {nextActionLabel[effectiveNextAction]}
      </button>
    </section>
  );
}

// ── FreeTalkRecap ──────────────────────────────────────────────────────────
// Lightweight session recap for Free Talk mode. Intentionally NOT a "skill
// breakdown" — there's nothing to score. Acknowledges the conversation and
// nudges back toward Guided for users who want targeted practice.
function FreeTalkRecap({ evaluation }: { evaluation: SessionEvaluation }) {
  const s = evaluation.stats;
  const turns = s?.user_turns ?? 0;
  const minutes = s?.duration_minutes ?? null;
  const samples = (evaluation.spoken_samples ?? []).slice(0, 3);
  return (
    <div className="grid gap-5" style={{ fontFamily: 'Lexend, sans-serif' }}>
      {/* ── Hero ── */}
      <section className="rounded-[28px] bg-white p-5 sm:p-6" style={{ border: '2px solid #ebe0ff', boxShadow: '0 4px 0 #ebe0ff' }}>
        <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#8447ff' }}>
          Free talk recap
        </p>
        <p className="mt-3 text-2xl font-black leading-tight sm:text-3xl" style={{ color: '#1a1c1c' }}>
          {evaluation.summary && evaluation.summary.trim().length > 0
            ? evaluation.summary
            : 'Nice chat — thanks for stopping by.'}
        </p>

        {/* Lightweight stats — only turns + minutes; no skill scores. */}
        <div className="mt-5 grid grid-cols-2 gap-2 sm:gap-3">
          <div className="rounded-2xl px-2 py-3 text-center" style={{ background: '#f4efff', border: '2px solid #ebe0ff' }}>
            <p className="text-2xl font-black" style={{ color: '#1a1c1c' }}>{turns}</p>
            <p className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: '#6f7b64' }}>Turns</p>
          </div>
          <div className="rounded-2xl px-2 py-3 text-center" style={{ background: '#f4efff', border: '2px solid #ebe0ff' }}>
            <p className="text-2xl font-black" style={{ color: '#1a1c1c' }}>{minutes != null ? String(minutes) : '—'}</p>
            <p className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: '#6f7b64' }}>Minutes</p>
          </div>
        </div>
      </section>

      {/* ── A few things you said — optional, only if consolidation captured any. ── */}
      {samples.length > 0 && (
        <section className="rounded-[24px] bg-white p-4 sm:p-5" style={{ border: '2px solid #ebe0ff', boxShadow: '0 4px 0 #ebe0ff' }}>
          <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Things you said</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {samples.map((q, i) => (
              <p key={i} className="rounded-2xl px-3 py-2 text-sm font-medium italic leading-snug" style={{ background: '#f4efff', color: '#3c3c3c' }}>
                “{q}”
              </p>
            ))}
          </div>
        </section>
      )}

      {/* ── Nudge back to Guided — soft, not pushy. ── */}
      <section className="rounded-[24px] p-4 sm:p-5" style={{ background: '#e8f9d3', border: '2px solid #d7ffb8', boxShadow: '0 4px 0 #d7ffb8' }}>
        <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#2b6c00' }}>Want targeted practice?</p>
        <p className="mt-1 text-sm font-bold leading-snug" style={{ color: '#1a1c1c' }}>
          Switch to Guided Learning next time — get missions and a skill breakdown after each session.
        </p>
      </section>
    </div>
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

type InlineEmphasis = 'plain' | 'em' | 'strong';

interface InlineTextRun {
  text: string;
  emphasis: InlineEmphasis;
}

function findClosingMarker(text: string, marker: '*' | '**', start: number): number {
  const markerLength = marker.length;
  const contentStart = start + markerLength;

  for (let i = contentStart; i < text.length; i += 1) {
    if (!text.startsWith(marker, i)) continue;
    if (marker === '*' && (text[i - 1] === '*' || text[i + 1] === '*')) continue;

    const content = text.slice(contentStart, i);
    if (content.trim().length > 0 && !/\s/.test(content[0]) && !/\s/.test(content[content.length - 1])) {
      return i;
    }
  }

  return -1;
}

function parseInlineEmphasis(text: string): InlineTextRun[] {
  const runs: InlineTextRun[] = [];
  let plain = '';
  let i = 0;

  const pushPlain = () => {
    if (plain) {
      runs.push({ text: plain, emphasis: 'plain' });
      plain = '';
    }
  };

  while (i < text.length) {
    if (text.startsWith('**', i) && text[i + 2] && !/\s/.test(text[i + 2])) {
      const end = findClosingMarker(text, '**', i);
      if (end >= 0) {
        pushPlain();
        runs.push({ text: text.slice(i + 2, end), emphasis: 'strong' });
        i = end + 2;
        continue;
      }
    }

    if (text[i] === '*' && text[i + 1] !== '*' && text[i - 1] !== '*' && text[i + 1] && !/\s/.test(text[i + 1])) {
      const end = findClosingMarker(text, '*', i);
      if (end >= 0) {
        pushPlain();
        runs.push({ text: text.slice(i + 1, end), emphasis: 'em' });
        i = end + 1;
        continue;
      }
    }

    plain += text[i];
    i += 1;
  }

  pushPlain();
  return runs;
}

function TappableText({
  text,
  color,
  onTapWord,
}: {
  text: string;
  color?: string;
  onTapWord?: (word: string, e: React.MouseEvent) => void;
}) {
  const tokenStyle = color ? { color } : undefined;
  const clickableStyle = color
    ? { color, WebkitTapHighlightColor: 'transparent' }
    : { WebkitTapHighlightColor: 'transparent' };

  return (
    <>
      {parseInlineEmphasis(text).map((run, runIndex) => (
        <span
          key={runIndex}
          className={run.emphasis === 'strong' ? 'font-black' : run.emphasis === 'em' ? 'italic' : undefined}
        >
          {tokenizeForTap(run.text).map((t, tokenIndex) =>
            t.isWord && onTapWord ? (
              <span
                key={tokenIndex}
                onClick={(e) => onTapWord(t.token.replace(/^['’]+|['’]+$/g, ''), e)}
                className="cursor-pointer rounded-sm transition-colors hover:bg-[#fff5b0] active:bg-[#ffe680]"
                style={clickableStyle}
              >
                {t.token}
              </span>
            ) : (
              <span key={tokenIndex} style={tokenStyle}>
                {t.token}
              </span>
            ),
          )}
        </span>
      ))}
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

function LessonDeckLoading() {
  return (
    <div
      className="w-full rounded-[24px] p-4 flex items-center gap-3"
      style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2', fontFamily: 'Lexend, sans-serif' }}
    >
      <div className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0" style={{ background: '#e8f9d3' }}>
        <div className="w-4 h-4 rounded-full border-3 border-[#58cc02]/25 border-t-[#58cc02] animate-spin" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Lesson</p>
        <p className="text-sm font-black leading-snug" style={{ color: '#1a1c1c' }}>Preparing your first exercise...</p>
      </div>
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
  isAdvancing,
  sessionId,
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
  isAdvancing: boolean;
  sessionId?: string;
}) {
  const [showRejectOptions, setShowRejectOptions] = useState(false);
  const [taskTranslation, setTaskTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const translatedForRef = useRef<string>('');

  // Auto-advance policy:
  //  • Lighter (quick) mode: no manual controls — advance once any result lands.
  //  • Onboarding final card: auto-finalize so the AI can wrap up session 1.
  //  • Everything else (onboarding mid-deck AND normal session 2+ practice):
  //    wait for the user to tap Next/Skip. The AI explicitly invites
  //    "Tap Next when you're ready", so auto-advancing here would skip the
  //    user's turn to choose (the session 2+ bug we hit before).
  const card = deck.cards[deck.current_card_index];

  const handleTranslate = useCallback(async () => {
    if (!sessionId || !card?.task || translating) return;
    if (translatedForRef.current === card.task) return;
    setTranslating(true);
    setTaskTranslation(null);
    try {
      const res = await httpClient.post<{ translation: string }>(`/session/${sessionId}/translate`, { text: card.task });
      if (res?.translation) {
        setTaskTranslation(res.translation);
        translatedForRef.current = card.task;
      }
    } catch {
      // silent
    } finally {
      setTranslating(false);
    }
  }, [sessionId, card, translating]);
  const isOnboarding = deck.session_type === 'onboarding_diagnostic';
  useEffect(() => {
    if (!card?.result) return;

    if (isOnboarding && card.next_action === 'finish_session') {
      const t = setTimeout(() => onNext(), 1600);
      return () => clearTimeout(t);
    }
    if (isOnboarding) return;

    if (isLighter) {
      const t = setTimeout(() => onNext(), 2000);
      return () => clearTimeout(t);
    }
    // Normal practice: do nothing — wait for the user's Next/Skip tap.
  }, [card, card?.result, card?.next_action, isLighter, isOnboarding, onNext]);

  if (!card) return null;
  const isLesson = deck.session_type === 'lesson_runtime' || !!deck.lesson_attempt_id;

  let cardLabel: string;
  if (isLighter)        cardLabel = 'Quick task';
  else if (isLesson)     cardLabel = `Lesson step ${deck.current_card_index + 1} / ${deck.cards.length}`;
  else if (isOnboarding) cardLabel = `Mini check ${deck.current_card_index + 1} / ${deck.cards.length}`;
  else                   cardLabel = `Exercise ${deck.current_card_index + 1} / ${deck.cards.length}`;

  const isContinuation = deck.is_continuation === true;
  const primaryAcceptLabel = isLesson ? 'Start exercise' : isContinuation ? 'Continue' : "Let's go";

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
          {isLighter ? 'Quick' : isLesson ? 'Lesson' : 'Practice'}
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
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold leading-relaxed" style={{ color: '#6f7b64' }}>{card.task}</p>
          {taskTranslation && (
            <p className="text-xs font-semibold leading-relaxed rounded-xl px-2 py-1.5" style={{ color: '#6f7b64', background: '#f9f9f9', border: '1.5px solid #e2e2e2' }}>
              🇻🇳 {taskTranslation}
            </p>
          )}
          {sessionId && (
            <button
              type="button"
              onClick={() => void handleTranslate()}
              disabled={translating}
              className="self-start text-[10px] font-extrabold px-2 py-0.5 rounded-full transition-all"
              style={{
                background: translating ? '#f0f0f0' : '#fff3e0',
                color: translating ? '#becbb1' : '#ff9c27',
                border: '1.5px solid',
                borderColor: translating ? '#e2e2e2' : '#ffd580',
              }}
            >
              {translating ? 'Đang dịch…' : taskTranslation ? 'Dịch lại' : 'Dịch sang tiếng Việt'}
            </button>
          )}
        </div>
        {isLesson && deck.status === 'not_started' && (
          <p className="text-xs font-bold leading-snug rounded-2xl px-3 py-2" style={{ background: '#e8f9d3', color: '#1e5000', border: '2px solid #d7ffb8' }}>
            Start this exercise first. After I read the task, answer with the mic.
          </p>
        )}

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
        <div className={isLesson ? 'grid gap-3 pt-2' : 'grid grid-cols-2 gap-3 pt-2'}>
          <button
            type="button"
            onClick={onAccept}
            disabled={isProcessing || isAdvancing}
            className="vp-btn-primary h-11 px-4 text-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
            style={{ borderRadius: '14px' }}
          >
            {primaryAcceptLabel}
          </button>
          {!isLesson && (
            <button
              type="button"
              onClick={isOnboarding ? onReject : () => setShowRejectOptions(true)}
              className="vp-btn-ghost h-11 px-4 text-xs"
              style={{ borderRadius: '14px', color: '#6f7b64' }}
            >
              {isOnboarding ? 'Maybe later' : 'Not today'}
            </button>
          )}
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
          isAdvancing={isAdvancing}
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
  isAdvancing,
  onNext,
  onSkip,
}: {
  card: DeckCard;
  isLighter: boolean;
  isOnboarding: boolean;
  isProcessing: boolean;
  isAdvancing: boolean;
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

  // Skip is only meaningful while the user has NOT yet cleared the card. Once an
  // eval passes (or is forced through), Next/Finish owns the forward action, so
  // showing Skip too is redundant and confuses the BE (a Skip tap after a pass
  // would mark the already-passed card as skipped). Hide it then.
  const showSkip = !isLighter && !showNext && !showFinish;

  return (
    <div className="flex justify-end gap-2 pt-1">
      {showSkip && (
        <button
          type="button"
          onClick={onSkip}
          disabled={isProcessing || isAdvancing}
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
          disabled={isProcessing || isAdvancing}
          className="vp-btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
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
          disabled={isProcessing || isAdvancing}
          className="vp-btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
          style={{ padding: '8px 20px', borderRadius: '12px', background: '#58cc02', boxShadow: '0 4px 0 #1f5100' }}
        >
          Finish ✓
        </button>
      )}
    </div>
  );
}

// ── ModeSwitch ─────────────────────────────────────────────────────────────────────
// Pre-session toggle: Guided Learning (deck + missions + skill_radar eval) vs
// Free Talk (open conversation, no deck, no eval). Sits above the greeting
// card so the user makes the call BEFORE tapping the mic.
function ModeSwitch({
  value,
  locked = false,
  onChange,
}: {
  value: 'guided_learning' | 'free_talk';
  locked?: boolean;
  onChange: (mode: 'guided_learning' | 'free_talk') => void;
}) {
  const opts = [
    {
      key: 'guided_learning' as const,
      label: 'Guided Learning',
      sub: 'Missions + feedback',
    },
    {
      key: 'free_talk' as const,
      label: 'Free Talk',
      sub: locked ? 'Unlocks after first chat' : 'Just chat, no pressure',
    },
  ];
  return (
    <div
      role="tablist"
      aria-label="Session mode"
      className="mb-4 grid grid-cols-2 gap-2 rounded-2xl p-1"
      style={{
        background: '#ffffff',
        border: '2px solid #e2e2e2',
        boxShadow: '0 3px 0 #e2e2e2',
        fontFamily: 'Lexend, sans-serif',
      }}
    >
      {opts.map((o) => {
        const active = o.key === value;
        const disabled = locked && o.key === 'free_talk';
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => {
              if (!disabled) onChange(o.key);
            }}
            className="flex flex-col items-start justify-center rounded-xl px-3 py-2 text-left transition-colors"
            style={{
              background: active ? '#dff5c5' : 'transparent',
              border: active ? '2px solid #87fe45' : '2px solid transparent',
              color: disabled ? '#a8afa2' : active ? '#1e5000' : '#6f7b64',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.72 : 1,
            }}
          >
            <span className="text-sm font-extrabold leading-tight">{o.label}</span>
            <span className="text-[11px] font-bold leading-tight opacity-80">{o.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── HomeDashboard ─────────────────────────────────────────────────────────────────────
function HomeDashboard({
  status,
  greetingSentences,
  onStartSession,
  onOpenHistory,
  nextSessionMode,
  modeSelectionLocked,
  onModeChange,
}: {
  status: string;
  greetingSentences: string[];
  onStartSession: () => void;
  onOpenHistory: () => void;
  insight: null;
  nextSessionMode: 'guided_learning' | 'free_talk';
  modeSelectionLocked: boolean;
  onModeChange: (mode: 'guided_learning' | 'free_talk') => void;
}) {
  const [startPressed, setStartPressed] = useState(false);
  const [startHovered, setStartHovered] = useState(false);

  return (
    <div
      className="flex-1 flex flex-col items-center justify-center p-8 w-full"
      style={{ fontFamily: 'Lexend, sans-serif' }}
    >
      <div className="w-full max-w-[700px]">
        {/* Mode switch — picks what the next session will be. Locked once
            session starts (HomeDashboard only renders pre-session). */}
        <ModeSwitch value={nextSessionMode} locked={modeSelectionLocked} onChange={onModeChange} />

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
                    <TappableText text={greetingSentences.join(' ')} />
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
