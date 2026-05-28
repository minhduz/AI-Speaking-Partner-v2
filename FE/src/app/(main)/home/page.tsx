'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Mic, Flame, Play, Lock, CheckCircle2, RotateCcw, Star, Sparkles, BookOpen,
  Trophy, ChevronRight, Zap, X, ListChecks,
} from 'lucide-react';
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { PageHeader } from '@/components/shared/page-header';
import { useAuthContext } from '@/contexts/auth-context';
import { userService } from '@/services/user.service';
import { progressService, type DashboardStats } from '@/services/progress.service';
import {
  lessonService,
  type LessonPath,
  type LessonPathItem,
  type LessonGroup,
  type LessonState,
} from '@/services/lesson.service';
import type { UserProfile } from '@/types/user.types';

// ─── Node icon helpers ──────────────────────────────────────────────────────

function nodeIcon(state: LessonState, isReview: boolean, size = 22) {
  if (state === 'locked') return <Lock size={size} strokeWidth={2.5} />;
  if (state === 'completed') return <CheckCircle2 size={size} strokeWidth={2.5} />;
  if (state === 'needs_retry') return <RotateCcw size={size} strokeWidth={2.5} />;
<<<<<<< HEAD
  if (state === 'under_review') return <ListChecks size={size} strokeWidth={2.5} />;
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
  if (state === 'in_progress') return <Play size={size} strokeWidth={2.5} />;
  if (isReview) return <Star size={size} strokeWidth={2.5} />;
  return <BookOpen size={size} strokeWidth={2.5} />;
}

function nodeColors(state: LessonState) {
  switch (state) {
    case 'locked':      return { bg: '#e2e2e2', border: '#c8c8c8', shadow: '#b0b0b0', icon: '#9e9e9e', ring: 'none' };
    case 'completed':   return { bg: '#58cc02', border: '#46a302', shadow: '#3a8700', icon: '#ffffff', ring: '0 0 0 4px rgba(88,204,2,0.2)' };
    case 'needs_retry': return { bg: '#ff9c27', border: '#e0851a', shadow: '#c07010', icon: '#ffffff', ring: '0 0 0 4px rgba(255,156,39,0.2)' };
<<<<<<< HEAD
    case 'under_review': return { bg: '#dceaff', border: '#9bbcff', shadow: '#6f94e8', icon: '#1e3a7a', ring: '0 0 0 4px rgba(115,150,232,0.22)' };
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
    case 'in_progress': return { bg: '#2fb8ff', border: '#1c93d1', shadow: '#1577a8', icon: '#ffffff', ring: '0 0 0 4px rgba(47,184,255,0.25)' };
    case 'unlocked':    return { bg: '#ffffff', border: '#58cc02', shadow: '#46a302', icon: '#58cc02', ring: '0 0 0 4px rgba(88,204,2,0.15)' };
    default:            return { bg: '#ffffff', border: '#e2e2e2', shadow: '#c8c8c8', icon: '#6f7b64', ring: 'none' };
  }
}

// Pick the most actionable lesson inside a unit for the sidebar context card.
function pickUnitCurrent(lessons: LessonPathItem[]): LessonPathItem | null {
  return (
    lessons.find((l) => l.state === 'in_progress') ??
<<<<<<< HEAD
    lessons.find((l) => l.state === 'under_review') ??
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
    lessons.find((l) => l.state === 'unlocked') ??
    lessons.find((l) => l.state === 'needs_retry') ??
    null
  );
}

function unitProgressLabel(group: LessonGroup): { completed: number; total: number; pct: number } {
  const total = group.lessons.length;
  const completed = group.lessons.filter((l) => l.state === 'completed').length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, pct };
}

// ─── Tooltip on hover over node ─────────────────────────────────────────────

