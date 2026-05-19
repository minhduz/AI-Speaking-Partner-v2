// Shared UI primitives — billing · Vibrant Play design system
// Color philosophy: flat solid colors from palette, NOT gradients
// Green #58cc02 = primary-container | Blue #2fb8ff = secondary-container | Orange #ff9c27 = tertiary-container
import { AlertCircle } from 'lucide-react';

export function UsageBar({ pct, warn }: { pct: number; warn?: boolean }) {
  const bg =
    warn && pct >= 90 ? '#ba1a1a'
    : warn && pct >= 70 ? '#ff9c27'
    : '#58cc02';
  return (
    <div className="h-3 w-full rounded-full overflow-hidden" style={{ background: '#eeeeee' }}>
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.min(100, pct)}%`, background: bg }}
      />
    </div>
  );
}

export function Badge({
  children,
  variant = 'primary',
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'pro' | 'soft' | 'green';
}) {
  const style =
    variant === 'pro'     ? { background: '#1e5000', color: '#ffffff' } :
    variant === 'primary' ? { background: '#58cc02', color: '#1e5000' } :
    variant === 'green'   ? { background: '#dff5c5', color: '#1e5000' } :
                            { background: '#eeeeee', color: '#3f4a36' };
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-extrabold px-3 py-1 rounded-full"
      style={{ fontFamily: 'Lexend, sans-serif', ...style }}
    >
      {children}
    </span>
  );
}

// White card — 2px border + bottom lip shadow (Vibrant Play standard)
export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-3xl p-6 ${className}`}
      style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  icon, title, right,
}: {
  icon: React.ReactNode; title: string; right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div className="flex items-center gap-2.5">
        {icon}
        <span className="text-sm font-extrabold" style={{ color: '#1a1c1c', fontFamily: 'Lexend, sans-serif' }}>{title}</span>
      </div>
      {right}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold"
      style={{ background: '#ffdad6', color: '#93000a', border: '2px solid #f2b8b5', fontFamily: 'Lexend, sans-serif' }}
    >
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      {message}
    </div>
  );
}

// Icon badge — flat solid color, matches sidebar NavLink icon badge style
export function IconBox({
  children,
  color = 'green',
}: {
  children: React.ReactNode;
  color?: 'green' | 'blue' | 'orange' | 'gray' | 'red';
}) {
  const style: Record<string, React.CSSProperties> = {
    green:  { background: '#dff5c5', color: '#2b6c00' },
    blue:   { background: '#dceeff', color: '#004666' },
    orange: { background: '#ffe9cc', color: '#8c5000' },
    red:    { background: '#ffdad6', color: '#93000a' },
    gray:   { background: '#eeeeee', color: '#6f7b64' },
  };
  return (
    <div
      className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0"
      style={style[color]}
    >
      {children}
    </div>
  );
}
