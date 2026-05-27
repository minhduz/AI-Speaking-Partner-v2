'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import {
  reviewTaskService,
  type ReviewTask,
  type ReviewSkill,
  type ReviewDecision,
  type AudioTurn,
  type TeacherDashboard,
  type TeacherStats,
  type TeacherHistoryItem,
  type TeacherFeedbackItem,
  type ReviewPeriod,
} from '@/services/teacher-review.service';

const SKILLS: { key: ReviewSkill; label: string }[] = [
  { key: 'task_completion', label: 'Task completion' },
  { key: 'grammar', label: 'Grammar' },
  { key: 'vocabulary', label: 'Vocabulary' },
  { key: 'pronunciation', label: 'Pronunciation' },
  { key: 'fluency', label: 'Fluency' },
];

type SkillDraft = Partial<Record<ReviewSkill, string>>;
type Tab = 'queue' | 'history' | 'analytics' | 'feedback';

const PERIODS: { value: ReviewPeriod; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All' },
];

function numberFmt(value: number | undefined | null) {
  return new Intl.NumberFormat('en-US').format(value ?? 0);
}

function dateFmt(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function Stars({ rating }: { rating: number | null | undefined }) {
  if (rating == null) return <span className="text-slate-400">—</span>;
  return (
    <span className="font-semibold text-amber-500" title={`${rating}/5`}>
      {'★'.repeat(rating)}
      <span className="text-slate-300">{'★'.repeat(Math.max(0, 5 - rating))}</span>
    </span>
  );
}

function decisionClasses(d: string) {
  if (d === 'approved') return 'bg-green-50 text-green-700 ring-green-200';
  if (d === 'revised') return 'bg-amber-50 text-amber-700 ring-amber-200';
  if (d === 'rejected') return 'bg-red-50 text-red-700 ring-red-200';
  return 'bg-slate-50 text-slate-600 ring-slate-200';
}

export default function TeacherDashboardPage() {
  const { handleLogout } = useAuth();
  const [dashboard, setDashboard] = useState<TeacherDashboard | null>(null);
  const [tab, setTab] = useState<Tab>('queue');
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const data = await reviewTaskService.dashboard();
      setDashboard(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    }
  }, []);

  useEffect(() => {
    let active = true;
    reviewTaskService
      .dashboard()
      .then((data) => {
        if (active) {
          setDashboard(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      });
    return () => {
      active = false;
    };
  }, []);

  const q = dashboard?.queue;
  const stats = dashboard?.stats;
  const chips = [
    { label: 'Assigned open', value: numberFmt(q?.assigned_open) },
    { label: 'Overdue', value: numberFmt(q?.overdue) },
    { label: 'Done today', value: numberFmt(q?.completed_today) },
    { label: 'Done this month', value: numberFmt(q?.completed_this_month) },
    { label: 'Avg rating', value: stats?.rating_count ? `${stats.average_rating} ★` : '—' },
  ];

  const tabs: { value: Tab; label: string }[] = [
    { value: 'queue', label: 'Queue / Next task' },
    { value: 'history', label: 'History' },
    { value: 'analytics', label: 'Analytics' },
    { value: 'feedback', label: 'Student feedback' },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Header: profile + quick stats */}
      <header className="mb-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">
                {dashboard?.teacher?.name ?? 'Teacher dashboard'}
              </h1>
              {dashboard?.teacher?.role && (
                <span className="rounded-full bg-[#E5F8CF] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#2F6B12]">
                  {dashboard.teacher.role}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500">{dashboard?.teacher?.email ?? 'Reviewer operations'}</p>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          >
            Log out
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {chips.map((c) => (
            <div key={c.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-lg font-semibold text-slate-900">{c.value}</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
            </div>
          ))}
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === t.value
                ? 'bg-[#4A6741] text-white'
                : 'border border-slate-300 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'queue' && <ReviewQueuePanel onSubmitted={loadDashboard} />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'analytics' && <AnalyticsTab stats={stats ?? null} />}
      {tab === 'feedback' && <FeedbackTab />}
    </div>
  );
}

// ── Queue / Next task ────────────────────────────────────────────────────────
// Unchanged reviewer flow: the system hands out one task at a time; the teacher
// scores it and submits. After submitting we refresh the dashboard counters.
function ReviewQueuePanel({ onSubmitted }: { onSubmitted: () => void }) {
  const [task, setTask] = useState<ReviewTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [skills, setSkills] = useState<SkillDraft>({});
  const [comment, setComment] = useState('');

  useEffect(() => {
    let active = true;
    reviewTaskService
      .next()
      .then(async ({ task }) => {
        if (task && task.assigned_to == null) {
          await reviewTaskService.assign(task.review_id).catch(() => {});
        }
        if (active) {
          setTask(task);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load next task');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadNext = async () => {
    setLoading(true);
    setError(null);
    setSkills({});
    setComment('');
    try {
      const { task } = await reviewTaskService.next();
      if (task && task.assigned_to == null) {
        await reviewTaskService.assign(task.review_id).catch(() => {});
      }
      setTask(task);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load next task');
    } finally {
      setLoading(false);
    }
  };

  const submit = async (decision: ReviewDecision) => {
    if (!task) return;
    let breakdown: Partial<Record<ReviewSkill, number>> | undefined;
    if (decision !== 'rejected') {
      const parsed: Partial<Record<ReviewSkill, number>> = {};
      for (const { key } of SKILLS) {
        const raw = skills[key]?.trim();
        const n = raw ? Number(raw) : NaN;
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          setError('Enter every skill score (0–100) before approving or revising.');
          return;
        }
        parsed[key] = Math.round(n);
      }
      breakdown = parsed;
    }

    setBusy(true);
    setError(null);
    try {
      await reviewTaskService.submit(task.review_id, {
        decision,
        score_breakdown: breakdown,
        note: comment.trim() || undefined,
      });
      onSubmitted();
      await loadNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review');
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500">You are handed one task at a time, by priority.</p>
        <button
          onClick={loadNext}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
        >
          Skip / Next
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : !task ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
          No tasks pending review. 🎉
        </p>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">
                {task.task_type ?? 'review'} · {task.level ?? '—'} · {task.topic ?? '—'}
              </p>
              <p className="font-medium text-slate-800">Attempt {task.lesson_attempt_id.slice(0, 8)}</p>
              {task.review_reason && (
                <p className="mt-1 text-xs text-amber-700">Reason: {task.review_reason}</p>
              )}
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
              AI score: {task.ai_score_snapshot?.ai_score ?? '—'}
            </span>
          </div>

          <div className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Learner audio
            </p>
            {task.audio_turns && task.audio_turns.length > 0 ? (
              <ul className="space-y-2">
                {task.audio_turns.map((t) => (
                  <AudioTurnRow key={t.id} turn={t} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">No audio saved for this attempt.</p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {SKILLS.map(({ key, label }) => (
              <label key={key} className="text-sm">
                <span className="mb-1 block text-slate-600">{label}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={skills[key] ?? ''}
                  onChange={(e) => setSkills((s) => ({ ...s, [key]: e.target.value }))}
                  placeholder={String(task.ai_score_snapshot?.breakdown?.[key] ?? '0–100')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            ))}
          </div>

          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-slate-600">Comment</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Feedback for the learner (optional)"
            />
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() => submit('approved')}
              className="rounded-lg bg-[#4A6741] px-4 py-2 text-sm font-medium text-white hover:bg-[#3c5635] disabled:opacity-50"
            >
              {busy ? '…' : 'Approve'}
            </button>
            <button
              disabled={busy}
              onClick={() => submit('revised')}
              className="rounded-lg border border-[#4A6741] px-4 py-2 text-sm font-medium text-[#4A6741] hover:bg-[#eef3ea] disabled:opacity-50"
            >
              Revise score
            </button>
            <button
              disabled={busy}
              onClick={() => submit('rejected')}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Reject (redo)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── History ──────────────────────────────────────────────────────────────────
function HistoryTab() {
  const [period, setPeriod] = useState<ReviewPeriod>('month');
  const [items, setItems] = useState<TeacherHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    reviewTaskService
      .history({ period, limit: 100 })
      .then((res) => {
        if (active) {
          setItems(res.items);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load history');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [period]);

  return (
    <div>
      <PeriodFilter period={period} onChange={setPeriod} />
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Student</th>
              <th className="px-4 py-3 font-medium">Lesson</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Score</th>
              <th className="px-4 py-3 font-medium">Decision</th>
              <th className="px-4 py-3 font-medium">Rating</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No reviews in this period.</td></tr>
            ) : (
              items.map((it) => (
                <tr key={it.review_id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-600">{dateFmt(it.completed_at ?? it.reviewed_at)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{it.student?.name ?? '—'}</p>
                    <p className="text-xs text-slate-500">{it.student?.email ?? ''}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-slate-800">{it.lesson?.title ?? '—'}</p>
                    <p className="text-xs text-slate-500">{it.lesson?.level ?? ''} {it.lesson?.topic ? `· ${it.lesson.topic}` : ''}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{it.task_type ?? '—'}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{it.final_score ?? it.human_score ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${decisionClasses(it.decision)}`}>
                      {it.decision}
                    </span>
                  </td>
                  <td className="px-4 py-3"><Stars rating={it.rating} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Analytics ────────────────────────────────────────────────────────────────
function AnalyticsTab({ stats }: { stats: TeacherStats | null }) {
  if (!stats) return <p className="text-slate-500">Loading…</p>;
  const dist = stats.rating_distribution ?? {};
  const distMax = Math.max(1, ...Object.values(dist));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <BarCard title="Completed per day (last 14)" data={stats.daily} />
      <BarCard title="Completed per month (last 12)" data={stats.monthly} />
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Rating distribution</p>
        <p className="mb-3 text-sm text-slate-600">
          Average <span className="font-semibold text-slate-900">{stats.rating_count ? stats.average_rating : '—'}</span>
          {stats.rating_count ? ' ★' : ''} · {numberFmt(stats.rating_count)} rating{stats.rating_count === 1 ? '' : 's'}
        </p>
        <div className="grid gap-2">
          {['5', '4', '3', '2', '1'].map((star) => {
            const count = dist[star] ?? 0;
            return (
              <div key={star} className="flex items-center gap-2">
                <span className="w-8 text-xs font-medium text-slate-500">{star} ★</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${(count / distMax) * 100}%` }} />
                </div>
                <span className="w-8 text-right text-xs tabular-nums text-slate-600">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
      <BarCard title="Completed per year" data={stats.yearly} />
    </div>
  );
}

function BarCard({ title, data }: { title: string; data: { bucket: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {data.length === 0 ? (
        <p className="text-sm text-slate-400">No data yet.</p>
      ) : (
        <div className="flex h-32 items-end gap-1 overflow-x-auto">
          {data.map((d) => (
            <div key={d.bucket} className="flex min-w-[14px] flex-1 flex-col items-center gap-1" title={`${d.bucket}: ${d.count}`}>
              <div
                className="w-full rounded-t bg-[#4A6741]"
                style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }}
              />
              <span className="w-full truncate text-center text-[9px] text-slate-400">{d.bucket.slice(5)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Student feedback ─────────────────────────────────────────────────────────
function FeedbackTab() {
  const [period, setPeriod] = useState<ReviewPeriod>('all');
  const [items, setItems] = useState<TeacherFeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    reviewTaskService
      .feedback({ period, limit: 100 })
      .then((res) => {
        if (active) {
          setItems(res.items);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load feedback');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [period]);

  return (
    <div>
      <PeriodFilter period={period} onChange={setPeriod} />
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}
      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
          No student feedback yet.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((f) => (
            <div key={f.review_id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <Stars rating={f.rating} />
                <span className="text-xs text-slate-400">{dateFmt(f.created_at)}</span>
              </div>
              {f.comment && <p className="mt-2 text-sm text-slate-700">“{f.comment}”</p>}
              <p className="mt-2 text-xs text-slate-500">
                {f.student?.name ?? 'Student'} · {f.lesson?.title ?? 'Lesson'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PeriodFilter({ period, onChange }: { period: ReviewPeriod; onChange: (p: ReviewPeriod) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={`rounded-full px-3 py-1 text-sm ${
            period === p.value ? 'bg-[#4A6741] text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-100'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// One saved user-audio turn. Fetches a short-lived signed URL on demand (the
// bucket is private; URLs are never embedded in the task payload).
function AudioTurnRow({ turn }: { turn: AudioTurn }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (url || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { url } = await reviewTaskService.audioPlayUrl(turn.id);
      setUrl(url);
    } catch {
      setError('Could not load audio');
    } finally {
      setLoading(false);
    }
  };

  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">
          Turn {turn.turn_index != null ? turn.turn_index + 1 : '—'}
        </span>
        {!url && (
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load audio'}
          </button>
        )}
      </div>
      {turn.transcript && <p className="mb-2 text-sm text-slate-700">“{turn.transcript}”</p>}
      {url && <audio controls preload="none" src={url} className="w-full" />}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </li>
  );
}
