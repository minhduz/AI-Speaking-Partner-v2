'use client';

import { useState, useEffect, useRef, useCallback, useMemo, type ReactElement } from 'react';
import { httpClient } from '@/lib/http-client';
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { PageHeader } from '@/components/shared/page-header';
import { useAuthContext } from '@/contexts/auth-context';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';

interface FlashcardWord {
  id: string;
  uniqueKey?: string;
  word: string;
  translation: string;
  phonetic: string;
  examples: string[];
  createdAt: string;
  // spaced repetition fields
  status?: string; // 'new' | 'learning' | 'reviewing' | 'mastered'
  reviewCount?: number;
  masteryScore?: number;
  nextReviewAt?: string;
  lastReviewedAt?: string;
}

interface FlashcardGroup {
  topic: string;
  words: FlashcardWord[];
}

type StudyMode = 'flash' | 'practice';
type PracticeType = 'choice' | 'listen' | 'fill' | 'speak';

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

function getOptions(correct: FlashcardWord, all: FlashcardWord[]): FlashcardWord[] {
  const others = shuffle(all.filter(w => w.id !== correct.id)).slice(0, 3);
  return shuffle([...others, correct]);
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function pronunciationScore(recognized: string, target: string): number {
  const r = recognized.toLowerCase().trim().split(' ')[0];
  const t = target.toLowerCase().trim();
  if (r === t) return 100;
  const dist = levenshtein(r, t);
  return Math.max(0, Math.round((1 - dist / Math.max(r.length, t.length)) * 100));
}

// ── FlashcardsPage ──────────────────────────────────────────────────────────

export default function FlashcardsPage() {
  const { logout } = useAuthContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [groups, setGroups] = useState<FlashcardGroup[]>([]);
  const [masteredGroups, setMasteredGroups] = useState<FlashcardGroup[]>([]);
  const [reviewDueWords, setReviewDueWords] = useState<FlashcardWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [activeMasteredTopic, setActiveMasteredTopic] = useState<string | null>(null);
  const [view, setView] = useState<'active' | 'mastered' | 'review'>(() => {
    const v = searchParams.get('view');
    return v === 'review' || v === 'mastered' ? v : 'active';
  });
  const [masteredWordIds, setMasteredWordIds] = useState<Set<string>>(new Set());
  const [showReviewBanner, setShowReviewBanner] = useState(false);
  const [selectedMasteredWord, setSelectedMasteredWord] = useState<FlashcardWord | null>(null);

  useEffect(() => {
    async function loadAll() {
      try {
        const [active, mastered, due] = await Promise.all([
          httpClient.get<FlashcardGroup[]>('/api/dictionary/flashcards'),
          httpClient.get<FlashcardGroup[]>('/api/dictionary/flashcards/archived'),
          httpClient.get<FlashcardWord[]>('/api/dictionary/flashcards/review-due'),
        ]);
        setGroups(active);
        setMasteredGroups(mastered);
        setReviewDueWords(due);
        if (active.length > 0) setActiveTopic(active[0].topic);
        if (mastered.length > 0) setActiveMasteredTopic(mastered[0].topic);
        if (due.length > 0) setShowReviewBanner(true);
      } catch (err) {
        console.error('Failed to load flashcards', err);
      } finally {
        setLoading(false);
      }
    }
    loadAll();
  }, []);

  const handleWordMastered = useCallback((wordId: string, word: FlashcardWord, topic: string) => {
    setMasteredWordIds(prev => new Set(prev).add(wordId));
    // Optimistically add the word to masteredGroups so Archive tab updates immediately
    setMasteredGroups(prev => {
      const existing = prev.find(g => g.topic === topic);
      if (existing) {
        if (existing.words.some(w => w.id === wordId)) return prev;
        return prev.map(g => g.topic === topic ? { ...g, words: [...g.words, { ...word, status: 'mastered' }] } : g);
      }
      return [...prev, { topic, words: [{ ...word, status: 'mastered' }] }];
    });
    setActiveMasteredTopic(prev => prev ?? topic);
  }, []);

  // Only topics that still have unswiped words
  const nonEmptyGroups = groups.filter(g => g.words.some(w => !masteredWordIds.has(w.id)));
  // Auto-advance: if user-selected topic is now empty, fall back to first non-empty
  const effectiveTopic = nonEmptyGroups.find(g => g.topic === activeTopic)?.topic ?? nonEmptyGroups[0]?.topic ?? null;
  const activeGroup = groups.find(g => g.topic === effectiveTopic);
  const activeWords = activeGroup?.words.filter(w => !masteredWordIds.has(w.id)) ?? [];
  const activeMasteredGroup = masteredGroups.find(g => g.topic === activeMasteredTopic);
  const totalMastered = masteredGroups.reduce((s, g) => s + g.words.length, 0) + masteredWordIds.size;

  return (
    <div className="flex w-full h-full">
      <Sidebar
        onNewChat={() => router.push('/chat')}
        onLogout={logout}
        currentSessionId={null}
        onSessionClick={(session) => router.push(`/chat?sessionId=${session.id}`)}
      />
      <main className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden" style={{ background: '#f9f9f9', fontFamily: 'Lexend, sans-serif' }}>
        <PageHeader
          title="Flashcards"
          rightSlot={
            !loading ? (
              <div className="hidden sm:block">
              <div className="rounded-2xl px-4 py-2" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 3px 0 #e2e2e2' }}>
                <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Library</p>
                <p className="text-sm font-black" style={{ color: '#1a1c1c' }}>{groups.reduce((sum, g) => sum + g.words.filter(w => !masteredWordIds.has(w.id)).length, 0)} active · {totalMastered} mastered</p>
              </div>
            </div>
            ) : undefined
          }
        />

        {/* Review due banner */}
        {showReviewBanner && reviewDueWords.length > 0 && (
          <div className="mx-8 mb-2 rounded-2xl px-5 py-3 flex items-center justify-between gap-4 shrink-0" style={{ background: '#fff7d6', border: '2px solid #ffd900', boxShadow: '0 3px 0 #ffd900' }}>
            <div className="flex items-center gap-3">
              <span style={{ fontSize: 22 }}>🔔</span>
              <p className="text-sm font-bold" style={{ color: '#683a00' }}>
                You have <strong>{reviewDueWords.length}</strong> {reviewDueWords.length === 1 ? 'word' : 'words'} to review today — ready to start?
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => setView('review')} className="px-4 py-2 rounded-xl text-sm font-extrabold transition active:translate-y-0.5" style={{ background: '#ffd900', color: '#683a00', boxShadow: '0 2px 0 #c9a800' }}>
                Review now
              </button>
              <button onClick={() => setShowReviewBanner(false)} className="px-3 py-2 rounded-xl text-sm font-bold" style={{ color: '#6f7b64' }}>
                Skip
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center pb-24 lg:pb-0">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#58cc02' }}>
              <div className="w-6 h-6 rounded-full border-4 border-[#1e5000]/25 border-t-[#1e5000] animate-spin" />
            </div>
          </div>
        ) : groups.length === 0 && masteredGroups.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-6 pb-24 lg:pb-8">
            <div className="w-full max-w-xl rounded-3xl p-8 text-center" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
              <div className="w-20 h-20 mx-auto rounded-3xl flex items-center justify-center mb-5" style={{ background: '#dceeff', color: '#004666' }}>
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
              </div>
              <h2 className="text-2xl font-black" style={{ color: '#1a1c1c' }}>No flashcards yet</h2>
              <p className="text-[15px] mt-2 mx-auto max-w-sm font-medium" style={{ color: '#6f7b64' }}>Look up words in chat and save them here for review.</p>
              <button onClick={() => router.push('/chat')} className="mt-6 px-6 py-3 rounded-2xl font-extrabold transition active:translate-y-1" style={{ background: '#58cc02', color: '#1e5000', boxShadow: '0 4px 0 #46a302' }}>
                Go to chat
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden px-3 pb-24 sm:px-8 lg:overflow-y-auto lg:pb-8">
            <div className="mx-auto grid w-full max-w-6xl flex-1 min-h-0 grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
              <aside className="lg:col-span-4 flex flex-col gap-5 min-h-0">

                {/* View toggle */}
                <div className="flex rounded-2xl p-1 shrink-0" style={{ background: '#f3f3f3', border: '2px solid #e2e2e2' }}>
                  {(['active', 'mastered', 'review'] as const).map((v) => {
                    const labels = { active: 'Studying', mastered: 'Archive', review: `Review${reviewDueWords.length > 0 ? ` (${reviewDueWords.length})` : ''}` };
                    const active = view === v;
                    return (
                      <button key={v} onClick={() => setView(v)}
                        className="flex-1 py-2 rounded-xl text-xs font-extrabold transition active:translate-y-0.5"
                        style={active ? { background: '#ffffff', color: '#1a1c1c', boxShadow: '0 2px 0 #e2e2e2' } : { color: '#6f7b64' }}>
                        {labels[v]}
                      </button>
                    );
                  })}
                </div>

                {view === 'active' && (
                  <>
                    <div className="rounded-3xl p-6" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
                      <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Current topic</p>
                      <div className="relative mt-3">
                        <select value={effectiveTopic || ''} onChange={(e) => setActiveTopic(e.target.value)}
                          className="w-full appearance-none outline-none cursor-pointer rounded-2xl px-4 py-4 pr-11 text-base font-black transition"
                          style={{ background: '#f3f3f3', color: '#1a1c1c', border: '2px solid #e2e2e2' }}>
                          {nonEmptyGroups.map((group) => {
                            const count = group.words.filter(w => !masteredWordIds.has(w.id)).length;
                            return <option key={group.topic} value={group.topic}>{group.topic} • {count} words</option>;
                          })}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4" style={{ color: '#6f7b64' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-3xl p-6 flex-1 min-h-0" style={{ background: '#dceeff', border: '2px solid #c8e6ff', boxShadow: '0 4px 0 #c8e6ff' }}>
                      <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#004666' }}>Study plan</p>
                      <h2 className="text-3xl font-black mt-2" style={{ color: '#004666' }}>{activeWords.length} cards</h2>
                      <p className="text-sm font-semibold mt-2" style={{ color: '#004666' }}>Swipe left when learned, swipe right to review later.</p>
                      <div className="mt-5 grid grid-cols-2 gap-3">
                        <div className="rounded-2xl p-4" style={{ background: '#ffffff' }}>
                          <p className="text-2xl font-black" style={{ color: '#2b6c00' }}>{learnedCountFromLearned(activeGroup?.words ?? [], masteredWordIds)}</p>
                          <p className="text-xs font-bold" style={{ color: '#6f7b64' }}>this session</p>
                        </div>
                        <div className="rounded-2xl p-4" style={{ background: '#ffffff' }}>
                          <p className="text-2xl font-black" style={{ color: '#683a00' }}>{groups.length}</p>
                          <p className="text-xs font-bold" style={{ color: '#6f7b64' }}>topics</p>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {view === 'mastered' && (
                  <div className="rounded-3xl p-6 flex-1 min-h-0 flex flex-col gap-4" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
                    <div>
                      <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Archive</p>
                      <p className="text-2xl font-black mt-1" style={{ color: '#1a1c1c' }}>{totalMastered} words archived</p>
                    </div>
                    {masteredGroups.length > 0 && (
                      <div className="relative">
                        <select value={activeMasteredTopic || ''} onChange={(e) => { setActiveMasteredTopic(e.target.value); setSelectedMasteredWord(null); }}
                          className="w-full appearance-none outline-none cursor-pointer rounded-2xl px-4 py-3 pr-11 text-sm font-black transition"
                          style={{ background: '#f3f3f3', color: '#1a1c1c', border: '2px solid #e2e2e2' }}>
                          {masteredGroups.map((g) => (
                            <option key={g.topic} value={g.topic}>{g.topic} • {g.words.length}</option>
                          ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4" style={{ color: '#6f7b64' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                        </div>
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
                      {(activeMasteredGroup?.words ?? []).map(w => {
                        const isSelected = selectedMasteredWord?.id === w.id;
                        return (
                          <button
                            key={w.id}
                            onClick={() => setSelectedMasteredWord(isSelected ? null : w)}
                            className="w-full text-left rounded-2xl px-4 py-3 flex items-center justify-between transition-all"
                            style={{
                              background: isSelected ? '#d7ffb8' : '#f9f9f9',
                              border: isSelected ? '2px solid #58cc02' : '2px solid #e2e2e2',
                            }}
                          >
                            <div>
                              <p className="font-black text-sm" style={{ color: '#1a1c1c' }}>{w.word}</p>
                              <p className="text-xs font-medium" style={{ color: '#6f7b64' }}>{w.translation}</p>
                            </div>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6f7b64" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                          </button>
                        );
                      })}
                      {masteredGroups.length === 0 && (
                        <p className="text-sm font-medium text-center pt-4" style={{ color: '#6f7b64' }}>No archived words yet.</p>
                      )}
                    </div>
                  </div>
                )}

                {view === 'review' && (
                  <div className="rounded-3xl p-6 flex-1 min-h-0" style={{ background: '#fff7d6', border: '2px solid #ffd900', boxShadow: '0 4px 0 #ffd900' }}>
                    <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#683a00' }}>Review</p>
                    <p className="text-2xl font-black mt-1" style={{ color: '#683a00' }}>{reviewDueWords.length} words due</p>
                    <p className="text-sm font-semibold mt-2" style={{ color: '#683a00' }}>Words due for review today. Swipe to refresh your memory.</p>
                  </div>
                )}

              </aside>

              <section className="min-h-0 lg:col-span-8 rounded-3xl overflow-hidden flex flex-col" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
                {view === 'active' && effectiveTopic && (
                  <FlashcardDeck key={effectiveTopic} topic={effectiveTopic} words={activeWords} onWordMastered={handleWordMastered} />
                )}
                {view === 'review' && (
                  <FlashcardDeck key="review" topic="Review" words={reviewDueWords} onWordMastered={handleWordMastered} />
                )}
                {view === 'mastered' && (
                  selectedMasteredWord ? (
                    <MasteredWordDetail word={selectedMasteredWord} onClose={() => setSelectedMasteredWord(null)} />
                  ) : (
                    <div className="flex-1 h-full flex items-center justify-center">
                      <div className="text-center px-8">
                        <div className="w-20 h-20 mx-auto rounded-3xl flex items-center justify-center mb-4" style={{ background: '#d7ffb8', color: '#2b6c00' }}>
                          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                        </div>
                        <p className="text-lg font-black" style={{ color: '#1a1c1c' }}>Your archived words</p>
                        <p className="text-sm font-medium mt-1" style={{ color: '#6f7b64' }}>Select a word on the left to see its details.</p>
                      </div>
                    </div>
                  )
                )}
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function learnedCountFromLearned(words: FlashcardWord[], learnedWordIds: Set<string>): number {
  return words.filter(w => learnedWordIds.has(w.id)).length;
}

// ── MasteredWordDetail ──────────────────────────────────────────────────────

function MasteredWordDetail({ word, onClose }: { word: FlashcardWord; onClose: () => void }) {
  const speak = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const utt = new SpeechSynthesisUtterance(word.word);
    utt.lang = 'en-US';
    utt.rate = 0.85;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utt);
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto p-8 gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 shrink-0">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-4xl font-black" style={{ color: '#1a1c1c' }}>{word.word}</h2>
            <button
              onClick={speak}
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95"
              style={{ background: '#dceeff', color: '#004666' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            </button>
          </div>
          {word.phonetic && (
            <p className="mt-1 text-lg font-mono tracking-widest px-3 py-1 rounded-xl inline-block" style={{ color: '#004666', background: '#dceeff' }}>
              {word.phonetic}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all hover:opacity-70"
          style={{ background: '#f3f3f3', color: '#6f7b64' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      {/* Translation */}
      <div className="rounded-3xl p-6 shrink-0" style={{ background: '#d7ffb8', border: '2px solid #b8f08c' }}>
        <p className="text-[11px] font-extrabold uppercase tracking-widest mb-1" style={{ color: '#2b6c00' }}>Translation</p>
        <p className="text-2xl font-black" style={{ color: '#1e5000' }}>{word.translation}</p>
      </div>

      {/* Examples */}
      {word.examples && word.examples.length > 0 && (
        <div className="shrink-0">
          <p className="text-[11px] font-extrabold uppercase tracking-widest mb-3" style={{ color: '#6f7b64' }}>Examples</p>
          <div className="space-y-3">
            {word.examples.map((ex, i) => (
              <div key={i} className="rounded-2xl px-5 py-4" style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}>
                <p className="text-sm font-semibold leading-relaxed" style={{ color: '#1a1c1c' }}>
                  {ex.replace(/<[^>]*>?/gm, '')}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 shrink-0">
        {word.reviewCount !== undefined && (
          <div className="rounded-2xl p-4" style={{ background: '#ffffff', border: '2px solid #e2e2e2' }}>
            <p className="text-2xl font-black" style={{ color: '#1a1c1c' }}>{word.reviewCount}</p>
            <p className="text-xs font-bold mt-0.5" style={{ color: '#6f7b64' }}>Times reviewed</p>
          </div>
        )}
        {word.masteryScore !== undefined && (
          <div className="rounded-2xl p-4" style={{ background: '#ffffff', border: '2px solid #e2e2e2' }}>
            <p className="text-2xl font-black" style={{ color: '#58cc02' }}>{Math.round(word.masteryScore * 100)}%</p>
            <p className="text-xs font-bold mt-0.5" style={{ color: '#6f7b64' }}>Mastery score</p>
          </div>
        )}
        {word.lastReviewedAt && (
          <div className="rounded-2xl p-4" style={{ background: '#ffffff', border: '2px solid #e2e2e2' }}>
            <p className="text-base font-black" style={{ color: '#1a1c1c' }}>{new Date(word.lastReviewedAt).toLocaleDateString()}</p>
            <p className="text-xs font-bold mt-0.5" style={{ color: '#6f7b64' }}>Last reviewed</p>
          </div>
        )}
        {word.createdAt && (
          <div className="rounded-2xl p-4" style={{ background: '#ffffff', border: '2px solid #e2e2e2' }}>
            <p className="text-base font-black" style={{ color: '#1a1c1c' }}>{new Date(word.createdAt).toLocaleDateString()}</p>
            <p className="text-xs font-bold mt-0.5" style={{ color: '#6f7b64' }}>Date saved</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── FlashcardDeck ──────────────────────────────────────────────────────────

function FlashcardDeck({ topic, words, onWordMastered }: { topic: string; words: FlashcardWord[]; onWordMastered: (wordId: string, word: FlashcardWord, topic: string) => void }) {
  const [studyMode, setStudyMode] = useState<StudyMode>('flash');
  const [practiceKey, setPracticeKey] = useState(0);
  const [deck, setDeck] = useState<FlashcardWord[]>(words.map(w => ({ ...w, uniqueKey: w.id })));
  const [learnedCount, setLearnedCount] = useState(0);

  const handleSwipeLeft = async (index: number) => {
    const word = deck[index];
    setDeck(prev => prev.filter((_, i) => i !== index));
    setLearnedCount(c => c + 1);
    onWordMastered(word.id, word, topic);
    httpClient.patch(`/api/dictionary/flashcards/${word.id}/review`, { result: 'easy' }).catch(() => {});
  };

  const handleSwipeRight = (index: number) => {
    const word = deck[index];
    setDeck(prev => {
      const newDeck = [...prev];
      const [movedCard] = newDeck.splice(index, 1);
      return [...newDeck, { ...movedCard, uniqueKey: `${movedCard.id}-${Math.random()}` }];
    });
    httpClient.patch(`/api/dictionary/flashcards/${word.id}/review`, { result: 'hard' }).catch(() => {});
  };

  const switchMode = (mode: StudyMode) => {
    setStudyMode(mode);
    if (mode === 'practice') setPracticeKey(k => k + 1);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 shrink-0">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Deck</p>
          <h2 className="text-xl font-black" style={{ color: '#1a1c1c' }}>{topic}</h2>
        </div>
        <div className="flex rounded-2xl p-1" style={{ background: '#f3f3f3', border: '2px solid #e2e2e2' }}>
          <button
            onClick={() => switchMode('flash')}
            className="px-5 py-2 rounded-xl text-sm font-extrabold transition active:translate-y-0.5"
            style={studyMode === 'flash' ? { background: '#58cc02', color: '#1e5000', boxShadow: '0 3px 0 #46a302' } : { color: '#6f7b64' }}
          >
            Flashcard
          </button>
          <button
            onClick={() => switchMode('practice')}
            className="px-5 py-2 rounded-xl text-sm font-extrabold transition active:translate-y-0.5"
            style={studyMode === 'practice' ? { background: '#2fb8ff', color: '#004666', boxShadow: '0 3px 0 #1c93d1' } : { color: '#6f7b64' }}
          >
            Practice
          </button>
        </div>
      </div>

      {studyMode === 'flash' && (
        deck.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center animate-reveal">
            <div className="w-24 h-24 rounded-3xl flex items-center justify-center mb-6" style={{ background: '#d7ffb8', color: '#2b6c00' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            </div>
            <h2 className="text-2xl font-black" style={{ color: '#1a1c1c' }}>You did it!</h2>
            <p className="mt-2 font-medium" style={{ color: '#6f7b64' }}>You have reviewed all {learnedCount} words in this topic.</p>
            <button
              onClick={() => { setDeck(words.map(w => ({ ...w, uniqueKey: w.id }))); setLearnedCount(0); }}
              className="mt-8 px-6 py-3 rounded-2xl font-extrabold transition active:translate-y-1"
              style={{ background: '#ffffff', color: '#1a1c1c', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}
            >
              Review Again
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden px-8 pb-6 pt-12">
            <div className="absolute top-2 left-0 w-full flex justify-between px-10 text-xs font-extrabold tracking-widest uppercase" style={{ color: '#6f7b64' }}>
              <div className="flex flex-col items-center opacity-70">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-2"><path d="M19 12H5M5 12l7-7M5 12l7 7" /></svg>
                Review Later
              </div>
              <div className="flex flex-col items-center opacity-70">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mb-2"><path d="M5 12h14M19 12l-7-7M19 12l-7 7" /></svg>
                Learned
              </div>
            </div>

            <div className="flex flex-col items-center gap-4">
              <div className="relative w-[min(360px,calc(100vw-560px))] min-w-[280px] aspect-[3/4] perspective-1000">
                <AnimatePresence>
                  {deck.slice(0, 3).reverse().map((word) => {
                    const deckIndex = deck.findIndex(w => w.uniqueKey === word.uniqueKey);
                    return (
                      <SwipeableCard
                        key={word.uniqueKey}
                        word={word}
                        depth={deckIndex}
                        onSwipeLeft={() => handleSwipeRight(0)}
                        onSwipeRight={() => handleSwipeLeft(0)}
                      />
                    );
                  })}
                </AnimatePresence>
              </div>

              <div className="px-4 py-2 rounded-full text-xs font-extrabold" style={{ background: '#f3f3f3', color: '#6f7b64' }}>
                {deck.length} cards remaining
              </div>
            </div>
          </div>
        )
      )}

      {studyMode === 'practice' && (
        <PracticeSession key={practiceKey} words={words} />
      )}
    </div>
  );
}

// ── SwipeableCard ──────────────────────────────────────────────────────────

function SwipeableCard({ word, depth, onSwipeLeft, onSwipeRight }: {
  word: FlashcardWord; depth: number; onSwipeLeft: () => void; onSwipeRight: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [exitX, setExitX] = useState(0);

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-15, 15]);
  const learnedOpacity = useTransform(x, [100, 200], [0, 1]);
  const reviewOpacity = useTransform(x, [-100, -200], [0, 1]);

  const handleDragEnd = (_event: unknown, info: { velocity: { x: number }; offset: { x: number } }) => {
    const isFastSwipe = Math.abs(info.velocity.x) > 500;
    const isFarSwipe = Math.abs(info.offset.x) > 100;
    if (isFarSwipe || isFastSwipe) {
      const direction = info.offset.x > 0 ? 1 : -1;
      setExitX(direction * 500);
      if (direction === -1) onSwipeLeft(); else onSwipeRight();
    }
  };

  const isTop = depth === 0;

  return (
    <motion.div
      className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing origin-bottom"
      style={{ x, rotate, zIndex: 10 - depth }}
      initial={{ scale: 1 - depth * 0.05, y: depth * 20, opacity: depth >= 3 ? 0 : 1 }}
      animate={{ scale: 1 - depth * 0.05, y: depth * 20, opacity: depth >= 3 ? 0 : 1, transition: { type: 'spring', stiffness: 300, damping: 20 } }}
      drag={isTop ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.8}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={(e, info) => { setTimeout(() => setIsDragging(false), 100); handleDragEnd(e, info); }}
      exit={{ x: exitX, opacity: 0, transition: { duration: 0.2 } }}
    >
      <div
        className={`w-full h-full transition-transform duration-500 preserve-3d relative shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-[24px] ${flipped ? 'rotate-y-180' : ''}`}
        onClick={() => { if (!isDragging && isTop) setFlipped(!flipped); }}
      >
        <div className="absolute inset-0 backface-hidden w-full h-full bg-white rounded-[28px] flex flex-col items-center justify-center p-8 overflow-hidden pointer-events-none" style={{ border: '2px solid #e2e2e2', boxShadow: '0 6px 0 #e2e2e2' }}>
          <motion.div style={{ opacity: learnedOpacity }} className="absolute top-8 right-8 border-4 border-[#58cc02] text-[#2b6c00] font-black text-2xl px-4 py-1 rounded-xl rotate-[15deg]">LEARNED</motion.div>
          <motion.div style={{ opacity: reviewOpacity }} className="absolute top-8 left-8 border-4 border-[#ff9c27] text-[#683a00] font-black text-2xl px-4 py-1 rounded-xl -rotate-[15deg]">REVIEW</motion.div>
          <p className="text-5xl font-black text-center mb-4" style={{ color: '#1a1c1c' }}>{word.word}</p>
          {word.phonetic && <p className="text-lg font-mono tracking-widest px-3 py-1 rounded-xl" style={{ color: '#004666', background: '#dceeff' }}>{word.phonetic}</p>}
          <div className="absolute bottom-8 flex items-center gap-2 text-sm font-extrabold" style={{ color: '#6f7b64' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
            Tap to flip
          </div>
        </div>

        <div className="absolute inset-0 backface-hidden w-full h-full rounded-[28px] flex flex-col p-8 rotate-y-180 overflow-y-auto custom-scrollbar pointer-events-none" style={{ background: '#58cc02', border: '2px solid #46a302', color: '#1e5000', boxShadow: '0 6px 0 #46a302' }}>
          <div className="flex-1 flex flex-col">
            <p className="text-2xl font-black text-center mb-6 leading-relaxed pb-6" style={{ borderBottom: '2px solid rgba(30,80,0,0.15)' }}>{word.translation}</p>
            {word.examples && word.examples.length > 0 ? (
              <div className="space-y-4">
                <p className="text-xs uppercase tracking-widest font-black flex items-center gap-2" style={{ color: '#2b6c00' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  Examples
                </p>
                <ul className="text-base space-y-4" style={{ color: '#1e5000' }}>
                  {word.examples.slice(0, 2).map((ex, i) => (
                    <li key={i} className="leading-relaxed relative pl-4 font-semibold">
                      <span className="absolute left-0 top-2.5 w-1.5 h-1.5 rounded-full" style={{ background: '#2b6c00' }} />
                      {ex.replace(/<[^>]*>?/gm, '')}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center opacity-60">No examples available</div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── PracticeSession ─────────────────────────────────────────────────────────

function PracticeSession({ words }: { words: FlashcardWord[] }) {
  const [practiceType, setPracticeType] = useState<PracticeType | null>(null);
  const [queue, setQueue] = useState<FlashcardWord[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const inTransition = useRef(false);

  const startPractice = (type: PracticeType) => {
    setPracticeType(type);
    setQueue(shuffle([...words]));
    setCurrentIdx(0);
    setCorrectCount(0);
    setFeedback(null);
    setShowAnswer(false);
    inTransition.current = false;
  };

  const handleAnswer = useCallback((correct: boolean) => {
    if (inTransition.current) return;
    inTransition.current = true;
    setFeedback(correct ? 'correct' : 'wrong');
    if (correct) setCorrectCount(c => c + 1);
    setShowAnswer(true);
    setTimeout(() => {
      setFeedback(null);
      setShowAnswer(false);
      setCurrentIdx(i => i + 1);
      inTransition.current = false;
    }, correct ? 800 : 1800);
  }, []);

  if (!practiceType) {
    return <ModeSelector onSelect={startPractice} canStart={words.length >= 2} />;
  }

  if (currentIdx >= queue.length) {
    return (
      <PracticeResults
        correct={correctCount}
        total={queue.length}
        onRestart={() => setPracticeType(null)}
      />
    );
  }

  const currentWord = queue[currentIdx];

  return (
    <div className="flex-1 flex flex-col items-center px-4 pt-10 xl:pt-14 pb-6 overflow-hidden">
      <div className="w-full max-w-md mb-3 shrink-0">
        <div className="flex justify-between text-xs text-gray-400 mb-1.5 font-medium">
          <span>{currentIdx + 1} / {queue.length}</span>
          <span>{correctCount} correct</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: '#f3f3f3' }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${(currentIdx / queue.length) * 100}%`, background: '#58cc02' }}
          />
        </div>
      </div>

      <div className="w-full max-w-md flex flex-col overflow-visible">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${currentIdx}-${practiceType}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.18 }}
            className="flex-1 flex flex-col"
          >
            {practiceType === 'choice' && <ChoiceCard word={currentWord} allWords={words} onAnswer={handleAnswer} feedback={feedback} showAnswer={showAnswer} />}
            {practiceType === 'listen' && <ListenCard word={currentWord} allWords={words} onAnswer={handleAnswer} feedback={feedback} showAnswer={showAnswer} />}
            {practiceType === 'fill' && <FillCard word={currentWord} onAnswer={handleAnswer} feedback={feedback} showAnswer={showAnswer} />}
            {practiceType === 'speak' && <SpeakCard word={currentWord} onAnswer={handleAnswer} feedback={feedback} showAnswer={showAnswer} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── ModeSelector ────────────────────────────────────────────────────────────

function ModeSelector({ onSelect, canStart }: { onSelect: (type: PracticeType) => void; canStart: boolean }) {
  const modes: { type: PracticeType; icon: ReactElement; label: string; desc: string }[] = [
    {
      type: 'choice',
      label: 'Multiple Choice',
      desc: 'Pick the correct word from options',
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" />
        </svg>
      ),
    },
    {
      type: 'listen',
      label: 'Listen & Guess',
      desc: 'Hear the word, pick what you heard',
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      ),
    },
    {
      type: 'fill',
      label: 'Fill in the Blank',
      desc: 'Complete the sentence with the right word',
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" />
        </svg>
      ),
    },
    {
      type: 'speak',
      label: 'Speak It',
      desc: 'Pronounce the word and get scored',
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex-1 flex flex-col items-center px-6 pt-16 xl:pt-20 gap-6">
      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-800">Choose a practice mode</h2>
        {!canStart && <p className="text-sm text-amber-600 mt-1">Need at least 2 words to practice</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 w-full max-w-md">
        {modes.map(({ type, icon, label, desc }) => (
          <button
            key={type}
            onClick={() => canStart && onSelect(type)}
            disabled={!canStart}
            className={`flex flex-col items-center gap-2.5 p-5 bg-white rounded-2xl border border-[#E8E4D9] shadow-sm text-center transition-all duration-200 ${canStart ? 'hover:border-[#58cc02]/50 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
          >
            <div className="text-[#58cc02]">{icon}</div>
            <div>
              <p className="text-sm font-bold text-gray-800">{label}</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── PracticeResults ──────────────────────────────────────────────────────────

function PracticeResults({ correct, total, onRestart }: { correct: number; total: number; onRestart: () => void }) {
  const pct = Math.round((correct / total) * 100);
  const emoji = pct >= 80 ? '🎉' : pct >= 50 ? '💪' : '📖';
  const msg = pct >= 80 ? 'Excellent work!' : pct >= 50 ? 'Good effort!' : 'Keep practicing!';

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 animate-reveal">
      <div className="w-24 h-24 bg-violet-100 rounded-full flex items-center justify-center text-4xl shadow-inner">{emoji}</div>
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-800">{msg}</h2>
        <p className="text-gray-500 mt-1">
          <span className="font-bold text-[#58cc02]">{correct}</span> / {total} correct
          <span className="ml-2 text-gray-400">({pct}%)</span>
        </p>
      </div>
      <div className="w-full max-w-xs bg-gray-100 rounded-full h-3 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-400' : 'bg-rose-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <button
        onClick={onRestart}
        className="mt-2 px-7 py-2.5 bg-[#58cc02] text-white rounded-xl font-semibold shadow-sm hover:bg-[#46a302] transition-colors"
      >
        Try Another Mode
      </button>
    </div>
  );
}

// ── ChoiceCard ──────────────────────────────────────────────────────────────

function ChoiceCard({ word, allWords, onAnswer, feedback, showAnswer }: {
  word: FlashcardWord; allWords: FlashcardWord[];
  onAnswer: (correct: boolean) => void; feedback: 'correct' | 'wrong' | null; showAnswer: boolean;
}) {
  const [options] = useState(() => getOptions(word, allWords));
  const [selected, setSelected] = useState<string | null>(null);

  const handleSelect = (opt: FlashcardWord) => {
    if (selected || showAnswer) return;
    setSelected(opt.word);
    onAnswer(opt.id === word.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl border border-[#E8E4D9] p-6 shadow-sm text-center">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">What word means...</p>
        <p className="text-2xl font-bold text-gray-800 leading-relaxed">{word.translation}</p>
        {word.phonetic && <p className="text-sm text-gray-400 font-mono mt-2">{word.phonetic}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const isCorrect = opt.id === word.id;
          const isSelected = selected === opt.word;
          let cls = 'bg-white border-[#E8E4D9] text-gray-800 hover:border-[#58cc02]/40 hover:bg-violet-50';
          if (showAnswer && isCorrect) cls = 'bg-green-100 border-green-400 text-green-800';
          else if (isSelected && !isCorrect) cls = 'bg-red-100 border-red-400 text-red-800';
          return (
            <button
              key={opt.id}
              onClick={() => handleSelect(opt)}
              disabled={!!selected}
              className={`py-4 px-3 rounded-xl font-semibold text-sm text-center transition-all duration-150 border-2 shadow-sm ${cls}`}
            >
              {opt.word}
            </button>
          );
        })}
      </div>

      <FeedbackBanner feedback={feedback} />
    </div>
  );
}

// ── ListenCard ──────────────────────────────────────────────────────────────

function ListenCard({ word, allWords, onAnswer, feedback, showAnswer }: {
  word: FlashcardWord; allWords: FlashcardWord[];
  onAnswer: (correct: boolean) => void; feedback: 'correct' | 'wrong' | null; showAnswer: boolean;
}) {
  const [options] = useState(() => getOptions(word, allWords));
  const [selected, setSelected] = useState<string | null>(null);
  const [played, setPlayed] = useState(false);

  const speak = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const utt = new SpeechSynthesisUtterance(word.word);
    utt.lang = 'en-US';
    utt.rate = 0.85;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utt);
    setPlayed(true);
  };

  const handleSelect = (opt: FlashcardWord) => {
    if (selected || showAnswer || !played) return;
    setSelected(opt.word);
    onAnswer(opt.id === word.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl border border-[#E8E4D9] p-8 shadow-sm flex flex-col items-center gap-4">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Which word do you hear?</p>
        <button
          onClick={speak}
          className="w-20 h-20 rounded-full bg-[#58cc02] text-white flex items-center justify-center shadow-lg hover:bg-[#46a302] active:scale-95 transition-all"
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        </button>
        <p className="text-xs text-gray-400">{played ? 'Tap to replay' : 'Tap to play the word'}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const isCorrect = opt.id === word.id;
          const isSelected = selected === opt.word;
          let cls = played
            ? 'bg-white border-[#E8E4D9] text-gray-800 hover:border-[#58cc02]/40 hover:bg-violet-50'
            : 'bg-white border-[#E8E4D9] text-gray-300 cursor-not-allowed';
          if (showAnswer && isCorrect) cls = 'bg-green-100 border-green-400 text-green-800';
          else if (isSelected && !isCorrect) cls = 'bg-red-100 border-red-400 text-red-800';
          return (
            <button
              key={opt.id}
              onClick={() => handleSelect(opt)}
              disabled={!!selected || !played}
              className={`py-4 px-3 rounded-xl font-semibold text-sm text-center transition-all duration-150 border-2 shadow-sm ${cls}`}
            >
              {opt.word}
            </button>
          );
        })}
      </div>

      <FeedbackBanner feedback={feedback} />
    </div>
  );
}

// ── FillCard ────────────────────────────────────────────────────────────────

function FillCard({ word, onAnswer, feedback, showAnswer }: {
  word: FlashcardWord; onAnswer: (correct: boolean) => void;
  feedback: 'correct' | 'wrong' | null; showAnswer: boolean;
}) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const sentence = useMemo(() => {
    const ex = word.examples?.[0];
    if (!ex) return null;
    const clean = ex.replace(/<[^>]*>?/gm, '');
    const re = new RegExp(`\\b${escapeRegex(word.word)}\\b`, 'i');
    return re.test(clean) ? clean.replace(re, '_____') : null;
  }, [word]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || showAnswer) return;
    onAnswer(input.trim().toLowerCase() === word.word.toLowerCase());
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl border border-[#E8E4D9] p-6 shadow-sm">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
          {sentence ? 'Complete the sentence' : 'Type the word for this meaning'}
        </p>
        {sentence
          ? <p className="text-lg text-gray-800 leading-relaxed font-medium">{sentence}</p>
          : <p className="text-2xl font-bold text-gray-800">{word.translation}</p>
        }
        {showAnswer && (
          <p className="mt-3 text-sm font-semibold text-[#58cc02]">
            Answer: <span className="font-bold">{word.word}</span>
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={showAnswer}
          placeholder="Type your answer..."
          className="flex-1 px-4 py-3 rounded-xl border-2 border-[#E8E4D9] focus:border-[#58cc02] outline-none text-gray-800 font-medium transition-colors bg-white disabled:bg-gray-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || showAnswer}
          className="px-5 py-3 bg-[#58cc02] text-white rounded-xl font-semibold disabled:opacity-40 hover:bg-[#46a302] transition-colors"
        >
          Check
        </button>
      </form>

      <FeedbackBanner feedback={feedback} />
    </div>
  );
}

// ── SpeakCard ───────────────────────────────────────────────────────────────

function SpeakCard({ word, onAnswer, feedback, showAnswer }: {
  word: FlashcardWord; onAnswer: (correct: boolean) => void;
  feedback: 'correct' | 'wrong' | null; showAnswer: boolean;
}) {
  const [isListening, setIsListening] = useState(false);
  const [recognized, setRecognized] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const recognitionRef = useRef<unknown>(null);

  const supported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const startListening = () => {
    if (!supported || isListening || showAnswer) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const text: string = event.results[0][0].transcript;
      setRecognized(text);
      const s = pronunciationScore(text, word.word);
      setScore(s);
      onAnswer(s >= 70);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl border border-[#E8E4D9] p-8 shadow-sm flex flex-col items-center gap-3">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Pronounce this word</p>
        <p className="text-4xl font-bold text-gray-800">{word.word}</p>
        {word.phonetic && (
          <p className="text-lg text-[#58cc02] font-mono tracking-widest bg-[#58cc02]/10 px-3 py-1 rounded-lg">{word.phonetic}</p>
        )}
      </div>

      {!supported ? (
        <div className="text-center text-sm text-gray-400 bg-gray-50 rounded-xl p-4 border border-gray-200">
          Speech recognition is not supported in this browser.
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={startListening}
            disabled={isListening || showAnswer}
            className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all ${isListening ? 'bg-rose-500 ring-4 ring-rose-200 animate-pulse scale-110' : 'bg-[#58cc02] hover:bg-[#46a302] active:scale-95'} disabled:opacity-50`}
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          {isListening
            ? <p className="text-sm text-rose-500 font-medium animate-pulse">Listening...</p>
            : !recognized && !showAnswer && <p className="text-sm text-gray-400">Tap and say the word aloud</p>
          }
        </div>
      )}

      {recognized && (
        <div className="bg-white rounded-2xl border border-[#E8E4D9] p-4 text-center space-y-2 shadow-sm">
          <p className="text-xs text-gray-400 uppercase tracking-widest font-bold">You said</p>
          <p className="text-lg font-bold text-gray-800">&quot;{recognized}&quot;</p>
          {score !== null && (
            <div className="flex flex-col items-center gap-1.5">
              <div className="h-2 w-40 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${score >= 70 ? 'bg-green-500' : 'bg-rose-400'}`}
                  style={{ width: `${score}%` }}
                />
              </div>
              <p className={`text-sm font-bold ${score >= 70 ? 'text-green-600' : 'text-rose-500'}`}>
                {score}% match
              </p>
            </div>
          )}
        </div>
      )}

      <FeedbackBanner feedback={feedback} />
    </div>
  );
}

// ── FeedbackBanner ──────────────────────────────────────────────────────────

function FeedbackBanner({ feedback }: { feedback: 'correct' | 'wrong' | null }) {
  if (!feedback) return null;
  return (
    <div className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-sm ${feedback === 'correct' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {feedback === 'correct' ? (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          Correct!
        </>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          Not quite — see the correct answer above
        </>
      )}
    </div>
  );
}
