'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/auth-context';
import { homePathForRole } from '@/lib/roles';
import type { ReactNode } from 'react';

// Reviewer surface. Teachers and admins may enter; students are bounced back to
// their own home. Mirrors the (main) auth guard but adds a role check so the
// learner dashboard and the reviewer screen never share a layout.
export default function TeacherLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, role } = useAuthContext();
  const router = useRouter();

  const allowed = role === 'teacher' || role === 'admin';

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/login');
    } else if (!allowed) {
      router.replace(homePathForRole(role));
    }
  }, [isLoading, isAuthenticated, allowed, role, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="w-8 h-8 rounded-full border-2 border-[#4A6741] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated || !allowed) return null;

  return <div className="min-h-screen bg-slate-50">{children}</div>;
}
