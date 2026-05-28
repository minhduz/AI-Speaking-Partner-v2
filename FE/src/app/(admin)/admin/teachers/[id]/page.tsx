'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { adminService, type AdminTeacherDetail } from '@/services/admin.service';

function numberFmt(value: number | undefined) {
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

function BarCard({ title, data }: { title: string; data: { bucket: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {data.length === 0 ? (
        <p className="text-sm text-slate-400">No data yet.</p>
      ) : (
        <div className="flex h-28 items-end gap-1 overflow-x-auto">
          {data.map((d) => (
            <div key={d.bucket} className="flex min-w-[14px] flex-1 flex-col items-center gap-1" title={`${d.bucket}: ${d.count}`}>
              <div className="w-full rounded-t bg-[#4A6741]" style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} />
              <span className="w-full truncate text-center text-[9px] text-slate-400">{d.bucket.slice(5)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminTeacherDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AdminTeacherDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    adminService
      .getTeacherDetail(params.id)
      .then((data) => {
        if (!active) return;
        setDetail(data);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load teacher');
      });
    return () => {
      active = false;
    };
  }, [params.id]);

  const q = detail?.queue;
  const stats = detail?.stats;
  const dist = stats?.rating_distribution ?? {};
  const distMax = Math.max(1, ...Object.values(dist));

  const chips = [
    { label: 'Assigned open', value: numberFmt(q?.assigned_open) },
    { label: 'Overdue', value: numberFmt(q?.overdue) },
    { label: 'Done today', value: numberFmt(q?.completed_today) },
    { label: 'Done month', value: numberFmt(q?.completed_this_month) },
    { label: 'Done year', value: numberFmt(q?.completed_this_year) },
    { label: 'Avg rating', value: stats?.rating_count ? `${stats.average_rating} ★` : '—' },
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">{detail?.teacher?.name ?? 'Teacher detail'}</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500">{detail?.teacher?.email}</span>
          <Link href="/admin/teachers" className="text-[#4A6741] hover:underline">Back to teachers</Link>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {!detail ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-400 shadow-sm">Loading…</div>
      ) : (
        <>
          <section className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {chips.map((c) => (
              <div key={c.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <p className="text-lg font-semibold text-slate-900">{c.value}</p>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
              </div>
            ))}
          </section>

          <section className="mb-6 grid gap-4 lg:grid-cols-2">
            <BarCard title="Completed per day (last 14)" data={stats?.daily ?? []} />
            <BarCard title="Completed per month (last 12)" data={stats?.monthly ?? []} />
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Rating distribution</p>
              <p className="mb-3 text-sm text-slate-600">
                Average <span className="font-semibold text-slate-900">{stats?.rating_count ? stats.average_rating : '—'}</span>
                {stats?.rating_count ? ' ★' : ''} · {numberFmt(stats?.rating_count)} rating{stats?.rating_count === 1 ? '' : 's'}
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
            <BarCard title="Completed per year" data={stats?.yearly ?? []} />
          </section>

          <section className="mb-6 rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="font-medium text-slate-900">Review history</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Student</th>
                    <th className="px-4 py-3 font-medium">Lesson</th>
                    <th className="px-4 py-3 font-medium">Score</th>
                    <th className="px-4 py-3 font-medium">Decision</th>
                    <th className="px-4 py-3 font-medium">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.history.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No reviews yet.</td></tr>
                  ) : (
                    detail.history.map((it) => (
                      <tr key={it.review_id} className="border-t border-slate-100">
                        <td className="px-4 py-3 text-slate-600">{dateFmt(it.completed_at ?? it.reviewed_at)}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{it.student?.name ?? '—'}</p>
                          <p className="text-xs text-slate-500">{it.student?.email ?? ''}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-800">{it.lesson?.title ?? '—'}</td>
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
          </section>

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="font-medium text-slate-900">Student feedback</h2>
            </div>
            <div className="p-4">
              {detail.feedback.length === 0 ? (
                <p className="text-sm text-slate-400">No student feedback yet.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {detail.feedback.map((f) => (
                    <div key={f.review_id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
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
          </section>
        </>
      )}
    </div>
  );
}
