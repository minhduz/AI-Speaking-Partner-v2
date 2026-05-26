'use client';

/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, BookOpen, MessageSquare, FileText, Loader2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { httpClient } from '@/lib/http-client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LessonToolboxContext {
  /** Session ID — used to scope the /toolbox API call */
  sessionId?: string;
  /** Current lesson topic (e.g. "Ordering food") */
  topic?: string;
  /** Learner level (beginner | elementary | intermediate | upper_intermediate | advanced) */
  level?: string;
  /** The active card task text */
  currentTask?: string;
}

interface VocabItem {
  word: string;
  pronunciation?: string;
  meaning: string;
  example: string;
  example_vi?: string;
}

interface PhraseItem {
  pattern: string;
  meaning: string;
  meaning_vi?: string;
  examples: string[];
  examples_vi?: string[];
}

interface ToolboxResponse {
  error?: boolean;
  vocab?: VocabItem[];
  phrases?: PhraseItem[];
  sample_response?: string;
  sample_response_vi?: string;
  [key: string]: unknown;
}

type ToolboxTabKey = 'vocab' | 'phrases' | 'sample';

const toolboxResponseCache = new Map<string, ToolboxResponse>();
const TOOLBOX_CACHE_VERSION = 'toolbox-v4';

function getToolboxCacheKey(tab: ToolboxTabKey, ctx: LessonToolboxContext): string {
  return JSON.stringify({
    version: TOOLBOX_CACHE_VERSION,
    sessionId: ctx.sessionId ?? '',
    tab,
    topic: ctx.topic ?? '',
    level: ctx.level ?? 'beginner',
    task: ctx.currentTask ?? '',
  });
}

function getCachedToolboxTab(tab: ToolboxTabKey, ctx: LessonToolboxContext): ToolboxResponse | null {
  return toolboxResponseCache.get(getToolboxCacheKey(tab, ctx)) ?? null;
}

// ─── API fetcher ─────────────────────────────────────────────────────────────

async function fetchToolboxTab(
  sessionId: string,
  tab: ToolboxTabKey,
  ctx: LessonToolboxContext,
): Promise<ToolboxResponse> {
  const cacheKey = getToolboxCacheKey(tab, ctx);
  const cached = toolboxResponseCache.get(cacheKey);
  if (cached && (tab !== 'phrases' || cached.deterministic === true)) return cached;

  const params = new URLSearchParams({
    tab,
    topic: ctx.topic ?? '',
    level: ctx.level ?? 'beginner',
    task: ctx.currentTask ?? '',
  });
  const data = await httpClient.get<ToolboxResponse>(`/session/${sessionId}/toolbox?${params.toString()}`);
  toolboxResponseCache.set(cacheKey, data);
  return data;
}

// ─── Tab components ───────────────────────────────────────────────────────────

