'use client';

import { useEffect, useState } from 'react';
import { sessionService, type SessionInsight } from '@/services/session.service';

function formatDaysAgo(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  if (n <= 0) return 'Last session: today';
  if (n === 1) return 'Last session: yesterday';
  return `Last session: ${n} days ago`;
}

export function MissionCard() {
  const [insight, setInsight] = useState<SessionInsight | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    sessionService.getInsight()
      .then((data) => {
        if (cancelled) return;
        setInsight(data);
        // Gentle fade-in on next frame so the opacity transition runs.
        requestAnimationFrame(() => setVisible(true));
      })
      .catch((err) => console.error('[mission-card]', err));
    return () => { cancelled = true; };
  }, []);

  if (!insight?.has_insight) return null;

  const lastSessionLabel = formatDaysAgo(insight.last_session_days_ago);
  const workingOn = insight.struggled_with?.trim();
  const challenge = (insight.active_mission ?? insight.next_challenge)?.trim();

  return (
    <div
      className={`mx-auto w-full max-w-md px-4 py-4 rounded-2xl bg-violet-50 border border-violet-100 transition-opacity duration-500 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {lastSessionLabel && (
        <p className="text-xs text-gray-400">{lastSessionLabel}</p>
      )}

      {workingOn && (
        <div className="mt-3">
          <p className="text-xs font-medium text-violet-500 uppercase tracking-wide">
            Working on
          </p>
          <p className="text-sm text-gray-700 mt-1">{workingOn}</p>
        </div>
      )}

      {challenge && (
        <div className="mt-3">
          <p className="text-xs font-medium text-[#8447FF] uppercase tracking-wide">
            Today&apos;s challenge →
          </p>
          <p className="text-sm font-semibold text-gray-800 mt-1">{challenge}</p>
        </div>
      )}
    </div>
  );
}
