'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Mic,
  LayoutGrid,
  CreditCard,
  Settings2,
  UserCircle,
  LogOut,
  Zap,
} from 'lucide-react';
import { sessionService } from '@/services/session.service';
import type { SidebarProps } from './sidebar.types';
import type { SessionSummary } from '@/types/session.types';

const PAGE_LIMIT = 25;

export function Sidebar({ onNewChat, onLogout, onSessionClick, currentSessionId, refreshKey = 0, titleUpdate }: SidebarProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const pathname = usePathname();

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

  useEffect(() => { fetchSessions(true); }, [refreshKey, fetchSessions]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) fetchSessions(); },
      { threshold: 0.1 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [fetchSessions]);

  const displayedSessions = useMemo(() => {
    if (!titleUpdate) return sessions;
    return sessions.map((s) =>
      s.id === titleUpdate.sessionId ? { ...s, title: titleUpdate.title } : s,
    );
  }, [sessions, titleUpdate]);

  const groups = groupByDate(displayedSessions);

  const isChat       = pathname === '/chat' || (pathname?.startsWith('/chat') ?? false);
  const isFlashcards = pathname?.startsWith('/flashcards') ?? false;
  const isBilling    = pathname?.startsWith('/billing') ?? false;
  const isSettings   = pathname?.startsWith('/settings') ?? false;
  const isProfile    = pathname?.startsWith('/profile') ?? false;

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP SIDEBAR — hidden on mobile, visible lg+
          ═══════════════════════════════════════════════════════════ */}
      <aside
        className="hidden lg:flex flex-col w-64 shrink-0 h-full min-h-0 py-6"
        style={{ background: '#ffffff', borderRight: '2px solid #e2e2e2' }}
      >
        {/* Logo */}
        <div className="px-6 mb-8">
          <h1 className="text-2xl font-black" style={{ fontFamily: 'Lexend, sans-serif', color: '#2b6c00', letterSpacing: '-0.01em' }}>
            SpeakUp
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#6f7b64', fontWeight: 500 }}>AI Speaking Mentor</p>
        </div>

        {/* Primary Nav */}
        <nav className="flex-1 min-h-0 space-y-1 px-2 overflow-y-auto pr-1">
          <NavLink label="Learn" icon={<Mic size={18} strokeWidth={2.5} />} iconBg="#dff5c5" iconColor="#2b6c00" active={isChat} onClick={onNewChat} />
          <Link href="/flashcards" className="block">
            <NavLink label="Flashcards" icon={<LayoutGrid size={18} strokeWidth={2.5} />} iconBg="#fff4cc" iconColor="#8c6e00" active={isFlashcards} />
          </Link>
          <Link href="/billing" className="block">
            <NavLink label="Billing" icon={<CreditCard size={18} strokeWidth={2.5} />} iconBg="#dceeff" iconColor="#004666" active={isBilling} />
          </Link>
          <Link href="/settings" className="block">
            <NavLink label="Settings" icon={<Settings2 size={18} strokeWidth={2.5} />} iconBg="#ffe9cc" iconColor="#683a00" active={isSettings} />
          </Link>
          <Link href="/profile" className="block">
            <NavLink label="Profile" icon={<UserCircle size={18} strokeWidth={2.5} />} iconBg="#d7ffb8" iconColor="#2b6c00" active={isProfile} />
          </Link>

          {/* Session history */}
          <div className="pt-4">
            <p className="px-4 pb-1 text-xs font-bold uppercase tracking-widest" style={{ color: '#becbb1' }}>History</p>
            {sessions.length === 0 && !loading && (
              <p className="px-4 py-2 text-xs" style={{ color: '#becbb1' }}>Your sessions will appear here.</p>
            )}
            <nav className="flex flex-col mt-1">
              {groups.map((group) => (
                <div key={group.label} className="mb-1">
                  <p className="px-4 py-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: '#becbb1' }}>{group.label}</p>
                  {group.items.map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      active={session.id === currentSessionId}
                      onClick={onSessionClick ? () => onSessionClick(session) : undefined}
                    />
                  ))}
                </div>
              ))}
            </nav>
            {loading && (
              <div className="flex justify-center py-3">
                <div className="w-4 h-4 rounded-full border-2 border-[#58cc02] border-t-transparent animate-spin" />
              </div>
            )}
            <div ref={sentinelRef} className="h-1" />
          </div>
        </nav>

        {/* Bottom: Premium + Sign Out */}
        <div className="px-4 mt-4 shrink-0">
          <Link href="/billing"><PremiumButton /></Link>
          <div className="mt-4 pt-4" style={{ borderTop: '2px solid #f1f1f1' }}>
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-200 hover:bg-[#ffecec] active:translate-y-1"
              style={{ background: '#fff5f5', color: '#9b1c1c', border: '2px solid #ffd6d6', boxShadow: '0 3px 0 #ffd6d6' }}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#ffe0e0', color: '#9b1c1c' }}>
                <LogOut size={18} strokeWidth={2.5} />
              </div>
              <span className="text-sm font-extrabold">Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ═══════════════════════════════════════════════════════════
          MOBILE BOTTOM NAV — floating pill, design-system style
          Shown on mobile only (lg:hidden)
          Sign-out lives in Profile page on mobile, not here.
          ═══════════════════════════════════════════════════════════ */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Floating pill container */}
        <div
          className="mx-3 mb-3 flex items-center justify-around px-2 py-2 rounded-[28px]"
          style={{
            background: '#ffffff',
            border: '2px solid #e2e2e2',
            boxShadow: '0 -2px 0 #e2e2e2, 0 8px 32px rgba(0,0,0,0.10)',
            fontFamily: 'Lexend, sans-serif',
          }}
        >
          {/* Learn — primary tab with mic emphasis */}
          <MobileTab
            label="Learn"
            icon={<Mic size={20} strokeWidth={2.5} />}
            iconBg="#dff5c5"
            iconColor="#2b6c00"
            active={isChat}
            onClick={onNewChat}
          />

          {/* Flashcards */}
          <Link href="/flashcards">
            <MobileTab
              label="Cards"
              icon={<LayoutGrid size={20} strokeWidth={2.5} />}
              iconBg="#fff4cc"
              iconColor="#8c6e00"
              active={isFlashcards}
            />
          </Link>

          {/* Billing */}
          <Link href="/billing">
            <MobileTab
              label="Premium"
              icon={<Zap size={20} strokeWidth={2.5} />}
              iconBg="#dceeff"
              iconColor="#004666"
              active={isBilling}
            />
          </Link>

          {/* Profile */}
          <Link href="/profile">
            <MobileTab
              label="Profile"
              icon={<UserCircle size={20} strokeWidth={2.5} />}
              iconBg="#d7ffb8"
              iconColor="#2b6c00"
              active={isProfile}
            />
          </Link>

          {/* Settings */}
          <Link href="/settings">
            <MobileTab
              label="Settings"
              icon={<Settings2 size={20} strokeWidth={2.5} />}
              iconBg="#ffe9cc"
              iconColor="#683a00"
              active={isSettings}
            />
          </Link>
        </div>
      </nav>
    </>
  );
}

