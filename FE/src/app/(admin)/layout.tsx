'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/auth-context';
import { homePathForRole } from '@/lib/roles';
import type { ReactNode } from 'react';

// Admin console. Admins only; everyone else is redirected to their own home.
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, role } = useAuthContext();
  const router = useRouter();

  const allowed = role === 'admin';

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
