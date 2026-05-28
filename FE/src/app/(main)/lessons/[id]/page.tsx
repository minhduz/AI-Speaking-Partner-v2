'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
<<<<<<< HEAD
import { ArrowLeft, Play, Lock, CheckCircle2, RotateCcw, Star, Sparkles, ListChecks } from 'lucide-react';
=======
import { ArrowLeft, Play, Lock, CheckCircle2, RotateCcw, Star, Sparkles } from 'lucide-react';
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { PageHeader } from '@/components/shared/page-header';
import { useAuthContext } from '@/contexts/auth-context';
import { lessonService, type LessonDetail } from '@/services/lesson.service';

const STATE_LABEL: Record<LessonDetail['progress']['state'], { text: string; tone: string; bg: string }> = {
  locked:      { text: 'Locked',       tone: '#6f7b64', bg: '#f3f3f3' },
  unlocked:    { text: 'Ready',        tone: '#1e5000', bg: '#e8f9d3' },
  in_progress: { text: 'In progress',  tone: '#5b3f00', bg: '#fff3c4' },
<<<<<<< HEAD
  under_review:{ text: 'Reviewing',    tone: '#1e3a7a', bg: '#dceaff' },
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
  completed:   { text: 'Completed',    tone: '#1e5000', bg: '#bdee8c' },
  needs_retry: { text: 'Needs retry',  tone: '#7a1e1e', bg: '#fde2e2' },
};

