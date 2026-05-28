'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { adminService, type AdminTeacher } from '@/services/admin.service';

function numberFmt(value: number | undefined) {
  return new Intl.NumberFormat('en-US').format(value ?? 0);
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

export default function AdminTeachersPage() {
  const [teachers, setTeachers] = useState<AdminTeacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    adminService
      .listTeachers()
      .then((list) => {
        if (!active) return;
        setTeachers(list);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load teachers');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Teachers</h1>
          <Link href="/admin" className="text-sm text-[#4A6741] hover:underline">
            Back to console
          </Link>
        </div>
        <Link
          href="/admin/users"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          Create teacher
        </Link>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Teacher</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Open</th>
              <th className="px-4 py-3 font-medium">Overdue</th>
              <th className="px-4 py-3 font-medium">Completed</th>
              <th className="px-4 py-3 font-medium">Today</th>
              <th className="px-4 py-3 font-medium">Month</th>
              <th className="px-4 py-3 font-medium">Avg rating</th>
              <th className="px-4 py-3 font-medium">Last active</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-slate-400">
                  Loading...
                </td>
              </tr>
            ) : teachers.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-slate-400">
                  No teachers yet.
                </td>
              </tr>
            ) : (
              teachers.map((teacher) => (
                <tr key={teacher.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/teachers/${teacher.id}`}
                      className="font-medium text-slate-900 hover:text-[#4A6741]"
                    >
                      {teacher.name}
                    </Link>
                    <p className="text-xs text-slate-500">{teacher.email}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{teacher.role}</td>
                  <td className="px-4 py-3 text-slate-600">{numberFmt(teacher.open_reviews)}</td>
                  <td className="px-4 py-3 text-slate-600">{numberFmt(teacher.overdue_reviews)}</td>
                  <td className="px-4 py-3 text-slate-600">{numberFmt(teacher.completed_reviews)}</td>
                  <td className="px-4 py-3 text-slate-600">{numberFmt(teacher.completed_today)}</td>
                  <td className="px-4 py-3 text-slate-600">{numberFmt(teacher.completed_this_month)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {teacher.rating_count ? `${teacher.average_rating} ★ (${teacher.rating_count})` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{dateFmt(teacher.last_active_at)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/teachers/${teacher.id}`} className="text-sm text-[#4A6741] hover:underline">
                      Detail
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
