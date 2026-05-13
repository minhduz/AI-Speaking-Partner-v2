'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/shared/logo/logo';
import { sessionService } from '@/services/session.service';
import type { SidebarProps } from './sidebar.types';
import type { SessionSummary } from '@/types/session.types';

const PAGE_LIMIT = 25;

export function Sidebar({ onNewChat, onLogout, currentSessionId, refreshKey = 0 }: SidebarProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);

  const fetchSessions = useCallback(async (reset = false) => {
    if (loadingRef.current) return;
    if (!reset && !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const pageNum = reset ? 1 : pageRef.current + 1;
    try {
      const data = await sessionService.list(pageNum, PAGE_LIMIT);
      setSessions((prev) => (reset ? data.items : [...prev, ...data.items]));
      hasMoreRef.current = data.hasMore;
      pageRef.current = pageNum;
    } catch (err) {
      console.error('[sidebar sessions]', err);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  // Fetch on mount and whenever refreshKey changes (new session created)
  useEffect(() => {
    fetchSessions(true);
  }, [refreshKey, fetchSessions]);

  // Lazy load more when sentinel scrolls into view
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) fetchSessions();
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [fetchSessions]);

  const groups = groupByDate(sessions);

  return (
    <aside className="flex flex-col w-60 shrink-0 bg-white border-r border-[#F0EDE7] h-full">
      <div className="px-5 pt-6 pb-4">
        <Logo size="md" />
        <p className="text-xs text-gray-400 mt-0.5 ml-8">AI Speaking Mentor</p>
      </div>

      <div className="px-4 mb-4">
        <button
          onClick={onNewChat}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-[#4A6741] text-white text-sm font-medium hover:bg-[#3D5535] transition-colors"
        >
          <span className="text-lg leading-none">+</span>
          New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-gray-400 uppercase mb-2 px-1">
          History
        </p>

        {sessions.length === 0 && !loading && (
          <p className="text-xs text-gray-400 px-1 py-2">No conversations yet.</p>
        )}

        <nav className="flex flex-col">
          {groups.map((group) => (
            <div key={group.label} className="mb-1">
              <p className="text-[10px] font-medium text-gray-400 uppercase px-1 py-1.5 tracking-wide">
                {group.label}
              </p>
              {group.items.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === currentSessionId}
                />
              ))}
            </div>
          ))}
        </nav>

        {loading && (
          <div className="flex justify-center py-3">
            <div className="w-4 h-4 rounded-full border-2 border-[#4A6741] border-t-transparent animate-spin" />
          </div>
        )}

        <div ref={sentinelRef} className="h-1" />
      </div>

      <div className="px-4 pb-6 border-t border-[#F0EDE7] pt-4 flex flex-col gap-1">
        <Link
          href="/flashcards"
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <FlashcardIcon />
          Flashcards
        </Link>
        <Link
          href="/profile"
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <UserIcon />
          Profile
        </Link>
        <Link
          href="/settings"
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <SettingsIcon />
          Settings
        </Link>
        <button
          onClick={onLogout}
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-gray-500 hover:bg-gray-50 hover:text-red-500 transition-colors mt-1"
        >
          <LogoutIcon />
          Sign out
        </button>
      </div>
    </aside>
  );
}

function SessionItem({ session, active }: { session: SessionSummary; active: boolean }) {
  return (
    <button
      className={`flex flex-col w-full px-3 py-2 rounded-xl text-sm text-left transition-colors gap-0.5 ${
        active ? 'bg-[#4A6741]/10 text-[#4A6741]' : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      <span className="truncate font-medium leading-snug">
        {session.title ?? 'New conversation'}
      </span>
    </button>
  );
}

function groupByDate(sessions: SessionSummary[]): { label: string; items: SessionSummary[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;

  const groups = [
    { label: 'Today', items: [] as SessionSummary[] },
    { label: 'Yesterday', items: [] as SessionSummary[] },
    { label: 'Older', items: [] as SessionSummary[] },
  ];

  for (const session of sessions) {
    const d = new Date(session.startedAt);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (day >= today) {
      groups[0].items.push(session);
    } else if (day >= yesterday) {
      groups[1].items.push(session);
    } else {
      groups[2].items.push(session);
    }
  }

  return groups.filter((g) => g.items.length > 0);
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
