'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarChart3, ClipboardList, GraduationCap, Users } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { adminService, type AdminDashboard } from '@/services/admin.service';

function numberFmt(value: number | undefined) {
  return new Intl.NumberFormat('en-US').format(value ?? 0);
}

function moneyFmt(value: number | undefined) {
  return `$${(value ?? 0).toFixed(4)}`;
}

export default function AdminHomePage() {
  const { handleLogout } = useAuth();
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    adminService
      .dashboard()
      .then((data) => {
        if (!active) return;
        setDashboard(data);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load admin dashboard');
      });
    return () => {
      active = false;
    };
  }, []);

  const nav = [
    {
      href: '/admin/users',
      title: 'Users',
      text: 'Students, staff accounts, roles, and learner details.',
      icon: Users,
    },
    {
      href: '/admin/teachers',
      title: 'Teachers',
      text: 'Reviewer workload, open tasks, overdue tasks, and completion counts.',
      icon: GraduationCap,
    },
    {
      href: '/admin/reviews',
      title: 'Review assignments',
      text: 'See every review task, which learner submitted it, and who owns it.',
      icon: ClipboardList,
    },
    {
      href: '/admin/usage',
      title: 'Usage and cost',
      text: 'Track token usage by learner and estimate spend from your configured rate.',
      icon: BarChart3,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Admin console</h1>
          <p className="text-sm text-slate-500">
            Operations, review assignment, learner usage, and staff management.
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
        >
          Log out
        </button>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Users</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {numberFmt(dashboard?.users.total)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {numberFmt(dashboard?.users.students)} students, {numberFmt(dashboard?.users.teachers)} teachers
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sessions</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {numberFmt(dashboard?.sessions.total)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {numberFmt(dashboard?.sessions.today)} today, {numberFmt(dashboard?.sessions.month)} this month
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Review queue</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {numberFmt((dashboard?.reviews.pending ?? 0) + (dashboard?.reviews.assigned ?? 0))}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {numberFmt(dashboard?.reviews.overdue)} overdue
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated spend</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {moneyFmt(dashboard?.usage.estimated_cost_usd)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {numberFmt(dashboard?.usage.total_tokens)} tokens
          </p>
        </div>
      </div>

      {dashboard?.usage.rate_per_1k_tokens_usd === 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Cost estimates are disabled. Set ADMIN_LLM_COST_PER_1K_TOKENS_USD in the backend env to show spend.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-[#4A6741] hover:shadow-md"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[#E5F8CF] text-[#2F6B12]">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="mb-1 font-medium text-slate-900">{item.title}</h2>
              <p className="text-sm text-slate-500">{item.text}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