/* ── MobileTab ── matches design system: colored icon badge + bold label ── */
function MobileTab({
  label, icon, iconBg, iconColor, active, onClick,
}: {
  label: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  active: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className="flex flex-col items-center gap-1 select-none"
      style={{ minWidth: 48, cursor: 'pointer' }}
    >
      {/* Icon badge — matches desktop sidebar treatment */}
      <span
        className="flex items-center justify-center rounded-[14px] transition-all duration-200"
        style={{
          width: 40, height: 40,
          background: active ? iconBg : 'transparent',
          color: active ? iconColor : '#afafaf',
          transform: active ? 'scale(1.08)' : 'scale(1)',
          transition: 'all 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {icon}
      </span>
      {/* Label */}
      <span
        style={{
          fontSize: 10,
          fontWeight: active ? 800 : 600,
          color: active ? iconColor : '#afafaf',
          letterSpacing: '-0.01em',
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    </Tag>
  );
}

/* ── Desktop sub-components (unchanged) ──────────────────────────────── */

function NavLink({
  label, icon, iconBg, iconColor, active, onClick,
}: {
  label: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  active: boolean;
  onClick?: () => void;
  danger?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseDown={() => { setHovered(false); setPressed(true); }}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm font-bold text-left select-none"
      style={{
        fontFamily: 'Lexend, sans-serif',
        background: active ? '#e8f9d3' : hovered ? '#f3f3f3' : 'transparent',
        color: active ? '#2b6c00' : '#3c3c3c',
        transform: pressed ? 'translateY(2px)' : 'translateY(0)',
        transition: 'transform 80ms ease, background 120ms ease',
        cursor: 'pointer',
        borderBottom: active ? '2px solid #8edd5c' : '2px solid transparent',
      }}
    >
      <span
        className="shrink-0 flex items-center justify-center rounded-xl"
        style={{
          width: 36, height: 36,
          background: active ? '#c0f080' : iconBg,
          color: iconColor,
          transform: hovered && !pressed ? 'scale(1.12)' : 'scale(1)',
          transition: 'transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1), background 120ms ease',
        }}
      >
        {icon}
      </span>
      <span style={{ fontWeight: 700, letterSpacing: '-0.01em' }}>{label}</span>
    </Tag>
  );
}

function PremiumButton() {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onMouseEnter={() => setHovered(true)}
      onMouseDown={() => { setHovered(false); setPressed(true); }}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      className="w-full flex items-center justify-center gap-2 text-sm font-extrabold select-none"
      style={{
        fontFamily: 'Lexend, sans-serif',
        background: hovered ? '#4fc5ff' : '#2fb8ff',
        color: '#004666',
        borderRadius: '14px',
        padding: '12px 16px',
        boxShadow: pressed ? '0 1px 0 #006590' : hovered ? '0 6px 0 #006590' : '0 4px 0 #006590',
        transform: pressed ? 'translateY(3px)' : hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'transform 100ms ease, box-shadow 100ms ease, background 120ms ease',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <Zap size={16} fill="#004666" strokeWidth={0} />
      Go Premium
    </button>
  );
}

function SessionItem({ session, active, onClick }: { session: SessionSummary; active: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col w-full px-4 py-2 rounded-xl text-sm text-left transition-colors gap-0.5"
      style={active ? { background: '#f3f3f3', color: '#2b6c00', fontWeight: 700 } : { color: '#6f7b64', fontWeight: 500 }}
    >
      <span className="truncate leading-snug">{session.title ?? 'New conversation'}</span>
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
    if (day >= today)          groups[0].items.push(session);
    else if (day >= yesterday) groups[1].items.push(session);
    else                       groups[2].items.push(session);
  }
  return groups.filter((g) => g.items.length > 0);
}
