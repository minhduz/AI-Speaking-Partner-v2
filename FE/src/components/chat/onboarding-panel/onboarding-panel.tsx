'use client';

import type { OnboardingState } from '@/services/session.service';

const MOTIVATION_LABELS: Record<string, string> = {
  casual: 'casual learner',
  career: 'career-focused',
  travel: 'travel prep',
  education: 'academic goals',
  social: 'social connection',
};

const CONFIDENCE_LABELS: Record<string, string> = {
  high: 'comfortable speaking',
  medium: 'building confidence',
  low: 'prefers gentle warm-up',
};

const ENERGY_LABELS: Record<string, string> = {
  excited: 'high energy today',
  relaxed: 'prefers relaxed pace',
  nervous: 'needs gentle pace',
  neutral: 'balanced pace',
};

interface OnboardingPanelProps {
  isVisible: boolean;
  state: OnboardingState | null;
  className?: string;
}

function useful(value: string | null | undefined): boolean {
  return Boolean(value && value !== 'unclear');
}

export function getOnboardingPanelItems(state: OnboardingState | null): string[] {
  if (!state) return [];

  const items: string[] = [];

  if (useful(state.motivation)) {
    items.push(MOTIVATION_LABELS[state.motivation as string] ?? (state.motivation as string));
  }
  if (useful(state.confidence_signal)) {
    items.push(CONFIDENCE_LABELS[state.confidence_signal as string] ?? 'adapting confidence');
  }
  if (useful(state.emotional_energy)) {
    items.push(ENERGY_LABELS[state.emotional_energy as string] ?? 'adapting pace');
  }
  for (const fact of state.facts ?? []) {
    if (fact && items.length < 4) items.push(fact);
  }

  return items.slice(0, 4);
}

export function hasOnboardingPanelContent(isVisible: boolean, state: OnboardingState | null): boolean {
  return isVisible && getOnboardingPanelItems(state).length >= 2;
}

export function OnboardingPanel({ isVisible, state, className = '' }: OnboardingPanelProps) {
  const visibleItems = getOnboardingPanelItems(state);

  // Wait until we have at least 2 useful labels so the panel does not surface noise too early.
  if (visibleItems.length < 2) return null;
  if (!isVisible) return null;

  return (
    <aside
      className={`hidden rounded-[24px] bg-white px-4 py-4 backdrop-blur-sm md:block ${className}`}
      style={{ border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2', fontFamily: 'Lexend, sans-serif' }}
    >
      <div className="mb-3 flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: '#dceeff', color: '#004666', border: '2px solid #c8e6ff' }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v3" />
            <path d="M12 18v3" />
            <path d="M3 12h3" />
            <path d="M18 12h3" />
            <path d="m5.6 5.6 2.1 2.1" />
            <path d="m16.3 16.3 2.1 2.1" />
            <path d="m18.4 5.6-2.1 2.1" />
            <path d="m7.7 16.3-2.1 2.1" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: '#004666' }}>Learning</p>
          <p className="text-sm font-black leading-tight" style={{ color: '#1a1c1c' }}>About you</p>
        </div>
      </div>

      <div className="space-y-2">
        {visibleItems.map((item, index) => (
          <p
            key={`${item}-${index}`}
            className="flex items-start gap-2 rounded-2xl px-3 py-2 text-xs font-bold leading-snug transition-opacity duration-500"
            style={{ animationDelay: `${index * 120}ms`, background: '#f8fbff', color: '#3c3c3c', border: '1px solid #d8edf7' }}
          >
            <span className="mt-0.5 shrink-0" style={{ color: '#58cc02' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <span>{item}</span>
          </p>
        ))}
      </div>
    </aside>
  );
}
