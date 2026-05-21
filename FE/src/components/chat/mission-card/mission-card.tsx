'use client';

import { useEffect, useState } from 'react';
import { sessionService, type SessionInsight } from '@/services/session.service';

function formatDaysAgo(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  return `${n} days ago`;
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
      className={`w-full max-w-xl mx-auto rounded-2xl overflow-hidden transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
      style={{ border: '2.5px solid #e5d9ff', background: '#fff', boxShadow: '0 4px 0 #e5d9ff' }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ background: 'linear-gradient(135deg, #8447FF 0%, #a47bff 100%)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg" role="img" aria-label="target">🎯</span>
          <span className="text-sm font-extrabold text-white tracking-wide uppercase">Today&apos;s Mission</span>
        </div>
        {lastSessionLabel && (
          <span className="text-xs font-semibold text-white/70 bg-white/15 px-2.5 py-1 rounded-full">
            Last: {lastSessionLabel}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-4 flex flex-col gap-3">
        {workingOn && (
          <div className="flex items-start gap-2.5">
            <span
              className="mt-0.5 shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white"
              style={{ background: '#FF9600' }}
            >
              !
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: '#FF9600' }}>
                Working on
              </p>
              <p className="text-sm font-semibold" style={{ color: '#3c3c3c' }}>{workingOn}</p>
            </div>
          </div>
        )}

        {challenge && (
          <div className="flex items-start gap-2.5">
            <span
              className="mt-0.5 shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white"
              style={{ background: '#58CC02' }}
            >
              ✓
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: '#58CC02' }}>
                Challenge
              </p>
              <p className="text-sm font-semibold" style={{ color: '#3c3c3c' }}>{challenge}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
