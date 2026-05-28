'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { adminService, type AdminUser, type CreateUserPayload } from '@/services/admin.service';
import type { UserRole } from '@/types/auth.types';

const ROLE_FILTERS: { value: UserRole | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'student', label: 'Students' },
  { value: 'teacher', label: 'Teachers' },
  { value: 'admin', label: 'Admins' },
];

const EMPTY_FORM: CreateUserPayload = { email: '', password: '', name: '', role: 'teacher' };

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

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateUserPayload>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await adminService.listUsers({
        role: roleFilter === 'all' ? undefined : roleFilter,
        q: query.trim() || undefined,
      });
      setUsers(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [roleFilter, query]);

  useEffect(() => {
    let active = true;
    adminService
      .listUsers({
        role: roleFilter === 'all' ? undefined : roleFilter,
        q: query.trim() || undefined,
      })
      .then((list) => {
        if (!active) return;
        setUsers(list);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load users');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [roleFilter, query]);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const created = await adminService.createUser(form);
      setNotice(`Created ${created.role} account for ${created.email}`);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const changeRole = async (id: string, role: UserRole) => {
    setError(null);
    try {
      const updated = await adminService.updateRole(id, role);
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...updated } : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
          <Link href="/admin" className="text-sm text-[#4A6741] hover:underline">
            Back to console
          </Link>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {notice}
        </div>
      )}

      <form
        onSubmit={createUser}
        className="mb-8 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 className="mb-3 font-medium text-slate-900">Create staff account</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <input
            required
            type="text"
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            type="password"
            minLength={6}
            placeholder="Password (min 6)"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={form.role}
            onChange={(e) =>
              setForm((f) => ({ ...f, role: e.target.value as CreateUserPayload['role'] }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="teacher">Teacher</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={creating}
          className="mt-3 rounded-lg bg-[#4A6741] px-4 py-2 text-sm font-medium text-white hover:bg-[#3c5635] disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create account'}
        </button>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {ROLE_FILTERS.map((r) => (
          <button
            key={r.value}
            onClick={() => setRoleFilter(r.value)}
            className={`rounded-full px-3 py-1 text-sm ${
              roleFilter === r.value
                ? 'bg-[#4A6741] text-white'
                : 'border border-slate-300 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {r.label}
          </button>
        ))}
        <input
          type="search"
          placeholder="Search email or name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Sessions</th>
              <th className="px-4 py-3 font-medium">Tokens</th>
              <th className="px-4 py-3 font-medium">Est. cost</th>
              <th className="px-4 py-3 font-medium">Last active</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Loading...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-800">
                    <Link href={`/admin/users/${u.id}`} className="font-medium hover:text-[#4A6741]">
                      {u.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u.id, e.target.value as UserRole)}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="student">student</option>
                      <option value="teacher">teacher</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{numberFmt(u.session_count)}</td>
                  <td className="px-4 py-3 text-slate-600">{numberFmt(u.total_tokens)}</td>
                  <td className="px-4 py-3 text-slate-600">{moneyFmt(u.estimated_cost_usd)}</td>
                  <td className="px-4 py-3 text-slate-600">{dateFmt(u.last_active_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