function NodeTooltip({ item, onOpen }: { item: LessonPathItem; onOpen: () => void }) {
  const locked = item.state === 'locked';
<<<<<<< HEAD
  const reviewing = item.state === 'under_review';
  const actionable = !locked && !reviewing;
  const actionLabel =
    item.state === 'in_progress' ? 'Continue lesson'
    : reviewing ? 'Reviewing'
=======
  const actionLabel =
    item.state === 'in_progress' ? 'Continue lesson'
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
    : item.state === 'completed' ? 'Review lesson'
    : item.state === 'needs_retry' ? 'Retry lesson'
    : 'Start lesson';
  return (
    <div
      // `bottom-full` anchors this wrapper just above the node. The pb-3
      // padding is a transparent bridge between the visible card and the
      // node — without it, the cursor crossing the gap triggers mouseleave
      // on the parent and the tooltip disappears before the user can click.
      className="absolute z-50 left-1/2 -translate-x-1/2 bottom-full pb-3 pointer-events-auto"
      style={{ width: 220, fontFamily: 'Lexend, sans-serif' }}
    >
      <div className="relative">
        <div
          className="rounded-2xl p-3 flex flex-col gap-2"
          style={{
            background: '#ffffff',
            border: '2px solid #e2e2e2',
            boxShadow: '0 8px 24px rgba(0,0,0,0.13), 0 4px 0 #e2e2e2',
          }}
        >
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#becbb1' }}>
              {item.level} · {item.topic}
            </p>
            <p className="text-sm font-black mt-0.5 leading-snug" style={{ color: '#1a1c1c' }}>{item.title}</p>
            <p className="text-[11px] font-semibold mt-1 leading-snug" style={{ color: '#6f7b64' }}>{item.objective}</p>
          </div>
<<<<<<< HEAD
          {actionable && (
=======
          {!locked && (
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
            <button
              onClick={onOpen}
              className="w-full h-9 rounded-xl text-xs font-extrabold transition active:translate-y-0.5 flex items-center justify-center gap-1.5"
              style={{ background: '#58cc02', color: '#1e5000', boxShadow: '0 3px 0 #46a302' }}
            >
              <Play size={13} /> {actionLabel}
            </button>
          )}
<<<<<<< HEAD
          {reviewing && (
            <p className="rounded-xl px-3 py-2 text-[11px] font-bold text-center" style={{ background: '#e6efff', color: '#1e3a7a' }}>
              Teacher review pending. You can continue after the teacher finishes.
            </p>
          )}
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
          {locked && (
            <p className="text-[11px] font-bold text-center" style={{ color: '#9e9e9e' }}>
              Complete previous lesson to unlock
            </p>
          )}
        </div>
        {/* Arrow pointing down, anchored to the bottom of the card */}
        <div
          className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rotate-45"
          style={{
            top: 'calc(100% - 6px)',
            background: '#ffffff',
            borderRight: '2px solid #e2e2e2',
            borderBottom: '2px solid #e2e2e2',
          }}
        />
      </div>
    </div>
  );
}

// ─── Single Lesson Node ──────────────────────────────────────────────────────

function LessonNode({
  item,
  isCurrent,
  onOpen,
<<<<<<< HEAD
  xOffset,
  yOffset,
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
}: {
  item: LessonPathItem;
  isCurrent: boolean;
  onOpen: (id: string) => void;
<<<<<<< HEAD
  xOffset: number;
  yOffset: number;
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
}) {
  const [hovered, setHovered] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colors = nodeColors(item.state);
  const locked = item.state === 'locked';
<<<<<<< HEAD
  const reviewing = item.state === 'under_review';
  const blocked = locked || reviewing;
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)

  const openTooltip = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setHovered(true);
  }, []);

  const closeTooltip = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setHovered(false);
      closeTimerRef.current = null;
    }, 180);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  return (
    <div
<<<<<<< HEAD
      className="absolute flex items-center justify-center"
      style={{
        left: xOffset,
        top: yOffset,
        transform: 'translate(-50%, -50%)',
        zIndex: hovered ? 30 : 10,
      }}
=======
      className="relative flex items-center justify-center"
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
      onMouseEnter={openTooltip}
      onMouseLeave={closeTooltip}
    >
      {isCurrent && (
        <div
          className="absolute inset-0 rounded-full animate-ping"
          style={{ background: '#58cc02', opacity: 0.25, transform: 'scale(1.6)' }}
        />
      )}

      <button
        type="button"
<<<<<<< HEAD
        aria-disabled={blocked}
=======
        aria-disabled={locked}
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
        onClick={(event) => {
          event.stopPropagation();
          openTooltip();
        }}
        aria-label={item.title}
        className="relative flex items-center justify-center rounded-full transition-all select-none"
        style={{
          width: isCurrent ? 72 : 60,
          height: isCurrent ? 72 : 60,
          background: colors.bg,
          border: `3px solid ${colors.border}`,
<<<<<<< HEAD
          boxShadow: blocked ? 'none' : `0 ${isCurrent ? 6 : 4}px 0 ${colors.shadow}${colors.ring !== 'none' ? `, ${colors.ring}` : ''}`,
          color: colors.icon,
          cursor: blocked ? 'not-allowed' : 'pointer',
          transform: hovered && !blocked ? 'translateY(-2px)' : 'translateY(0)',
=======
          boxShadow: locked ? 'none' : `0 ${isCurrent ? 6 : 4}px 0 ${colors.shadow}${colors.ring !== 'none' ? `, ${colors.ring}` : ''}`,
          color: colors.icon,
          cursor: locked ? 'not-allowed' : 'pointer',
          transform: hovered && !locked ? 'translateY(-2px)' : 'translateY(0)',
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          opacity: locked ? 0.65 : 1,
        }}
      >
        {nodeIcon(item.state, item.is_review, isCurrent ? 26 : 22)}

        {isCurrent && item.state === 'unlocked' && (
          <span
            className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider whitespace-nowrap"
            style={{ background: '#58cc02', color: '#1e5000', boxShadow: '0 2px 0 #46a302' }}
          >
            Start!
          </span>
        )}
        {isCurrent && item.state === 'in_progress' && (
          <span
            className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider whitespace-nowrap"
            style={{ background: '#2fb8ff', color: '#003b56', boxShadow: '0 2px 0 #1c93d1' }}
          >
            Continue
          </span>
        )}
<<<<<<< HEAD
        {(isCurrent || reviewing) && item.state === 'under_review' && (
          <span
            className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider whitespace-nowrap"
            style={{ background: '#dceaff', color: '#1e3a7a', boxShadow: '0 2px 0 #9bbcff' }}
          >
            Reviewing
          </span>
        )}

        {item.state !== 'under_review' && item.best_score != null && (
=======

        {item.best_score != null && (
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
          <span
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full text-[9px] font-extrabold whitespace-nowrap"
            style={{ background: '#e8f9d3', color: '#1e5000', border: '2px solid #bdee8c' }}
          >
            {item.best_score}
          </span>
        )}
      </button>

      <div className="absolute top-full mt-5 left-1/2 -translate-x-1/2 text-center w-28 pointer-events-none">
<<<<<<< HEAD
        <p className="text-[11px] font-bold leading-tight" style={{ color: locked ? '#becbb1' : reviewing ? '#1e3a7a' : '#3f4a36' }}>
=======
        <p className="text-[11px] font-bold leading-tight" style={{ color: locked ? '#becbb1' : '#3f4a36' }}>
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
          {item.title.length > 22 ? item.title.slice(0, 20) + '…' : item.title}
        </p>
      </div>

      {hovered && (
        <NodeTooltip item={item} onOpen={() => onOpen(item.lesson_id)} />
      )}
    </div>
  );
}

// ─── Per-unit zigzag connector (grey base + green completed segments) ──────

function SinuousPath({
  lessons,
  pathWidth,
  amplitude,
  nodeSpacing,
  unitLocked,
}: {
  lessons: LessonPathItem[];
  pathWidth: number;
  amplitude: number;
  nodeSpacing: number;
  unitLocked: boolean;
}) {
  const count = lessons.length;
  if (count < 2) return null;
  const centerX = pathWidth / 2;
  const totalH = (count - 1) * nodeSpacing;

  const points: [number, number][] = Array.from({ length: count }, (_, i) => {
    const x = centerX + (i % 2 === 0 ? -amplitude : amplitude);
    const y = i * nodeSpacing + 36;
    return [x, y];
  });

  const segmentPath = (i: number) => {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const cp1y = (y0 + y1) / 2;
    return `M ${x0} ${y0} C ${x0} ${cp1y} ${x1} ${cp1y} ${x1} ${y1}`;
  };

  const fullPath = (() => {
    let d = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < count; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const cpY = (y0 + y1) / 2;
      d += ` C ${x0} ${cpY} ${x1} ${cpY} ${x1} ${y1}`;
    }
    return d;
  })();

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={pathWidth}
      height={totalH + 72}
      style={{ overflow: 'visible' }}
    >
      <path d={fullPath} fill="none" stroke="#e2e2e2" strokeWidth={10} strokeLinecap="round" />
      <path d={fullPath} fill="none" stroke="#f3f3f3" strokeWidth={8} strokeLinecap="round" />
      {!unitLocked &&
        Array.from({ length: count - 1 }).map((_, i) => {
          if (lessons[i].state !== 'completed') return null;
          return (
            <path
              key={`seg-${lessons[i].lesson_id}`}
              d={segmentPath(i)}
              fill="none"
              stroke="#58cc02"
              strokeWidth={6}
              strokeLinecap="round"
              opacity={0.95}
            />
          );
        })}
    </svg>
  );
}

