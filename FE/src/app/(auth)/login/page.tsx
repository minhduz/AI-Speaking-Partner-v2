import { Logo } from '@/components/shared/logo/logo';
import { Zap, Target, Crown, Mic } from 'lucide-react';
import { LoginFormContainer } from './login-form-container';

// Static mini bento cards shown on the hero panel
const features = [
  {
    icon: <Mic className="w-4 h-4 text-[#8447FF]" />,
    bg: 'bg-violet-100',
    label: 'AI Conversations',
    sub: 'Real speaking practice',
    cardBg: 'bg-[#F5F0FF]',
  },
  {
    icon: <Target className="w-4 h-4 text-emerald-600" />,
    bg: 'bg-emerald-100',
    label: 'Track Progress',
    sub: 'Session by session',
    cardBg: 'bg-emerald-50',
  },
  {
    icon: <Zap className="w-4 h-4 text-amber-600" />,
    bg: 'bg-amber-100',
    label: 'Instant Feedback',
    sub: 'Pronunciation & fluency',
    cardBg: 'bg-amber-50',
  },
  {
    icon: <Crown className="w-4 h-4 text-[#8447FF]" />,
    bg: 'bg-violet-100',
    label: 'Go Pro',
    sub: 'Unlimited every day',
    cardBg: 'bg-[#EDE9FE]',
  },
];

export default function LoginPage() {
  return (
    <div className="flex min-h-screen font-[family-name:var(--font-lexend)]">

      {/* ── LEFT HERO PANEL ── desktop only ─────────────────────────── */}
      <div className="hidden lg:flex lg:w-[52%] bg-[#F8F9FB] flex-col justify-between p-10 relative overflow-hidden">

        {/* Subtle pastel blob — top-right */}
        <div className="absolute top-0 right-0 w-72 h-72 rounded-full bg-[#EDE9FE] opacity-70 translate-x-1/3 -translate-y-1/3 pointer-events-none" />
        {/* Subtle pastel blob — bottom-left */}
        <div className="absolute bottom-0 left-0 w-56 h-56 rounded-full bg-emerald-50 opacity-80 -translate-x-1/3 translate-y-1/3 pointer-events-none" />

        {/* Logo top-left */}
        <div className="relative z-10">
          <Logo />
        </div>

        {/* Central content */}
        <div className="relative z-10 flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#8447FF]">
              AI Speaking Partner
            </span>
            <h1 className="text-4xl font-bold text-gray-900 leading-tight">
              Speak fluently.<br />
              <span className="text-[#8447FF]">Practice daily.</span>
            </h1>
            <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
              Your personal AI coach — real conversations, real feedback, real progress.
            </p>
          </div>

          {/* Bento mini-cards grid */}
          <div className="grid grid-cols-2 gap-3 max-w-sm">
            {features.map((f) => (
              <div
                key={f.label}
                className={`${f.cardBg} rounded-2xl p-4 flex flex-col gap-2.5 shadow-sm`}
              >
                <div className={`w-8 h-8 rounded-xl ${f.bg} flex items-center justify-center`}>
                  {f.icon}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">{f.label}</p>
                  <p className="text-xs text-gray-400">{f.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom tagline */}
        <div className="relative z-10">
          <p className="text-xs text-gray-400">
            Trusted by language learners worldwide.
          </p>
        </div>
      </div>

      {/* ── RIGHT FORM PANEL ──────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col justify-center px-8 py-12 lg:px-14 bg-white relative">

        {/* Subtle top-right accent on mobile */}
        <div className="lg:hidden absolute top-0 right-0 w-40 h-40 rounded-full bg-[#F5F0FF] opacity-60 translate-x-1/2 -translate-y-1/2 pointer-events-none" />

        <div className="w-full max-w-sm mx-auto relative z-10">

          {/* Mobile logo */}
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
            <p className="text-sm text-gray-500 mt-1">
              Sign in to continue your linguistic journey.
            </p>
          </div>

          {/* Form — no extra card wrapper, white bg IS the card */}
          <LoginFormContainer />

        </div>
      </div>
    </div>
  );
}
