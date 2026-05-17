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
}

function useful(value: string | null | undefined): boolean {
  return Boolean(value && value !== 'unclear');
}

export function OnboardingPanel({ isVisible, state }: OnboardingPanelProps) {
  if (!isVisible || !state) return null;

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

  const visibleItems = items.slice(0, 4);

  // Wait until we have at least 2 useful labels — avoids surfacing noise too early.
  // Weakness hints intentionally never reach the panel.
  if (visibleItems.length < 2) return null;

  return (
    <aside className="fixed bottom-24 left-4 max-w-[200px] rounded-2xl border border-gray-100 bg-white/80 px-3 py-3 shadow-sm backdrop-blur-sm">
      <p className="mb-2 text-xs font-medium text-gray-400">Learning about you...</p>
      <div className="space-y-1.5">
        {visibleItems.map((item, index) => (
          <p
            key={`${item}-${index}`}
            className="text-xs text-gray-600 transition-opacity duration-500"
            style={{ animationDelay: `${index * 120}ms` }}
          >
            <span className="text-violet-500 mr-1">✓</span>
            {item}
          </p>
        ))}
      </div>
    </aside>
  );
}
