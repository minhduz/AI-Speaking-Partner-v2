'use client';

import { useState, useEffect, useMemo, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import {
  Mic, Flame, Sparkles, Briefcase, Plane, Utensils, Smile, Cpu,
  GraduationCap, HeartPulse, Users, Globe, MessagesSquare, BookOpen, Tag, Zap,
} from 'lucide-react';
import { httpClient } from '@/lib/http-client';
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { PageHeader } from '@/components/shared/page-header';
import { useAuthContext } from '@/contexts/auth-context';
import { userService } from '@/services/user.service';
import { progressService, type DashboardStats } from '@/services/progress.service';
import { sessionService, type SessionInsight } from '@/services/session.service';
import type { UserProfile } from '@/types/user.types';

interface FlashcardWord {
  id: string;
  word: string;
  translation: string;
  createdAt: string;
  reviewCount?: number;
  masteryScore?: number;
}
interface FlashcardGroup { topic: string; words: FlashcardWord[]; }

// The fixed topic taxonomy mirrors dictionary-service ALLOWED_TOPICS. Each maps
// to an icon for the Mastery Heatmap tiles.
const TOPICS: { name: string; icon: ReactElement }[] = [
  { name: 'Daily Life', icon: <Sparkles size={20} strokeWidth={2.5} /> },
  { name: 'Work & Business', icon: <Briefcase size={20} strokeWidth={2.5} /> },
  { name: 'Travel', icon: <Plane size={20} strokeWidth={2.5} /> },
  { name: 'Food & Dining', icon: <Utensils size={20} strokeWidth={2.5} /> },
  { name: 'Emotions', icon: <Smile size={20} strokeWidth={2.5} /> },
  { name: 'Technology', icon: <Cpu size={20} strokeWidth={2.5} /> },
  { name: 'Education', icon: <GraduationCap size={20} strokeWidth={2.5} /> },
  { name: 'Health', icon: <HeartPulse size={20} strokeWidth={2.5} /> },
  { name: 'Relationships', icon: <Users size={20} strokeWidth={2.5} /> },
  { name: 'Culture', icon: <Globe size={20} strokeWidth={2.5} /> },
  { name: 'Slang & Idioms', icon: <MessagesSquare size={20} strokeWidth={2.5} /> },
  { name: 'Academic', icon: <BookOpen size={20} strokeWidth={2.5} /> },
  { name: 'Uncategorized', icon: <Tag size={20} strokeWidth={2.5} /> },
];

// 5-step green ramp keyed off relative study intensity. Index 0 = not studied.
const HEAT_SHADES = [
  { bg: '#f3f3f3', fg: '#b6c0aa' }, // none — dimmed
  { bg: '#e8f9d3', fg: '#4f7a1e' },
  { bg: '#bdee8c', fg: '#2b6c00' },
  { bg: '#83dd3e', fg: '#1e5000' },
  { bg: '#58cc02', fg: '#ffffff' }, // most studied — boldest
];

const WEEKDAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export default function HomePage() {
  const { logout } = useAuthContext();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [insight, setInsight] = useState<SessionInsight | null>(null);
  const [active, setActive] = useState<FlashcardGroup[]>([]);
  const [archived, setArchived] = useState<FlashcardGroup[]>([]);
  const [reviewDueCount, setReviewDueCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      const [p, s, ins, act, arch, due] = await Promise.all([
        userService.me().catch(() => null),
        progressService.getDashboardStats().catch((err) => {
          console.error('Failed to load dashboard progress', err);
          return null;
        }),
        sessionService.getInsight().catch(() => null),
        httpClient.get<FlashcardGroup[]>('/api/dictionary/flashcards').catch(() => []),
        httpClient.get<FlashcardGroup[]>('/api/dictionary/flashcards/archived').catch(() => []),
        httpClient.get<FlashcardWord[]>('/api/dictionary/flashcards/review-due').catch(() => []),
      ]);
      if (cancelled) return;
      setProfile(p);
      setStats(s);
      setInsight(ins);
      setActive(act ?? []);
      setArchived(arch ?? []);
      setReviewDueCount((due ?? []).length);
      setLoading(false);
    }
    loadAll();
    return () => { cancelled = true; };
  }, []);

  // ── Derived: vocabulary counts ──
  const activeCount = useMemo(
    () => active.reduce((sum, g) => sum + g.words.length, 0), [active]);
  const masteredCount = useMemo(
    () => archived.reduce((sum, g) => sum + g.words.length, 0), [archived]);
  const totalWords = activeCount + masteredCount;
  const masteredPct = totalWords > 0 ? Math.round((masteredCount / totalWords) * 100) : 0;
  const newToday = useMemo(
    () => active.reduce((sum, g) => sum + g.words.filter((w) => w.createdAt && isToday(w.createdAt)).length, 0),
    [active]);

  // ── Derived: per-topic study intensity for the heatmap ──
  const heat = useMemo(() => {
    const score = new Map<string, number>();
    for (const g of [...active, ...archived]) {
      const s = g.words.reduce((acc, w) => acc + 1 + 0.5 * (w.reviewCount ?? 0), 0);
      score.set(g.topic, (score.get(g.topic) ?? 0) + s);
    }
    const max = Math.max(1, ...score.values());
    return TOPICS.map((t) => {
      const raw = score.get(t.name) ?? 0;
      // bucket 0 (none) … 4 (boldest); studied topics get at least bucket 1
      const level = raw === 0 ? 0 : Math.min(4, 1 + Math.round((raw / max) * 3));
      return { ...t, level, raw };
    });
  }, [active, archived]);

  const firstName = (profile?.name || profile?.email || 'there').split(/[ @]/)[0];
  const todayIndex = (new Date().getDay() + 6) % 7;
  const weekly = stats?.weekly?.length
    ? stats.weekly
    : WEEKDAY_LABELS.map((day, index) => ({ day, count: 0, is_today: index === todayIndex }));
  const maxWeekly = Math.max(1, ...weekly.map((d) => d.count));

  return (
    <div className="flex w-full h-full">
      <Sidebar
        onNewChat={() => router.push('/chat')}
        onLogout={logout}
        currentSessionId={null}
        onSessionClick={(session) => router.push(`/chat?sessionId=${session.id}`)}
      />
      <main className="flex-1 flex flex-col h-full overflow-hidden" style={{ background: '#f9f9f9', fontFamily: 'Lexend, sans-serif' }}>
        <PageHeader title="Focus Home" mobileTitle="SpeakUP" hideBack />

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#58cc02' }}>
              <div className="w-6 h-6 rounded-full border-4 border-[#1e5000]/25 border-t-[#1e5000] animate-spin" />
            </div>
          </div>
        ) : (
          <div
            className="flex-1 overflow-y-auto custom-scrollbar px-4 sm:px-8"
            style={{ paddingBottom: 'max(40px, calc(96px + env(safe-area-inset-bottom, 0px)))' }}
          >
            <div className="max-w-6xl mx-auto flex flex-col gap-5 pt-2">

              {/* ── Hero ── */}
              <section className="relative overflow-hidden rounded-3xl p-8" style={{ background: '#2fb8ff', border: '2px solid #1c93d1', boxShadow: '0 5px 0 #1c93d1' }}>
                <div className="relative z-10 max-w-xl">
                  <h2 className="text-4xl font-black" style={{ color: '#003b56', letterSpacing: '-0.02em' }}>Ready to Speak?</h2>
                  <p className="mt-2 text-base font-semibold" style={{ color: '#004f73' }}>
                    {insight?.next_challenge
                      ? `${firstName}, today try: ${insight.next_challenge}`
                      : `Start a conversation to practice your ${profile?.level ?? ''} speaking in a natural setting.`}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button onClick={() => router.push('/chat')}
                      className="flex items-center gap-2 px-6 py-3 rounded-2xl font-extrabold transition active:translate-y-1"
                      style={{ background: '#58cc02', color: '#1e5000', boxShadow: '0 4px 0 #46a302' }}>
                      <Mic size={18} strokeWidth={2.5} /> Start Session
                    </button>
                    <button onClick={() => router.push('/flashcards')}
                      className="px-6 py-3 rounded-2xl font-extrabold transition active:translate-y-1"
                      style={{ background: '#ffffff', color: '#004666', boxShadow: '0 4px 0 #cbe8fb' }}>
                      Quick Practice
                    </button>
                  </div>
                </div>
                <div className="absolute -right-8 -top-8 w-56 h-56 rounded-full opacity-40" style={{ background: '#5cc8ff' }} />
                <div className="absolute right-14 top-1/2 -translate-y-1/2 w-28 h-28 rounded-full hidden md:flex items-center justify-center" style={{ background: '#ffffff', boxShadow: '0 4px 0 #cbe8fb' }}>
                  <Mic size={44} color="#2fb8ff" strokeWidth={2.5} />
                </div>
              </section>

              {/* ── Weekly progress + Streak ── */}
              <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2 rounded-3xl p-6" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
                  <div className="flex items-baseline justify-between">
                    <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Weekly Progress</p>
                    <p className="text-[11px] font-bold" style={{ color: '#becbb1' }}>Sessions / day</p>
                  </div>
                  <div className="mt-5 flex items-end justify-between gap-3 h-40">
                      {weekly.map((d) => (
                        <div key={d.day} className="flex-1 flex flex-col items-center gap-1.5">
                          <span
                            className="text-[11px] font-extrabold tabular-nums"
                            style={{ color: d.count > 0 ? (d.is_today ? '#2b6c00' : '#3f4a36') : '#d0d0d0' }}
                          >
                            {d.count > 0 ? d.count : '·'}
                          </span>
                          <div className="w-full rounded-xl flex-1 flex items-end" style={{ background: '#f3f3f3', maxWidth: 44 }}>
                            <div className="w-full rounded-xl transition-all"
                              style={{
                                height: `${Math.max(8, (d.count / maxWeekly) * 100)}%`,
                                background: d.is_today ? '#58cc02' : d.count > 0 ? '#bdee8c' : '#e2e2e2',
                              }} />
                          </div>
                          <span className="text-[11px] font-extrabold" style={{ color: d.is_today ? '#2b6c00' : '#6f7b64' }}>{d.day}</span>
                        </div>
                      ))}
                  </div>
                </div>

                <div className="rounded-3xl p-6 flex flex-col items-center justify-center text-center" style={{ background: '#ff9c27', border: '2px solid #e0851a', boxShadow: '0 4px 0 #e0851a' }}>
                  <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#683a00' }}>Daily Streak</p>
                  <div className="flex items-center gap-2 mt-3">
                    <Flame size={36} fill="#fff" strokeWidth={0} />
                    <span className="text-5xl font-black" style={{ color: '#ffffff' }}>{stats?.current_streak ?? 0}</span>
                  </div>
                  <p className="mt-3 text-sm font-bold" style={{ color: '#683a00' }}>
                    {(stats?.sessions_today ?? 0) > 0 ? 'Done for today — keep it up!' : 'Practice today to extend it!'}
                  </p>
                </div>
              </section>

              {/* ── Vocabulary + Mastery Heatmap ── */}
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="rounded-3xl p-6" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Vocabulary</p>
                    <BookOpen size={18} color="#004666" strokeWidth={2.5} />
                  </div>
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-sm font-extrabold" style={{ color: '#1a1c1c' }}>{profile?.level ?? ''} Words</span>
                    <span className="text-sm font-black" style={{ color: '#6f7b64' }}>{masteredCount}/{totalWords}</span>
                  </div>
                  <div className="mt-2 h-3 rounded-full overflow-hidden" style={{ background: '#f3f3f3' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${masteredPct}%`, background: '#2fb8ff' }} />
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl p-4 text-center" style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}>
                      <p className="text-2xl font-black" style={{ color: '#004666' }}>{newToday}</p>
                      <p className="text-xs font-bold" style={{ color: '#6f7b64' }}>New Today</p>
                    </div>
                    <div className="rounded-2xl p-4 text-center" style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}>
                      <p className="text-2xl font-black" style={{ color: '#2b6c00' }}>{masteredPct}%</p>
                      <p className="text-xs font-bold" style={{ color: '#6f7b64' }}>Mastered</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl p-6" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
                  <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Mastery Heatmap</p>
                  <p className="text-xs font-medium mt-1" style={{ color: '#becbb1' }}>Brighter = more practiced</p>
                  <div className="mt-4 grid grid-cols-4 gap-2.5">
                    {heat.map((t) => {
                      const shade = HEAT_SHADES[t.level];
                      return (
                        <div key={t.name} title={`${t.name}${t.raw > 0 ? '' : ' — not studied yet'}`}
                          className="aspect-square rounded-2xl flex flex-col items-center justify-center gap-1 px-1"
                          style={{ background: shade.bg, color: shade.fg, opacity: t.level === 0 ? 0.55 : 1 }}>
                          {t.icon}
                          <span className="text-[9px] font-extrabold uppercase tracking-wide text-center leading-tight">{t.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* ── Keep going: review nudge + insight ── */}
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <button onClick={() => router.push(reviewDueCount > 0 ? '/flashcards?view=review' : '/flashcards')}
                  className="text-left rounded-3xl p-6 flex items-center gap-4 transition active:translate-y-1"
                  style={{ background: reviewDueCount > 0 ? '#fff7d6' : '#ffffff', border: `2px solid ${reviewDueCount > 0 ? '#ffd900' : '#e2e2e2'}`, boxShadow: `0 4px 0 ${reviewDueCount > 0 ? '#ffd900' : '#e2e2e2'}` }}>
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: reviewDueCount > 0 ? '#ffd900' : '#f3f3f3', color: '#683a00' }}>
                    <Zap size={22} strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="font-black text-base" style={{ color: '#1a1c1c' }}>
                      {reviewDueCount > 0
                        ? `${reviewDueCount} ${reviewDueCount === 1 ? 'word' : 'words'} to review today`
                        : 'No words to review'}
                    </p>
                    <p className="text-sm font-medium" style={{ color: '#6f7b64' }}>
                      {reviewDueCount > 0 ? 'Tap to review now →' : 'Look up new words in chat to add them here.'}
                    </p>
                  </div>
                </button>

                <div className="rounded-3xl p-6" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
                  <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Coach Insight</p>
                  {insight?.has_insight ? (
                    <div className="mt-3 space-y-2">
                      {insight.struggled_with && (
                        <p className="text-sm font-semibold" style={{ color: '#1a1c1c' }}>
                          <span style={{ color: '#ba1a1a' }}>Struggled with:</span> {insight.struggled_with}
                        </p>
                      )}
                      {insight.next_challenge && (
                        <p className="text-sm font-semibold" style={{ color: '#1a1c1c' }}>
                          <span style={{ color: '#2b6c00' }}>Next challenge:</span> {insight.next_challenge}
                        </p>
                      )}
                      {typeof insight.last_session_days_ago === 'number' && (
                        <p className="text-xs font-medium" style={{ color: '#6f7b64' }}>
                          Last session: {insight.last_session_days_ago === 0
                            ? 'today'
                            : `${insight.last_session_days_ago} day${insight.last_session_days_ago === 1 ? '' : 's'} ago`}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm font-medium" style={{ color: '#6f7b64' }}>
                      Complete a speaking session to get feedback from your AI coach.
                    </p>
                  )}
                </div>
              </section>

            </div>
          </div>
        )}
      </main>
    </div>
  );
}