// ─── Unit banner (sits above a unit's zigzag) ──────────────────────────────

function UnitBanner({
  level,
  topic,
  unit,
  unitIndex,
  totalUnits,
  completed,
  total,
  color,
  locked,
  onOpenGuidebook,
}: {
  level: string;
  topic: string;
  unit: string;
  unitIndex: number;
  totalUnits: number;
  completed: number;
  total: number;
  color: string;
  locked: boolean;
  onOpenGuidebook: () => void;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div
      className="w-full max-w-sm mx-auto rounded-2xl px-4 sm:px-5 py-3 mb-3"
      style={{
        background: locked ? '#ececec' : color,
        fontFamily: 'Lexend, sans-serif',
        opacity: locked ? 0.85 : 1,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p
            className="text-[10px] font-extrabold uppercase tracking-widest opacity-70 truncate"
            style={{ color: locked ? '#6f7b64' : '#1a3a00' }}
          >
            {level} · Unit {unitIndex + 1}/{totalUnits}
          </p>
          <p className="text-sm font-black mt-0.5 truncate" style={{ color: '#1a1c1c' }}>
            {locked && <Lock size={12} className="inline mr-1 mb-0.5" />}
            {unit}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          <button
            onClick={onOpenGuidebook}
            className="h-8 inline-flex items-center gap-1 px-2.5 rounded-full text-[10px] font-extrabold whitespace-nowrap transition active:translate-y-0.5"
            style={{
              background: '#ffffff',
              color: '#3f4a36',
              border: '1.5px solid rgba(0,0,0,0.06)',
              boxShadow: '0 2px 0 rgba(0,0,0,0.06)',
            }}
            aria-label={`Open ${unit} guidebook`}
          >
            <BookOpen size={12} /> Guidebook
          </button>
          <div
            className="rounded-full px-2.5 py-1 text-[10px] font-extrabold whitespace-nowrap"
            style={{
              background: locked ? '#f9f9f9' : '#ffffff',
              color: locked ? '#6f7b64' : '#1e5000',
              border: `2px solid ${locked ? '#e2e2e2' : 'rgba(255,255,255,0.6)'}`,
            }}
          >
            {completed}/{total} · {pct}%
          </div>
        </div>
      </div>
      <p className="text-[11px] font-semibold mt-1 truncate" style={{ color: '#3f4a36' }}>
        {topic}
      </p>
    </div>
  );
}

// ─── Divider between units ──────────────────────────────────────────────────

function UnitDivider({ unitName, locked }: { unitName: string; locked: boolean }) {
  const dashColor = locked ? '#e2e2e2' : '#cce5b3';
  const labelColor = locked ? '#9e9e9e' : '#3f7300';
  return (
    <div
      className="my-4 flex items-center gap-3 max-w-sm mx-auto px-2"
      style={{ fontFamily: 'Lexend, sans-serif' }}
      aria-hidden="true"
    >
      <div className="flex-1 h-px" style={{ background: dashColor }} />
      <span
        className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-widest whitespace-nowrap"
        style={{ color: labelColor }}
      >
        {locked ? <Lock size={11} /> : <Sparkles size={11} />}
        {locked ? 'Locked' : 'Up next'} · {unitName}
      </span>
      <div className="flex-1 h-px" style={{ background: dashColor }} />
    </div>
  );
}

// ─── Sticky top section bar (changes with active unit) ─────────────────────

function ActiveUnitBar({
  group,
  unitIndex,
  totalUnits,
  onOpenGuidebook,
}: {
  group: LessonGroup;
  unitIndex: number;
  totalUnits: number;
  onOpenGuidebook: () => void;
}) {
  const { completed, total, pct } = unitProgressLabel(group);
  const locked = group.lessons.every((l) => l.state === 'locked');
  return (
    <div
      className="rounded-2xl px-4 py-2.5 flex items-center justify-between gap-3 mx-auto max-w-sm"
      style={{
        background: locked ? '#6f7b64' : '#58cc02',
        boxShadow: `0 3px 0 ${locked ? '#4a5343' : '#46a302'}`,
        fontFamily: 'Lexend, sans-serif',
      }}
    >
      <div className="min-w-0">
        <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.78)' }}>
          {group.level} · Section 1 · Unit {unitIndex + 1}/{totalUnits}
        </p>
        <p className="text-sm font-black truncate flex items-center gap-1.5" style={{ color: '#ffffff' }}>
          {locked && <Lock size={13} />}
          {group.unit}
        </p>
        <p className="text-[10px] font-bold mt-0.5" style={{ color: 'rgba(255,255,255,0.78)' }}>
          {completed}/{total} · {pct}%
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenGuidebook}
        className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-[11px] font-extrabold uppercase tracking-wider transition active:translate-y-0.5"
        style={{
          background: '#ffffff',
          color: locked ? '#4a5343' : '#1e5000',
          boxShadow: '0 2px 0 rgba(0,0,0,0.12)',
        }}
        aria-label={`Open ${group.unit} guidebook`}
      >
        <BookOpen size={14} /> Guidebook
      </button>
    </div>
  );
}

