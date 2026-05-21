'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Flame } from 'lucide-react';
import { userService } from '@/services/user.service';
import { progressService } from '@/services/progress.service';

/* ── Language → ISO 3166-1 alpha-2 country code ──────────────────── */
const LANG_CODES: Record<string, string> = {
  english:    'us',
  spanish:    'es',
  french:     'fr',
  japanese:   'jp',
  korean:     'kr',
  chinese:    'cn',
  mandarin:   'cn',
  german:     'de',
  vietnamese: 'vn',
  portuguese: 'br',
  italian:    'it',
  russian:    'ru',
  arabic:     'sa',
  thai:       'th',
  dutch:      'nl',
  swedish:    'se',
  hindi:      'in',
  turkish:    'tr',
  polish:     'pl',
  indonesian: 'id',
};

function getLangCode(lang: string | null | undefined): string | null {
  if (!lang) return null;
  return LANG_CODES[lang.toLowerCase().trim()] ?? null;
}

/* ── Props ────────────────────────────────────────────────────────── */
export interface PageHeaderProps {
  title: string;
  mobileTitle?: string;
  /** Optional right-side slot (e.g. word count, secure QR badge) */
  rightSlot?: React.ReactNode;
  onBack?: () => void;
  /** Hide the mobile back button — for top-level destinations like Home. */
  hideBack?: boolean;
}

/* ── Component ────────────────────────────────────────────────────── */
export function PageHeader({ title, mobileTitle, rightSlot, onBack, hideBack = false }: Readonly<PageHeaderProps>) {
  const router = useRouter();
  const [langCode, setLangCode] = useState<string | null>(null);
  const [level,    setLevel]    = useState<string | null>(null);
  const [streak,   setStreak]   = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Fluency level + target language live on the user profile.
    userService.me()
      .then((u) => {
        if (cancelled) return;
        setLangCode(getLangCode(u.targetLanguage));
        setLevel(u.level ?? null);
      })
      .catch(() => {
        if (!cancelled) { setLangCode(null); setLevel(null); }
      });
    // Streak comes from the dashboard progress endpoint — same source the
    // Home dashboard uses, so the chip stays in sync.
    progressService.getDashboardStats()
      .then((s) => { if (!cancelled) setStreak(s?.current_streak ?? 0); })
      .catch(() => { if (!cancelled) setStreak(0); });
    return () => { cancelled = true; };
  }, []);

  const levelLabel = level ? level.charAt(0).toUpperCase() + level.slice(1) : null;

  return (
    <header
      className="shrink-0 flex items-center gap-3 px-4 sm:px-8 h-14 sm:h-20 sticky top-0 z-40"
      style={{
        background: '#f9f9f9',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {/* ── Back button: mobile only (PWA navigation).
            Top-level destinations like Home pass `hideBack` so there is no
            misleading back arrow on a tab that already lives at the root. ── */}
      {!hideBack && (
        <button
          onClick={onBack ?? (() => router.back())}
          aria-label="Go back"
          className="lg:hidden shrink-0 flex items-center justify-center rounded-2xl transition-all active:scale-90"
          style={{
            width: 40, height: 40,
            background: '#ffffff',
            border: '2px solid #e2e2e2',
            boxShadow: '0 3px 0 #e2e2e2',
            color: '#3c3c3c',
          }}
        >
          <ArrowLeft size={18} strokeWidth={2.5} />
        </button>
      )}

      {/* ── Title ── */}
      <h1
        className="flex-1 min-w-0 truncate text-xl sm:text-2xl font-black"
        style={{ color: '#2b6c00', letterSpacing: '-0.01em', fontFamily: 'Lexend, sans-serif' }}
      >
        {mobileTitle ? (
          <>
            <span className="lg:hidden">{mobileTitle}</span>
            <span className="hidden lg:inline">{title}</span>
          </>
        ) : title}
      </h1>

      {/* ── Optional right-slot (passed by each page) ── */}
      {rightSlot}

      {/* ── Flag chip ── */}
      {langCode && (
        <div
          className="shrink-0 flex items-center justify-center rounded-2xl transition-all"
          style={{
            width: 50, height: 40,
            background: '#ffffff',
            border: '2px solid #e2e2e2',
            boxShadow: '0 3px 0 #e2e2e2',
          }}
        >
          {/* Real flag image from flagcdn.com — not emoji */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://flagcdn.com/w40/${langCode}.png`}
            alt={langCode}
            width={40}
            height={27}
            style={{
              objectFit: 'cover',
              width: 32,
              height: 22,
              borderRadius: 4,
              border: '1px solid rgba(0,0,0,0.08)',
              display: 'block',
            }}
          />
        </div>
      )}

      {/* ── Fluency level chip ── */}
      {levelLabel && (
        <div
          className="shrink-0 hidden sm:flex items-center rounded-2xl px-3"
          style={{
            height: 40,
            background: '#f4efff',
            border: '2px solid #ebe0ff',
            boxShadow: '0 3px 0 #ebe0ff',
          }}
        >
          <span
            className="text-[11px] font-extrabold uppercase tracking-widest"
            style={{ color: '#8447ff' }}
          >
            {levelLabel}
          </span>
        </div>
      )}

      {/* ── Streak chip ── */}
      {streak !== null && (
        <div
          className="shrink-0 flex items-center gap-1.5 rounded-2xl px-3"
          style={{
            height: 40,
            background: '#ffffff',
            border: '2px solid #e2e2e2',
            boxShadow: '0 3px 0 #e2e2e2',
          }}
        >
          <Flame
            size={16}
            strokeWidth={0}
            fill={streak > 0 ? '#ff7b00' : '#d4d4d4'}
          />
          <span
            className="text-sm font-black tabular-nums"
            style={{ color: streak > 0 ? '#ff7b00' : '#afafaf' }}
          >
            {streak}
          </span>
        </div>
      )}
    </header>
  );
}