export default function LessonDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const lessonId = params?.id;
  const { logout } = useAuthContext();
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lessonId) return;
    let cancelled = false;
    lessonService
      .getDetail(lessonId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load lesson');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const handleStart = async () => {
    if (!lessonId || !detail) return;
    setStarting(true);
    setError(null);
    try {
      const res = await lessonService.start(lessonId);
      // liveSessionId tells the chat hook this is a live lesson session, not
      // a historical review.
      router.push(`/chat?liveSessionId=${res.session_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start lesson');
      setStarting(false);
    }
  };

  return (
    <div className="flex w-full h-full">
      <Sidebar
        onNewChat={() => router.push('/home')}
        onLogout={logout}
        currentSessionId={null}
        onSessionClick={(s) => router.push(`/chat?sessionId=${s.id}`)}
      />
      <main className="flex-1 flex flex-col h-full overflow-hidden" style={{ background: '#f9f9f9', fontFamily: 'Lexend, sans-serif' }}>
        <PageHeader title={detail?.lesson.title ?? 'Lesson'} mobileTitle="Lesson" />
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: '#58cc02' }}>
              <div className="w-6 h-6 rounded-full border-4 border-[#1e5000]/25 border-t-[#1e5000] animate-spin" />
            </div>
          </div>
        ) : !detail ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <p className="text-base font-semibold" style={{ color: '#6f7b64' }}>
              {error ?? 'Lesson not found.'}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto custom-scrollbar px-4 sm:px-8 pb-24">
            <div className="max-w-3xl mx-auto pt-2 flex flex-col gap-5">
              <button
                onClick={() => router.push('/home')}
                className="flex items-center gap-1 text-sm font-bold w-fit"
                style={{ color: '#004666' }}
              >
                <ArrowLeft size={16} /> Back to lessons
              </button>

              <section className="rounded-3xl p-6 flex flex-col gap-3" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
                <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>
                  <span>{detail.lesson.level}</span>
                  <span>•</span>
                  <span>{detail.lesson.topic}</span>
                  <span>•</span>
                  <span>{detail.lesson.unit}</span>
                  {detail.lesson.is_review && (
                    <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]" style={{ background: '#fff3c4', color: '#5b3f00' }}>
                      <Star size={12} /> Review
                    </span>
                  )}
                </div>
                <h1 className="text-3xl font-black" style={{ color: '#1a1c1c' }}>{detail.lesson.title}</h1>
                <p className="text-base font-semibold" style={{ color: '#3f4a36' }}>{detail.lesson.objective}</p>
                {detail.lesson.mini_plan_text && (
                  <p className="text-sm" style={{ color: '#6f7b64' }}>{detail.lesson.mini_plan_text}</p>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <span className="px-3 py-1 rounded-full text-xs font-extrabold" style={{ background: STATE_LABEL[detail.progress.state].bg, color: STATE_LABEL[detail.progress.state].tone }}>
                    {STATE_LABEL[detail.progress.state].text}
                  </span>
                  <span className="text-xs font-bold" style={{ color: '#6f7b64' }}>
                    Pass score: {detail.lesson.pass_score}
                  </span>
                  {detail.progress.best_score != null && (
                    <span className="text-xs font-bold" style={{ color: '#1e5000' }}>
                      Best: {detail.progress.best_score}
                    </span>
                  )}
                </div>

                <div className="pt-3">
                  {detail.progress.state === 'locked' ? (
                    <button
                      disabled
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-extrabold opacity-60 cursor-not-allowed"
                      style={{ background: '#e2e2e2', color: '#6f7b64' }}
                    >
                      <Lock size={18} /> Complete the previous lesson to unlock
                    </button>
<<<<<<< HEAD
                  ) : detail.progress.state === 'under_review' ? (
                    <button
                      disabled
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-extrabold opacity-80 cursor-not-allowed"
                      style={{ background: '#dceaff', color: '#1e3a7a', boxShadow: '0 4px 0 #9bbcff' }}
                    >
                      <ListChecks size={18} /> Waiting for teacher review
                    </button>
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
                  ) : (
                    <button
                      onClick={handleStart}
                      disabled={starting}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl font-extrabold transition active:translate-y-1 disabled:opacity-60"
                      style={{ background: '#58cc02', color: '#1e5000', boxShadow: '0 4px 0 #46a302' }}
                    >
                      {detail.progress.state === 'in_progress' || detail.in_progress_attempt_id ? (
                        <>
                          <Play size={18} /> Continue lesson
                        </>
                      ) : detail.progress.state === 'completed' ? (
                        <>
                          <RotateCcw size={18} /> Practice again
                        </>
                      ) : detail.progress.state === 'needs_retry' ? (
                        <>
                          <RotateCcw size={18} /> Retry lesson
                        </>
                      ) : (
                        <>
                          <Play size={18} /> Start lesson
                        </>
                      )}
                    </button>
                  )}
                  {error && (
                    <p className="mt-3 text-sm font-semibold" style={{ color: '#ba1a1a' }}>{error}</p>
                  )}
                </div>
              </section>

              <section className="rounded-3xl p-6 flex flex-col gap-3" style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>What you&apos;ll practice</p>
                  {detail.personalized && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold"
                      style={{ background: '#f4efff', color: '#5a2eb8', border: '1px solid #ebe0ff' }}
                    >
                      <Sparkles size={10} /> Personalized for your goal
                    </span>
                  )}
                </div>
                <ul className="flex flex-col gap-3 mt-1">
                  {detail.cards.map((card, i) => (
                    <li key={card.id} className="flex gap-3 items-start">
                      <span className="w-8 h-8 rounded-2xl flex items-center justify-center text-sm font-extrabold shrink-0" style={{ background: '#e8f9d3', color: '#1e5000' }}>
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-extrabold text-sm" style={{ color: '#1a1c1c' }}>{card.title}</p>
                        <p className="text-sm mt-0.5" style={{ color: '#3f4a36' }}>{card.task_preview}</p>
                        <p className="text-[11px] mt-1 font-bold uppercase tracking-wider" style={{ color: '#becbb1' }}>
                          {card.type.replaceAll('_', ' ')} · ~{card.expected_duration_seconds}s
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {detail.progress.state === 'completed' && (
                <div className="rounded-3xl p-5 flex items-center gap-3" style={{ background: '#e8f9d3', border: '2px solid #bdee8c' }}>
                  <CheckCircle2 size={22} color="#1e5000" />
                  <p className="text-sm font-bold" style={{ color: '#1e5000' }}>
                    You passed this lesson{detail.progress.best_score != null ? ` with a best score of ${detail.progress.best_score}` : ''}.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