// ─── Active unit context card (right sidebar) ──────────────────────────────

function ActiveUnitCard({
  group,
  unitIndex,
  totalUnits,
  onOpenLesson,
  onOpenGuidebook,
}: {
  group: LessonGroup;
  unitIndex: number;
  totalUnits: number;
  onOpenLesson: (id: string) => void;
  onOpenGuidebook: () => void;
}) {
  const { completed, total, pct } = unitProgressLabel(group);
  const current = pickUnitCurrent(group.lessons);
  const allCompleted = total > 0 && completed === total;
  const allLocked = group.lessons.every((l) => l.state === 'locked');
<<<<<<< HEAD
  const currentReviewing = current?.state === 'under_review';
=======
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
  return (
    <div
      className="rounded-3xl p-5 flex flex-col gap-3"
      style={{
        background: '#ffffff',
        border: '2px solid #e2e2e2',
        boxShadow: '0 4px 0 #e2e2e2',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>
          {group.level} · Unit {unitIndex + 1}/{totalUnits}
        </p>
        <span
          className="text-[10px] font-extrabold px-2 py-0.5 rounded-full"
          style={{ background: '#e8f9d3', color: '#1e5000' }}
        >
          {completed}/{total} · {pct}%
        </span>
      </div>
      <h3 className="text-base font-black leading-tight" style={{ color: '#1a1c1c' }}>
        {group.unit}
      </h3>
      <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: '#f3f3f3' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #58cc02, #3a8700)' }}
        />
      </div>

      {current ? (
        <div className="flex flex-col gap-2 mt-1">
          <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>
<<<<<<< HEAD
            {current.state === 'under_review' ? 'Reviewing' : current.state === 'in_progress' ? 'Continue' : current.state === 'needs_retry' ? 'Retry' : 'Up next'}
=======
            {current.state === 'in_progress' ? 'Continue' : current.state === 'needs_retry' ? 'Retry' : 'Up next'}
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
          </p>
          <p className="text-sm font-extrabold leading-snug" style={{ color: '#1a1c1c' }}>
            {current.title}
          </p>
          <p className="text-xs font-semibold leading-snug" style={{ color: '#6f7b64' }}>
            {current.objective}
          </p>
          <button
<<<<<<< HEAD
            onClick={() => {
              if (!currentReviewing) onOpenLesson(current.lesson_id);
            }}
            disabled={currentReviewing}
            className="mt-1 h-10 rounded-xl text-sm font-extrabold transition active:translate-y-0.5 disabled:active:translate-y-0 flex items-center justify-center gap-2 disabled:cursor-not-allowed"
            style={currentReviewing
              ? { background: '#dceaff', color: '#1e3a7a', boxShadow: '0 3px 0 #9bbcff' }
              : { background: '#58cc02', color: '#1e5000', boxShadow: '0 3px 0 #46a302' }}
          >
            {current.state === 'under_review' ? (
              <><ListChecks size={14} /> Teacher review pending</>
            ) : current.state === 'in_progress' ? (
=======
            onClick={() => onOpenLesson(current.lesson_id)}
            className="mt-1 h-10 rounded-xl text-sm font-extrabold transition active:translate-y-0.5 flex items-center justify-center gap-2"
            style={{ background: '#58cc02', color: '#1e5000', boxShadow: '0 3px 0 #46a302' }}
          >
            {current.state === 'in_progress' ? (
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
              <><Play size={14} /> Continue</>
            ) : current.state === 'needs_retry' ? (
              <><RotateCcw size={14} /> Retry</>
            ) : (
              <><Play size={14} /> Start</>
            )}
          </button>
        </div>
      ) : allCompleted ? (
        <div
          className="rounded-xl p-3 flex items-center gap-2 text-xs font-bold"
          style={{ background: '#e8f9d3', color: '#1e5000' }}
        >
          <CheckCircle2 size={16} /> Unit complete — great work!
        </div>
      ) : allLocked ? (
        <div
          className="rounded-xl p-3 flex items-center gap-2 text-xs font-bold"
          style={{ background: '#f3f3f3', color: '#6f7b64' }}
        >
          <Lock size={14} /> Finish the previous unit to unlock.
        </div>
      ) : null}

      <button
        type="button"
        onClick={onOpenGuidebook}
        className="mt-1 h-9 rounded-xl text-xs font-extrabold transition active:translate-y-0.5 flex items-center justify-center gap-2"
        style={{ background: '#f4efff', color: '#5a2eb8', border: '1.5px solid #ebe0ff' }}
      >
        <BookOpen size={13} /> Guidebook for this unit
      </button>
    </div>
  );
}

// ─── Static guidebook content (no backend, derived from unit name + seed) ──

interface GuidebookPhrase { en: string; vi: string }
interface GuidebookEntry {
  skills: string[];
  phrases: GuidebookPhrase[];
  reviewChecklist: string[];
}

const GUIDEBOOK_BY_UNIT: Record<string, GuidebookEntry> = {
  'About Me': {
    skills: ['Self-introduction', 'Talking about likes / dislikes', 'Describing a daily routine', 'Talking about family or friends'],
    phrases: [
      { en: "Hi, I'm ___.",                       vi: 'Xin chào, tôi là ___.' },
      { en: 'I live in ___.',                     vi: 'Tôi sống ở ___.' },
      { en: 'I like ___ because ___.',            vi: 'Tôi thích ___ vì ___.' },
      { en: 'I usually ___ in the morning.',      vi: 'Tôi thường ___ vào buổi sáng.' },
      { en: 'My ___ is ___.',                     vi: '___ của tôi là ___.' },
    ],
    reviewChecklist: [
      'I can introduce myself with name and city in 2-3 sentences.',
      'I can name 2-3 things I like and one I don\'t.',
      'I can describe a normal day (morning / afternoon / evening).',
      'I can talk about one family member or friend with a detail.',
    ],
  },
  'Everyday Survival': {
    skills: ['Ordering at a cafe / restaurant', 'Buying something simple', 'Asking for directions', 'Making a simple plan with a friend'],
    phrases: [
      { en: 'Can I have ___, please?',            vi: 'Cho tôi ___, được không?' },
      { en: 'How much is this?',                  vi: 'Cái này bao nhiêu tiền?' },
      { en: 'Where is the ___?',                  vi: '___ ở đâu?' },
      { en: "Let's meet at ___ at ___.",          vi: 'Hẹn gặp ở ___ lúc ___.' },
      { en: 'Excuse me, do you speak English?',   vi: 'Xin lỗi, bạn có nói tiếng Anh không?' },
    ],
    reviewChecklist: [
      'I can order a drink politely and answer a follow-up.',
      'I can ask the price and pay for an item.',
      'I can ask where a place is and repeat directions back.',
      'I can suggest a time and place to meet someone.',
    ],
  },
  'Real Conversation': {
    skills: ['Work or study small talk', 'Giving a simple opinion with a reason', 'Sharing a past experience', 'Talking about future plans'],
    phrases: [
      { en: "I'm a ___ / I work in ___.",         vi: 'Tôi là ___ / tôi làm trong ngành ___.' },
      { en: 'I think ___ because ___.',           vi: 'Tôi nghĩ ___ vì ___.' },
      { en: 'Last weekend, I ___.',               vi: 'Cuối tuần trước, tôi ___.' },
      { en: "I'm going to ___ next ___.",         vi: 'Tôi sẽ ___ vào ___ tới.' },
      { en: 'What about you?',                    vi: 'Còn bạn thì sao?' },
    ],
    reviewChecklist: [
      'I can answer "What do you do?" and ask it back.',
      'I can give an opinion with one reason.',
      'I can describe something I did recently in past tense.',
      'I can share a plan and connect it to a goal.',
    ],
  },
};

function guidebookFor(unitName: string): GuidebookEntry {
  return (
    GUIDEBOOK_BY_UNIT[unitName] ?? {
      skills: ['Practice the lessons in this unit.'],
      phrases: [],
      reviewChecklist: [],
    }
  );
}

// ─── Guidebook drawer ──────────────────────────────────────────────────────

function GuidebookDrawer({
  group,
  onClose,
}: {
  group: LessonGroup | null;
  onClose: () => void;
}) {
  // Lock body scroll while open.
  useEffect(() => {
    if (!group) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [group]);

  if (!group) return null;
  const data = guidebookFor(group.unit);
  const { completed, total, pct } = unitProgressLabel(group);
  return (
    <div
      className="fixed inset-0 z-50 flex"
      style={{ fontFamily: 'Lexend, sans-serif' }}
      role="dialog"
      aria-modal="true"
      aria-label={`${group.unit} guidebook`}
    >
      <button
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-label="Close guidebook"
      />
      <div
        className="relative ml-auto w-full sm:max-w-md h-full bg-white shadow-2xl flex flex-col"
      >
        <div className="px-5 pt-5 pb-3 flex items-start gap-3 border-b" style={{ borderColor: '#f0f0f0' }}>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>
              {group.level} · {group.topic}
            </p>
            <h2 className="mt-0.5 text-xl font-black leading-tight" style={{ color: '#1a1c1c' }}>
              {group.unit} guidebook
            </h2>
            <p className="text-[11px] font-bold mt-1" style={{ color: '#3f4a36' }}>
              {completed}/{total} lessons complete · {pct}%
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: '#f3f3f3', color: '#3f4a36' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-5">
          <section>
            <p className="text-[10px] font-extrabold uppercase tracking-widest mb-2" style={{ color: '#6f7b64' }}>
              What you&apos;ll learn
            </p>
            <ul className="flex flex-col gap-2">
              {data.skills.map((skill) => (
                <li key={skill} className="flex items-start gap-2 text-sm font-semibold" style={{ color: '#1a1c1c' }}>
                  <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#58cc02' }} />
                  {skill}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <p className="text-[10px] font-extrabold uppercase tracking-widest mb-2" style={{ color: '#6f7b64' }}>
              Lessons in this unit
            </p>
            <ul className="flex flex-col gap-2">
              {group.lessons.map((lesson, i) => {
                const done = lesson.state === 'completed';
                const locked = lesson.state === 'locked';
                return (
                  <li
                    key={lesson.lesson_id}
                    className="rounded-2xl p-3 flex items-start gap-3"
                    style={{ background: '#fafafa', border: '1px solid #f0f0f0' }}
                  >
                    <span
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold"
                      style={{
                        background: done ? '#58cc02' : locked ? '#e2e2e2' : '#e8f9d3',
                        color: done ? '#ffffff' : locked ? '#9e9e9e' : '#1e5000',
                      }}
                    >
                      {done ? <CheckCircle2 size={14} /> : locked ? <Lock size={12} /> : i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold leading-snug" style={{ color: '#1a1c1c' }}>
                        {lesson.title}
                      </p>
                      <p className="text-[11px] font-semibold leading-snug mt-0.5" style={{ color: '#6f7b64' }}>
                        {lesson.objective}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {data.phrases.length > 0 && (
            <section>
              <p className="text-[10px] font-extrabold uppercase tracking-widest mb-2" style={{ color: '#6f7b64' }}>
                Useful phrases
              </p>
              <ul className="flex flex-col gap-2">
                {data.phrases.map((p) => (
                  <li
                    key={p.en}
                    className="rounded-2xl p-3"
                    style={{ background: '#f4efff', border: '1px solid #ebe0ff' }}
                  >
                    <p className="text-sm font-extrabold" style={{ color: '#3a1e6e' }}>{p.en}</p>
                    <p className="text-[11px] font-semibold mt-0.5" style={{ color: '#5a2eb8' }}>{p.vi}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.reviewChecklist.length > 0 && (
            <section>
              <p className="text-[10px] font-extrabold uppercase tracking-widest mb-2 flex items-center gap-1" style={{ color: '#6f7b64' }}>
                <ListChecks size={11} /> Review checklist
              </p>
              <ul className="flex flex-col gap-1.5">
                {data.reviewChecklist.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm" style={{ color: '#1a1c1c' }}>
                    <span className="mt-1 w-3 h-3 rounded border-2 shrink-0" style={{ borderColor: '#bdee8c' }} />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const UNIT_COLORS = [
  '#bdee8c', '#ffe28a', '#c8e6ff', '#ffd7fb', '#d7ffb8', '#ffe0c8', '#c8f2f0',
];

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function HomePage() {
  const { logout } = useAuthContext();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [path, setPath] = useState<LessonPath | null>(null);
  const [loading, setLoading] = useState(true);
  // `scrollUnitIndex` is null until the user actually scrolls past a unit
  // boundary; the displayed active unit (`activeUnitIndex` below) falls back
  // to the unit holding the recommended/continue lesson, derived during
  // render. This keeps the initial value reactive to path data without doing
  // a synchronous setState-in-effect dance.
  const [scrollUnitIndex, setScrollUnitIndex] = useState<number | null>(null);
  const [guidebookGroup, setGuidebookGroup] = useState<LessonGroup | null>(null);
  const unitRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      const [p, s, lp] = await Promise.all([
        userService.me().catch(() => null),
        progressService.getDashboardStats().catch(() => null),
        lessonService.getPath().catch(() => null),
      ]);
      if (cancelled) return;
      setProfile(p);
      setStats(s);
      setPath(lp);
      setLoading(false);
    }
    loadAll();
    return () => { cancelled = true; };
  }, []);

  const groups = useMemo(() => path?.groups ?? [], [path]);
  const allLessons: LessonPathItem[] = useMemo(
    () => groups.flatMap((g) => g.lessons),
    [groups],
  );

  // Default active unit = the unit holding the recommended/continue lesson,
  // so the sidebar opens on what the learner is actually working on. Derived
  // during render; the scroll observer below overrides this once the user
  // starts scrolling.
  const defaultUnitIndex = useMemo(() => {
    if (!path || groups.length === 0) return 0;
    const target = path.continue_lesson ?? path.recommended_lesson;
    if (!target) return 0;
    const idx = groups.findIndex((g) =>
      g.lessons.some((l) => l.lesson_id === target.lesson_id),
    );
    return idx >= 0 ? idx : 0;
  }, [path, groups]);

  // Track which unit the user is currently scrolled over. We observe each
  // unit section against the viewport with a top-band rootMargin so the
  // active unit switches near the upper third of the screen — feels natural
  // whether the left column has its own scroll (lg+) or the page scrolls
  // as a whole (mobile).
  useEffect(() => {
    if (loading || groups.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const idxAttr = (visible[0].target as HTMLElement).dataset.unitIndex;
          if (idxAttr != null) setScrollUnitIndex(Number(idxAttr));
        }
      },
      { root: null, rootMargin: '-30% 0px -55% 0px', threshold: 0 },
    );
    unitRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [loading, groups.length]);

  const handleOpenLesson = useCallback((id: string) => router.push(`/lessons/${id}`), [router]);
  const handleOpenGuidebook = useCallback((group: LessonGroup) => setGuidebookGroup(group), []);
  const handleCloseGuidebook = useCallback(() => setGuidebookGroup(null), []);

  const totalUnits = groups.length;
  const activeUnitIndex = scrollUnitIndex ?? defaultUnitIndex;
  const activeGroup = groups[activeUnitIndex] ?? groups[0] ?? null;

  // Path geometry — narrower on mobile so labels never run off-screen.
  const pathWidth = 300;
  const amplitude = 70;
  const nodeSpacing = 104;
  const centerX = pathWidth / 2;

  return (
    <div className="flex w-full h-full">
      <Sidebar
        onNewChat={() => router.push('/chat?mode=free_talk')}
        onLogout={logout}
        currentSessionId={null}
        onSessionClick={(session) => router.push(`/chat?sessionId=${session.id}`)}
      />
      <main
        className="flex-1 flex flex-col h-full overflow-hidden"
        style={{ background: '#f9f9f9', fontFamily: 'Lexend, sans-serif' }}
      >
        <PageHeader title="Learning Path" mobileTitle="SpeakUP" hideBack />

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#58cc02' }}>
              <div className="w-6 h-6 rounded-full border-4 border-[#1e5000]/25 border-t-[#1e5000] animate-spin" />
            </div>
          </div>
        ) : (
          // Mobile: outer container scrolls (cards stack below path).
          // lg+: outer is overflow-hidden, left and right columns each scroll
          // independently so the sidebar stays put while the path scrolls.
          <div
            className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            {/* ── LEFT: Zigzag lesson path ── */}
            <div
              className="lg:flex-1 lg:min-w-0 lg:overflow-y-auto custom-scrollbar"
              style={{ paddingBottom: 'max(24px, calc(64px + env(safe-area-inset-bottom, 0px)))' }}
            >
              <div className="max-w-2xl mx-auto px-4 sm:px-8 pt-4">
                <p className="text-xs font-extrabold uppercase tracking-widest mb-2" style={{ color: '#6f7b64' }}>
                  Hi {(profile?.name || profile?.email || 'there').split(/[ @]/)[0]} 👋
                </p>

                {/* Sticky active-unit bar — stays at the top of the path scroll
                    area on lg+, follows page scroll on mobile. */}
                {activeGroup && (
                  <div className="sticky top-0 z-20 pt-1 pb-2" style={{ background: '#f9f9f9' }}>
                    <ActiveUnitBar
                      group={activeGroup}
                      unitIndex={activeUnitIndex}
                      totalUnits={totalUnits}
                      onOpenGuidebook={() => handleOpenGuidebook(activeGroup)}
                    />
                  </div>
                )}

                {/* Empty-state */}
                {groups.length === 0 ? (
                  <div
                    className="rounded-3xl p-10 flex flex-col items-center justify-center text-center gap-3 mt-4"
                    style={{ background: '#ffffff', border: '2px dashed #e2e2e2' }}
                  >
                    <BookOpen size={32} color="#becbb1" />
                    <p className="text-sm font-bold" style={{ color: '#becbb1' }}>
                      No lessons available yet.
                    </p>
                  </div>
                ) : (
                  groups.map((group, gi) => {
                    const color = UNIT_COLORS[gi % UNIT_COLORS.length];
                    const lessons = group.lessons;
                    const completedCount = lessons.filter((l) => l.state === 'completed').length;
                    const unitLocked = lessons.every((l) => l.state === 'locked');

                    return (
                      <div
                        key={`${group.level}::${group.topic}::${group.unit}`}
                        ref={(el) => { unitRefs.current[gi] = el; }}
                        data-unit-index={gi}
                        className="mb-6"
                      >
                        {gi > 0 && <UnitDivider unitName={group.unit} locked={unitLocked} />}
                        <UnitBanner
                          level={group.level}
                          topic={group.topic}
                          unit={group.unit}
                          unitIndex={gi}
                          totalUnits={totalUnits}
                          completed={completedCount}
                          total={lessons.length}
                          color={color}
                          locked={unitLocked}
                          onOpenGuidebook={() => handleOpenGuidebook(group)}
                        />

                        <div
                          className="relative mx-auto"
                          style={{
                            width: pathWidth,
                            height: lessons.length * nodeSpacing + 72,
                          }}
                        >
                          <SinuousPath
                            lessons={lessons}
                            pathWidth={pathWidth}
                            amplitude={amplitude}
                            nodeSpacing={nodeSpacing}
                            unitLocked={unitLocked}
                          />
                          {lessons.map((lesson, li) => {
                            const xOffset = centerX + (li % 2 === 0 ? -amplitude : amplitude);
                            const yOffset = li * nodeSpacing + 36;
                            const isCurrent =
                              lesson.lesson_id === path?.continue_lesson?.lesson_id ||
                              (path?.continue_lesson == null && lesson.lesson_id === path?.recommended_lesson?.lesson_id);

                            return (
<<<<<<< HEAD
                              <LessonNode
                                key={lesson.lesson_id}
                                item={lesson}
                                isCurrent={isCurrent}
                                onOpen={handleOpenLesson}
                                xOffset={xOffset}
                                yOffset={yOffset}
                              />
=======
                              <div
                                key={lesson.lesson_id}
                                className="absolute"
                                style={{
                                  left: xOffset,
                                  top: yOffset,
                                  transform: 'translate(-50%, -50%)',
                                }}
                              >
                                <LessonNode
                                  item={lesson}
                                  isCurrent={isCurrent}
                                  onOpen={handleOpenLesson}
                                />
                              </div>
>>>>>>> 02b8b59 (feat: add lesson detail page and toolbox components)
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* ── RIGHT: Sticky-feel sidebar (its own scroll on lg+) ── */}
            <aside
              className="w-full lg:w-80 xl:w-96 lg:shrink-0 lg:overflow-y-auto custom-scrollbar lg:border-l flex flex-col gap-4 px-4 sm:px-6 lg:px-5 pt-4 pb-10"
              style={{ borderColor: '#eef0eb', background: '#f9f9f9' }}
            >
              {activeGroup && (
                <ActiveUnitCard
                  group={activeGroup}
                  unitIndex={activeUnitIndex}
                  totalUnits={totalUnits}
                  onOpenLesson={handleOpenLesson}
                  onOpenGuidebook={() => handleOpenGuidebook(activeGroup)}
                />
              )}

              {/* Free Talk CTA */}
              <div
                className="rounded-3xl p-5 flex flex-col gap-3"
                style={{
                  background: '#ffffff',
                  border: '2px solid #e2e2e2',
                  boxShadow: '0 4px 0 #e2e2e2',
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ background: '#f4efff', color: '#8447ff' }}
                  >
                    <Mic size={18} strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Free Talk</p>
                    <p className="text-xs font-bold" style={{ color: '#1a1c1c' }}>Open conversation</p>
                  </div>
                </div>
                <p className="text-xs font-semibold" style={{ color: '#6f7b64' }}>
                  Chat freely in {profile?.targetLanguage ?? 'English'} — no deck, no score. Just talk.
                </p>
                <button
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.localStorage.setItem('speakup_next_session_mode', 'free_talk');
                    }
                    router.push('/chat?mode=free_talk');
                  }}
                  className="h-10 rounded-xl font-extrabold text-sm transition active:translate-y-0.5 flex items-center justify-center gap-2"
                  style={{ background: '#f4efff', color: '#8447ff', border: '2px solid #ebe0ff', boxShadow: '0 3px 0 #ebe0ff' }}
                >
                  <Mic size={15} /> Start Free Talk
                </button>
              </div>

              {/* Streak */}
              <div
                className="rounded-3xl p-5 flex items-center gap-4"
                style={{
                  background: 'linear-gradient(135deg, #ff9c27 0%, #ffb347 100%)',
                  border: '2px solid #e0851a',
                  boxShadow: '0 4px 0 #e0851a',
                }}
              >
                <Flame size={36} fill="#fff" strokeWidth={0} />
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#683a00' }}>Daily Streak</p>
                  <p className="text-4xl font-black leading-none" style={{ color: '#ffffff' }}>
                    {stats?.current_streak ?? 0}
                  </p>
                  <p className="text-xs font-bold mt-1" style={{ color: '#683a00' }}>
                    {(stats?.sessions_today ?? 0) > 0 ? 'Keep it up!' : 'Practice today!'}
                  </p>
                </div>
              </div>

              {/* Weekly chart */}
              <div
                className="rounded-3xl p-5"
                style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}
              >
                <div className="flex items-baseline justify-between mb-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>
                    Weekly Practice
                  </p>
                  <Zap size={14} color="#ff9c27" />
                </div>
                {(() => {
                  const WEEKDAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
                  const todayIndex = (new Date().getDay() + 6) % 7;
                  const weekly = stats?.weekly?.length
                    ? stats.weekly
                    : WEEKDAY_LABELS.map((day, index) => ({ day, count: 0, is_today: index === todayIndex }));
                  const maxWeekly = Math.max(1, ...weekly.map((d) => d.count));
                  return (
                    <div className="flex items-end justify-between gap-1 h-24">
                      {weekly.map((d) => (
                        <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-[9px] font-extrabold tabular-nums" style={{ color: d.count > 0 ? '#3f4a36' : '#d0d0d0' }}>
                            {d.count > 0 ? d.count : '·'}
                          </span>
                          <div className="w-full rounded-lg flex-1 flex items-end" style={{ background: '#f3f3f3', maxWidth: 32 }}>
                            <div
                              className="w-full rounded-lg transition-all"
                              style={{
                                height: `${Math.max(8, (d.count / maxWeekly) * 100)}%`,
                                background: d.is_today ? '#58cc02' : d.count > 0 ? '#bdee8c' : '#e2e2e2',
                              }}
                            />
                          </div>
                          <span className="text-[9px] font-extrabold" style={{ color: d.is_today ? '#2b6c00' : '#6f7b64' }}>
                            {d.day.slice(0, 2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Overall progress */}
              <div
                className="rounded-3xl p-5 flex flex-col gap-3"
                style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}
              >
                <div className="flex items-center gap-2">
                  <Trophy size={16} color="#ff9c27" />
                  <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>Overall progress</p>
                </div>
                {(() => {
                  const total = allLessons.length;
                  const done = allLessons.filter((l) => l.state === 'completed').length;
                  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                  return (
                    <>
                      <div className="flex items-baseline justify-between">
                        <span className="text-2xl font-black" style={{ color: '#1a1c1c' }}>{done}/{total}</span>
                        <span className="text-sm font-extrabold" style={{ color: '#58cc02' }}>{pct}%</span>
                      </div>
                      <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: '#f3f3f3' }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #58cc02, #3a8700)' }}
                        />
                      </div>
                      <p className="text-xs font-semibold" style={{ color: '#6f7b64' }}>
                        {total - done} lesson{total - done !== 1 ? 's' : ''} to go
                      </p>
                    </>
                  );
                })()}
              </div>

              {/* Quick navigation to chat history */}
              <button
                onClick={() => router.push('/chat')}
                className="rounded-3xl p-4 flex items-center gap-3 transition active:translate-y-0.5 text-left"
                style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: '#e8f9d3', color: '#1e5000' }}
                >
                  <BookOpen size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-extrabold" style={{ color: '#1a1c1c' }}>Chat history</p>
                  <p className="text-[11px] font-semibold" style={{ color: '#6f7b64' }}>Review past sessions</p>
                </div>
                <ChevronRight size={16} color="#becbb1" />
              </button>
            </aside>
          </div>
        )}

        <GuidebookDrawer group={guidebookGroup} onClose={handleCloseGuidebook} />
      </main>
    </div>
  );
}
