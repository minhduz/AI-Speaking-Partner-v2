// Shared UI primitives — billing
// Design: Soft Minimalism — neutral base + selective pastel tints + single violet accent
// Cards defined by shadow, not border. Pastel tints add personality per-section.
import { AlertCircle } from 'lucide-react';

export function UsageBar({ pct, warn }: { pct: number; warn?: boolean }) {
  const fill =
    warn && pct >= 90 ? 'bg-rose-500'
    : warn && pct >= 70 ? 'bg-amber-400'
    : 'bg-[#8447FF]';
  return (
    <div className="h-2.5 w-full rounded-full overflow-hidden bg-gray-200">
      <div
        className={`h-full rounded-full transition-all duration-700 ${fill}`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

export function Badge({
  children,
  variant = 'primary',
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'soft' | 'green';
}) {
  const cls =
    variant === 'primary' ? 'bg-[#8447FF] text-white' :
    variant === 'green'   ? 'bg-emerald-100 text-emerald-700' :
                            'bg-violet-100 text-[#7C3AED]';
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1 rounded-full ${cls}`}>
      {children}
    </span>
  );
}

// Default card: white + shadow, no border
export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-3xl shadow-sm p-6 ${className}`}>
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
        <span className="text-sm font-bold text-gray-800">{title}</span>
      </div>
      {right}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3 text-sm text-rose-600">
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      {message}
    </div>
  );
}

export function IconBox({
  children,
  color = 'purple',
}: {
  children: React.ReactNode;
  color?: 'purple' | 'green' | 'gray' | 'amber';
}) {
  const bg =
    color === 'purple' ? 'bg-violet-100' :
    color === 'green'  ? 'bg-emerald-100' :
    color === 'amber'  ? 'bg-amber-100' :
                         'bg-gray-100';
  return (
    <div className={`w-9 h-9 rounded-2xl ${bg} flex items-center justify-center flex-shrink-0`}>
      {children}
    </div>
  );
}
