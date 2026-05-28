'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  adminService,
  type AdminReviewTask,
  type AdminTeacher,
} from '@/services/admin.service';

function dateFmt(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function scoreFmt(value: number | null | undefined) {
  return value == null ? '-' : String(value);
}

function statusClasses(status: string) {
  if (status === 'completed') return 'bg-green-50 text-green-700 ring-green-200';
  if (status === 'assigned') return 'bg-blue-50 text-blue-700 ring-blue-200';
  if (status === 'escalated') return 'bg-amber-50 text-amber-700 ring-amber-200';
  if (status === 'cancelled') return 'bg-slate-100 text-slate-500 ring-slate-200';
  return 'bg-slate-50 text-slate-700 ring-slate-200';
}

export default function AdminReviewsPage() {
  const [tasks, setTasks] = useState<AdminReviewTask[]>([]);
  const [teachers, setTeachers] = useState<AdminTeacher[]>([]);
  const [status, setStatus] = useState<'all' | 'open' | 'completed'>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([adminService.listReviews(), adminService.listTeachers()])
      .then(([reviewTasks, teacherList]) => {
        if (!active) return;
        setTasks(reviewTasks);
        setTeachers(teacherList);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load reviews');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredTasks = useMemo(() => {
    if (status === 'completed') return tasks.filter((task) => task.task_status === 'completed');
    if (status === 'open') {
      return tasks.filter((task) => !['completed', 'cancelled'].includes(task.task_status));
    }
    return tasks;
  }, [tasks, status]);

  const assign = async (taskId: string, teacherId: string | null) => {
    setSavingId(taskId);
    setError(null);
    try {
      const updated = await adminService.assignReview(taskId, teacherId);
      setTasks(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign review');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Review assignments</h1>
          <Link href="/admin" className="text-sm text-[#4A6741] hover:underline">
            Back to console
          </Link>
        </div>
        <Link
          href="/teacher"
          className="rounded-lg bg-[#4A6741] px-3 py-2 text-sm font-medium text-white hover:bg-[#3c5635]"
        >
          Open reviewer view
        </Link>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 flex gap-2">
        {[
          { value: 'open', label: 'Open' },
          { value: 'completed', label: 'Completed' },
          { value: 'all', label: 'All' },
        ].map((item) => (
          <button
            key={item.value}
            onClick={() => setStatus(item.value as typeof status)}
            className={`rounded-full px-3 py-1 text-sm ${
              status === item.value
                ? 'bg-[#4A6741] text-white'
                : 'border border-slate-300 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Task</th>
              <th className="px-4 py-3 font-medium">Student</th>
              <th className="px-4 py-3 font-medium">Lesson</th>
              <th className="px-4 py-3 font-medium">Scores</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium">Due</th>
              <th className="px-4 py-3 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Loading...
                </td>
              </tr>
            ) : filteredTasks.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No review tasks.
                </td>
              </tr>
            ) : (
              filteredTasks.map((task) => (
                <tr key={task.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusClasses(
                        task.task_status,
                      )}`}
                    >
                      {task.task_status}
                    </span>
                    <p className="mt-2 text-xs uppercase tracking-wide text-slate-400">
                      {task.task_type ?? 'practice'} / priority {task.priority}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {task.student.id ? (
                      <Link
                        href={`/admin/users/${task.student.id}`}
                        className="font-medium text-slate-900 hover:text-[#4A6741]"
                      >
                        {task.student.name ?? 'Unknown student'}
                      </Link>
                    ) : (
                      <span className="font-medium text-slate-900">Unknown student</span>
                    )}
                    <p className="text-xs text-slate-500">{task.student.email ?? '-'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{task.lesson?.title ?? 'Unknown lesson'}</p>
                    <p className="text-xs text-slate-500">
                      {task.lesson?.level ?? '-'} / {task.lesson?.topic ?? '-'} / session{' '}
                      {task.attempt?.session_id?.slice(0, 8) ?? '-'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <p>AI {scoreFmt(task.ai_score)}</p>
                    <p>Final {scoreFmt(task.final_score)}</p>
                  </td>
                  <td className="px-4 py-3">
                    {/* Explicit owner text — never derived solely from the select,
                        so an assigned task can't silently read as "Unassigned". */}
                    {task.assigned_to ? (
                      <p className="text-sm font-medium text-slate-800">
                        {task.assigned_teacher
                          ? task.assigned_teacher.name
                          : `Assigned: ${task.assigned_to.slice(0, 8)}`}
                        {task.assigned_teacher?.email && (
                          <span className="block text-xs font-normal text-slate-500">
                            {task.assigned_teacher.email}
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="text-sm text-slate-400">Unassigned</p>
                    )}
                    <select
                      value={task.assigned_to ?? ''}
                      disabled={savingId === task.id || ['completed', 'cancelled'].includes(task.task_status)}
                      onChange={(e) => assign(task.id, e.target.value || null)}
                      className="mt-1 w-56 rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
                    >
                      <option value="">Unassigned</option>
                      {/* Keep the current assignee selectable even if they're not
                          in the teachers list (e.g. role changed), so the select
                          reflects assigned_to instead of falling back to blank. */}
                      {task.assigned_to &&
                        !teachers.some((t) => t.id === task.assigned_to) && (
                          <option value={task.assigned_to}>
                            {task.assigned_teacher?.name ?? `Assigned: ${task.assigned_to.slice(0, 8)}`}
                          </option>
                        )}
                      {teachers.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.name} ({teacher.role})
                        </option>
                      ))}
                    </select>
                    {task.reviewer && (
                      <p className="mt-1 text-xs text-slate-500">Reviewed by {task.reviewer.name}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{dateFmt(task.due_at)}</td>
                  <td className="px-4 py-3 text-slate-600">{task.review_reason ?? '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