function VocabTab({ ctx }: { ctx: LessonToolboxContext }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<VocabItem[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const prevKey = useRef('');

  useEffect(() => {
    const key = `${ctx.sessionId}|${ctx.topic}|${ctx.level}|${ctx.currentTask}`;
    if (key === prevKey.current) return;
    prevKey.current = key;

    if (!ctx.sessionId) {
      setLoading(false);
      setError(true);
      return;
    }

    const cached = getCachedToolboxTab('vocab', ctx);
    if (cached) {
      const vocab = Array.isArray(cached?.vocab) ? cached.vocab : [];
      setItems(vocab);
      setLoading(false);
      setError(!!cached?.error || vocab.length === 0);
      setExpanded(null);
      return;
    }

    setLoading(true);
    setError(false);
    setExpanded(null);

    fetchToolboxTab(ctx.sessionId, 'vocab', ctx)
      .then((data) => {
        const vocab = Array.isArray(data?.vocab) ? data.vocab : [];
        setItems(vocab);
        if (data?.error) setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [ctx.sessionId, ctx.topic, ctx.level, ctx.currentTask]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-10 gap-3">
        <Loader2 size={22} className="animate-spin" style={{ color: '#58cc02' }} />
        <p className="text-xs font-semibold" style={{ color: '#becbb1' }}>Generating vocabulary…</p>
      </div>
    );
  }

  if (error || items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-10 gap-2 px-4 text-center">
        <AlertTriangle size={20} style={{ color: '#becbb1' }} />
        <p className="text-xs font-semibold" style={{ color: '#6f7b64' }}>
          Couldn&apos;t load vocabulary. Try switching tabs or refreshing.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-2">
      <p className="text-[10px] font-extrabold uppercase tracking-widest px-4 mb-1" style={{ color: '#6f7b64' }}>
        {ctx.topic ? `${ctx.topic} vocabulary` : 'Key vocabulary'}
      </p>
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => setExpanded(expanded === i ? null : i)}
          className="text-left px-4 py-3 rounded-xl transition-all"
          style={{
            background: expanded === i ? '#e8f9d3' : '#f9f9f9',
            border: `2px solid ${expanded === i ? '#bdee8c' : 'transparent'}`,
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-black" style={{ color: '#1a1c1c' }}>{item.word}</span>
              {item.pronunciation && (
                <span className="text-[11px] font-medium" style={{ color: '#9e9e9e' }}>{item.pronunciation}</span>
              )}
            </div>
            {expanded === i ? (
              <ChevronDown size={14} style={{ color: '#58cc02', flexShrink: 0 }} />
            ) : (
              <ChevronRight size={14} style={{ color: '#becbb1', flexShrink: 0 }} />
            )}
          </div>
          <p className="text-xs font-semibold mt-0.5" style={{ color: '#6f7b64' }}>{item.meaning}</p>
          {expanded === i && (
            <div className="mt-2 text-xs font-medium leading-snug" style={{ borderLeft: '3px solid #58cc02', paddingLeft: 8 }}>
              <p className="italic" style={{ color: '#3f4a36' }}>&ldquo;{item.example}&rdquo;</p>
              {item.example_vi && (
                <p className="mt-1" style={{ color: '#6f7b64' }}>{item.example_vi}</p>
              )}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

function PhrasesTab({ ctx }: { ctx: LessonToolboxContext }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PhraseItem[]>([]);
  const [error, setError] = useState(false);
  const prevKey = useRef('');

  useEffect(() => {
    const key = `${ctx.sessionId}|${ctx.topic}|${ctx.level}|${ctx.currentTask}`;
    if (key === prevKey.current) return;
    prevKey.current = key;

    if (!ctx.sessionId) {
      setLoading(false);
      setError(true);
      return;
    }

    const cached = getCachedToolboxTab('phrases', ctx);
    if (cached?.deterministic === true) {
      const phrases = Array.isArray(cached?.phrases) ? cached.phrases : [];
      setItems(phrases);
      setLoading(false);
      setError(!!cached?.error || phrases.length === 0);
      return;
    }

    setLoading(true);
    setError(false);

    fetchToolboxTab(ctx.sessionId, 'phrases', ctx)
      .then((data) => {
        const phrases = Array.isArray(data?.phrases) ? data.phrases : [];
        setItems(phrases);
        if (data?.error) setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [ctx.sessionId, ctx.topic, ctx.level, ctx.currentTask]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-10 gap-3">
        <Loader2 size={22} className="animate-spin" style={{ color: '#8447ff' }} />
        <p className="text-xs font-semibold" style={{ color: '#becbb1' }}>Generating phrase patterns…</p>
      </div>
    );
  }

  if (error || items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-10 gap-2 px-4 text-center">
        <AlertTriangle size={20} style={{ color: '#becbb1' }} />
        <p className="text-xs font-semibold" style={{ color: '#6f7b64' }}>
          Couldn&apos;t load phrase patterns. Try switching tabs or refreshing.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="text-[10px] font-extrabold uppercase tracking-widest px-4 mb-1" style={{ color: '#6f7b64' }}>
        Useful patterns
      </p>
      {items.map((item, i) => (
        <div
          key={i}
          className="mx-0 rounded-xl overflow-hidden"
          style={{ border: '2px solid #e2e2e2' }}
        >
          <div className="px-4 py-2.5" style={{ background: '#f4efff' }}>
            <p className="text-sm font-black" style={{ color: '#1a1c1c' }}>{item.pattern}</p>
            <p className="text-xs font-semibold mt-0.5" style={{ color: '#8447ff' }}>{item.meaning_vi ?? item.meaning}</p>
          </div>
          <div className="px-4 py-2.5 flex flex-col gap-1.5" style={{ background: '#ffffff' }}>
            {(item.examples ?? []).map((ex, j) => (
              <div key={j} className="leading-snug">
                <p className="text-xs font-medium italic" style={{ color: '#3f4a36' }}>&ldquo;{ex}&rdquo;</p>
                {item.examples_vi?.[j] && (
                  <p className="text-[11px] font-semibold mt-0.5" style={{ color: '#6f7b64' }}>{item.examples_vi[j]}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SampleTab({ ctx }: { ctx: LessonToolboxContext }) {
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [textVi, setTextVi] = useState('');
  const [error, setError] = useState(false);
  const prevKey = useRef('');

  useEffect(() => {
    const key = `${ctx.sessionId}|${ctx.topic}|${ctx.level}|${ctx.currentTask}`;
    if (key === prevKey.current) return;
    prevKey.current = key;

    if (!ctx.sessionId) {
      setLoading(false);
      setError(true);
      return;
    }

    const cached = getCachedToolboxTab('sample', ctx);
    if (cached) {
      const sample = typeof cached?.sample_response === 'string' ? cached.sample_response : '';
      const sampleVi = typeof cached?.sample_response_vi === 'string' ? cached.sample_response_vi : '';
      setText(sample);
      setTextVi(sampleVi);
      setLoading(false);
      setError(!!cached?.error || !sample);
      return;
    }

    setLoading(true);
    setError(false);

    fetchToolboxTab(ctx.sessionId, 'sample', ctx)
      .then((data) => {
        const sample = typeof data?.sample_response === 'string' ? data.sample_response : '';
        const sampleVi = typeof data?.sample_response_vi === 'string' ? data.sample_response_vi : '';
        setText(sample);
        setTextVi(sampleVi);
        if (data?.error || !sample) setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [ctx.sessionId, ctx.topic, ctx.level, ctx.currentTask]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-10 gap-3">
        <Loader2 size={22} className="animate-spin" style={{ color: '#ff9c27' }} />
        <p className="text-xs font-semibold" style={{ color: '#becbb1' }}>Generating sample response…</p>
      </div>
    );
  }

  if (error || !text) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-10 gap-2 px-4 text-center">
        <AlertTriangle size={20} style={{ color: '#becbb1' }} />
        <p className="text-xs font-semibold" style={{ color: '#6f7b64' }}>
          Couldn&apos;t generate a sample response. Try switching tabs or refreshing.
        </p>
      </div>
    );
  }

  const lines = text.split('\n');
  const viLines = textVi.split('\n');

  return (
    <div className="flex flex-col gap-3 py-2 px-4">
      <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>
        Sample response
      </p>
      <div
        className="rounded-xl p-4 flex flex-col gap-2"
        style={{ background: '#fffbf0', border: '2px solid #ffe28a' }}
      >
        {lines.map((line, i) => {
          if (!line.trim()) return <div key={i} className="h-1" />;
          return (
            <p
              key={i}
              className="text-sm leading-relaxed"
              style={{
                color: '#1a1c1c',
                fontWeight: 500,
                fontFamily: 'Lexend, sans-serif',
              }}
            >
              {line}
            </p>
          );
        })}
      </div>
      {textVi && (
        <div
          className="rounded-xl p-4 flex flex-col gap-2"
          style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}
        >
          <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>
            Tiếng Việt
          </p>
          {viLines.map((line, i) => {
            if (!line.trim()) return <div key={i} className="h-1" />;
            return (
              <p
                key={i}
                className="text-sm leading-relaxed"
                style={{
                  color: '#3f4a36',
                  fontWeight: 500,
                  fontFamily: 'Lexend, sans-serif',
                }}
              >
                {line}
              </p>
            );
          })}
        </div>
      )}
      <p className="text-[11px] font-semibold text-center" style={{ color: '#becbb1' }}>
        Use this as inspiration — speak in your own words!
      </p>
    </div>
  );
}

// ─── Main Toolbox ─────────────────────────────────────────────────────────────

export type ToolboxTab = 'vocab' | 'phrases' | 'sample';

interface LessonToolboxProps {
  isOpen: boolean;
  onClose: () => void;
  ctx: LessonToolboxContext;
  /** Floating position mode: 'panel' (desktop right rail) | 'sheet' (mobile bottom sheet) */
  mode?: 'panel' | 'sheet';
}

export function LessonToolbox({ isOpen, onClose, ctx, mode = 'sheet' }: LessonToolboxProps) {
  const [tab, setTab] = useState<ToolboxTab>('vocab');

  const handleTabChange = useCallback((t: ToolboxTab) => {
    setTab(t);
  }, []);

  if (!isOpen) return null;

  const tabs: { key: ToolboxTab; label: string; icon: React.ReactNode; color: string }[] = [
    { key: 'vocab',   label: 'Từ vựng',  icon: <BookOpen size={15} />,      color: '#58cc02' },
    { key: 'phrases', label: 'Mẫu câu',  icon: <MessageSquare size={15} />, color: '#8447ff' },
    { key: 'sample',  label: 'Bài mẫu',  icon: <FileText size={15} />,      color: '#ff9c27' },
  ];

  const activeColor = tabs.find((t) => t.key === tab)?.color ?? '#58cc02';

  const content = (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        background: '#ffffff',
        borderRadius: mode === 'panel' ? 24 : '24px 24px 0 0',
        border: '2px solid #e2e2e2',
        boxShadow: mode === 'panel' ? '0 8px 32px rgba(0,0,0,0.12)' : '0 -8px 32px rgba(0,0,0,0.12)',
        fontFamily: 'Lexend, sans-serif',
        height: mode === 'panel' ? '100%' : undefined,
        maxHeight: mode === 'sheet' ? '80vh' : undefined,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '2px solid #f3f3f3' }}
      >
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#becbb1' }}>
            {ctx.topic ?? 'Lesson tools'}
          </p>
          <p className="text-base font-black" style={{ color: '#1a1c1c' }}>Toolbox</p>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full transition"
          style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}
          aria-label="Close toolbox"
        >
          <X size={16} style={{ color: '#6f7b64' }} />
        </button>
      </div>

      {/* Context hint */}
      {ctx.currentTask && (
        <div
          className="mx-4 mt-3 rounded-xl px-3 py-2 shrink-0"
          style={{ background: '#f9f9f9', border: '2px solid #e2e2e2' }}
        >
          <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#6f7b64' }}>
            Current task
          </p>
          <p className="text-xs font-semibold mt-0.5 leading-snug" style={{ color: '#1a1c1c' }}>
            {ctx.currentTask.length > 120 ? ctx.currentTask.slice(0, 118) + '…' : ctx.currentTask}
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 px-4 mt-3 shrink-0">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-extrabold transition-all"
              style={{
                background: active ? `${t.color}20` : 'transparent',
                color: active ? t.color : '#6f7b64',
                border: `2px solid ${active ? `${t.color}60` : 'transparent'}`,
              }}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="mx-4 mt-2 h-0.5 shrink-0" style={{ background: `${activeColor}30` }} />

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'vocab'   && <VocabTab ctx={ctx} />}
        {tab === 'phrases' && <PhrasesTab ctx={ctx} />}
        {tab === 'sample'  && <SampleTab ctx={ctx} />}
      </div>
    </div>
  );

  if (mode === 'panel') {
    return (
      <div className="h-full overflow-hidden">
        {content}
      </div>
    );
  }

  // Mobile sheet: overlay + bottom sheet
  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col justify-end"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}

// ─── Trigger button ────────────────────────────────────────────────────────────

export function LessonToolboxTrigger({
  onClick,
  isOpen,
}: {
  onClick: () => void;
  isOpen: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl font-extrabold text-xs transition-all select-none"
      style={{
        background: isOpen ? '#e8f9d3' : '#ffffff',
        color: isOpen ? '#1e5000' : '#3f4a36',
        border: `2px solid ${isOpen ? '#bdee8c' : '#e2e2e2'}`,
        boxShadow: `0 3px 0 ${isOpen ? '#bdee8c' : '#e2e2e2'}`,
        fontFamily: 'Lexend, sans-serif',
        transform: isOpen ? 'translateY(1px)' : undefined,
      }}
      aria-label="Open lesson toolbox"
    >
      <BookOpen size={14} />
      Toolbox
    </button>
  );
}
