'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { adminService, type AdminUsage } from '@/services/admin.service';

function numberFmt(value: number | undefined) {
  return new Intl.NumberFormat('en-US').format(value ?? 0);
}

function moneyFmt(value: number | undefined) {
  return `$${(value ?? 0).toFixed(4)}`;
}

function dateFmt(value?: string | null) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function AdminUsagePage() {
  const [usage, setUsage] = useState<AdminUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    adminService
      .usage()
      .then((data) => {
        if (!active) return;
        setUsage(data);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load usage');
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Usage and cost</h1>
        <Link href="/admin" className="text-sm text-[#4A6741] hover:underline">
          Back to console
        </Link>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total tokens</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {numberFmt(usage?.summary.total_tokens)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rate per 1K</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {moneyFmt(usage?.summary.rate_per_1k_tokens_usd)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated cost</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {moneyFmt(usage?.summary.estimated_cost_usd)}
          </p>
        </div>
      </div>

      {usage?.summary.rate_per_1k_tokens_usd === 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Set ADMIN_LLM_COST_PER_1K_TOKENS_USD in the backend env to turn token counts into spend.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Sessions</th>
              <th className="px-4 py-3 font-medium">Tokens</th>
              <th className="px-4 py-3 font-medium">Est. cost</th>
              <th className="px-4 py-3 font-medium">Last active</th>
            </tr>
          </thead>
          <tbody>
            {!usage ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Loading...
                </td>
              </tr>
            ) : usage.users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  No usage yet.
                </td>
              </tr>
            ) : (
              usage.users.map((row) => (
                <tr key={row.user.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/users/${row.user.id}`}
                      className="font-medium text-slate-900 hover:text-[#4A6741]"
                    >
                      {row.user.name ?? row.user.id}
                    </Link>
                    <p className="text-xs text-slate-500">{row.user.email ?? '-'}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.user.role ?? '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{numberFmt(row.session_count)}</td>
                  <td className="px-4 py-3 text-slate-600">{numberFmt(row.total_tokens)}</td>
                  <td className="px-4 py-3 text-slate-600">{moneyFmt(row.estimated_cost_usd)}</td>
                  <td className="px-4 py-3 text-slate-600">{dateFmt(row.last_active_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
