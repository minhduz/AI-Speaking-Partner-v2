'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { adminService, type AdminUserDetail } from '@/services/admin.service';

function numberFmt(value: number | undefined) {
  return new Intl.NumberFormat('en-US').format(value ?? 0);
}

function moneyFmt(value: number | undefined) {
  return `$${(value ?? 0).toFixed(4)}`;
}

function dateFmt(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    adminService
      .getUserDetail(params.id)
      .then((data) => {
        if (!active) return;
        setDetail(data);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load user');
      });
    return () => {
      active = false;
    };
  }, [params.id]);

  const user = detail?.user;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">{user?.name ?? 'User detail'}</h1>
        <Link href="/admin/users" className="text-sm text-[#4A6741] hover:underline">
          Back to users
        </Link>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {!detail ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-400 shadow-sm">
          Loading...
        </div>
      ) : (
        <>
          <section className="mb-6 grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</p>
              <p className="mt-2 break-all text-sm font-medium text-slate-900">{detail.user.email}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Role</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{detail.user.role}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tokens</p>
              <p className="mt-2 text-sm font-medium text-slate-900">
                {numberFmt(detail.user.total_tokens)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Est. cost</p>
              <p className="mt-2 text-sm font-medium text-slate-900">
                {moneyFmt(detail.user.estimated_cost_usd)}
              </p>
            </div>
          </section>

          <section className="mb-6 rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="font-medium text-slate-900">Recent sessions</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Title</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Mode</th>
                    <th className="px-4 py-3 font-medium">Tokens</th>
                    <th className="px-4 py-3 font-medium">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.sessions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                        No sessions yet.
                      </td>
                    </tr>
                  ) : (
                    detail.sessions.map((session) => (
                      <tr key={session.id} className="border-t border-slate-100">
                        <td className="px-4 py-3 text-slate-900">
                          {session.title ?? 'Untitled session'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{session.status}</td>
                        <td className="px-4 py-3 text-slate-600">{session.mode}</td>
                        <td className="px-4 py-3 text-slate-600">{numberFmt(session.total_tokens)}</td>
                        <td className="px-4 py-3 text-slate-600">{dateFmt(session.started_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-6 rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="font-medium text-slate-900">Lesson attempts</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Lesson</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Scoring</th>
                    <th className="px-4 py-3 font-medium">Score</th>
                    <th className="px-4 py-3 font-medium">Final</th>
                    <th className="px-4 py-3 font-medium">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.attempts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                        No lesson attempts yet.
                      </td>
                    </tr>
                  ) : (
                    detail.attempts.map((attempt) => (
                      <tr key={attempt.id} className="border-t border-slate-100">
                        <td className="px-4 py-3 text-slate-900">
                          {attempt.lesson_title ?? attempt.lesson_id}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{attempt.status}</td>
                        <td className="px-4 py-3 text-slate-600">{attempt.scoring_status}</td>
                        <td className="px-4 py-3 text-slate-600">{attempt.score ?? '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{attempt.final_score ?? '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{dateFmt(attempt.completed_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="font-medium text-slate-900">Review tasks</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Lesson</th>
                    <th className="px-4 py-3 font-medium">Task</th>
                    <th className="px-4 py-3 font-medium">Teacher</th>
                    <th className="px-4 py-3 font-medium">Final score</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.reviews.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                        No review tasks yet.
                      </td>
                    </tr>
                  ) : (
                    detail.reviews.map((review) => (
                      <tr key={review.id} className="border-t border-slate-100">
                        <td className="px-4 py-3 text-slate-900">
                          {review.lesson_title ?? 'Unknown lesson'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {review.task_status} / {review.task_type ?? 'practice'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {review.assigned_teacher?.name ?? '-'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{review.final_score ?? '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{dateFmt(review.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
