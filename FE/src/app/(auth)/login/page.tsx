import { Logo } from '@/components/shared/logo/logo';
import { Zap, Target, Crown, Mic, Star } from 'lucide-react';
import { LoginFormContainer } from './login-form-container';

const features = [
  { icon: <Mic className="w-4 h-4" />, bg: '#d7ffb8', color: '#2b6c00', label: 'AI Conversations', sub: 'Real speaking practice' },
  { icon: <Target className="w-4 h-4" />, bg: '#dceeff', color: '#004666', label: 'Track Progress', sub: 'Session by session' },
  { icon: <Zap className="w-4 h-4" />, bg: '#ffe9cc', color: '#683a00', label: 'Instant Feedback', sub: 'Pronunciation & fluency' },
  { icon: <Crown className="w-4 h-4" />, bg: '#d7ffb8', color: '#2b6c00', label: 'Go Pro', sub: 'Unlimited every day' },
];

export default function LoginPage() {
  return (
    <div
      className="flex min-h-screen font-[family-name:var(--font-lexend)] relative overflow-hidden"
      style={{ background: '#f6faf6' }}
    >
      {/* ── Aurora orbs — the "mesh gradient" effect ───────────────────
          Strategy: near-white base + multiple very-large, very-blurred,
          low-opacity colored circles that bleed across section borders   */}

      {/* Green glow — top-left */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 700, height: 700, borderRadius: '50%',
          background: '#58cc02',
          opacity: 0.13,
          filter: 'blur(120px)',
          top: '-15%', left: '-10%',
        }}
      />
      {/* Blue glow — top-right */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 600, height: 600, borderRadius: '50%',
          background: '#2fb8ff',
          opacity: 0.10,
          filter: 'blur(110px)',
          top: '-10%', right: '-10%',
        }}
      />
      {/* Green-teal glow — center, spanning the divider */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 500, height: 500, borderRadius: '50%',
          background: '#a8edaf',
          opacity: 0.18,
          filter: 'blur(90px)',
          top: '30%', left: '28%',
        }}
      />
      {/* Orange glow — bottom-left */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 450, height: 450, borderRadius: '50%',
          background: '#ff9c27',
          opacity: 0.07,
          filter: 'blur(100px)',
          bottom: '-10%', left: '5%',
        }}
      />
      {/* Lavender glow — bottom-right */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 500, height: 500, borderRadius: '50%',
          background: '#b8d4ff',
          opacity: 0.12,
          filter: 'blur(110px)',
          bottom: '-15%', right: '-5%',
        }}
      />

      {/* ── Left branding panel ───────────────────────────────────── */}
      <section className="hidden lg:flex lg:w-1/2 flex-col justify-between items-center p-10 relative">
        <div className="relative z-10 w-full max-w-md"><Logo /></div>

        <div className="relative z-10 w-full max-w-md">
          <div
            className="rounded-[28px] p-8 mb-5"
            style={{
              background: 'linear-gradient(135deg,#58cc02 0%,#2fb8ff 100%)',
              color: '#fff',
              boxShadow: '0 6px 0 #2b6c00',
            }}
          >
            <span
              className="inline-flex px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-widest mb-5"
              style={{ background: 'rgba(255,255,255,0.22)' }}
            >
              AI Speaking Partner
            </span>
            <h1 className="text-4xl xl:text-5xl font-black leading-tight tracking-tight">
              Speak fluently.<br />Practice daily.
            </h1>
            <p className="text-sm font-bold mt-4" style={{ color: 'rgba(255,255,255,0.80)' }}>
              Your personal AI coach — real conversations, instant feedback, and steady progress.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {features.map((f) => (
              <div
                key={f.label}
                className="rounded-2xl p-4"
                style={{
                  background: 'rgba(255,255,255,0.72)',
                  border: '1.5px solid rgba(255,255,255,0.9)',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                }}
              >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5" style={{ background: f.bg, color: f.color }}>
                  {f.icon}
                </div>
                <p className="text-sm font-black" style={{ color: '#1a1c1c' }}>{f.label}</p>
                <p className="text-xs font-semibold" style={{ color: '#6f7b64' }}>{f.sub}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 w-full max-w-md flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5 fill-current" style={{ color: '#ff9c27' }} />
          <p className="text-xs font-bold" style={{ color: '#6f7b64' }}>Trusted by language learners worldwide.</p>
        </div>
      </section>

      {/* ── Right form panel ─────────────────────────────────────── */}
      <section
        className="flex w-full lg:w-1/2 flex-col justify-center items-center px-6 relative"
        style={{
          paddingTop: 'max(48px, env(safe-area-inset-top, 48px))',
          paddingBottom: 'max(48px, env(safe-area-inset-bottom, 48px))',
        }}
      >
        <div
          className="w-full max-w-sm relative z-10 rounded-[28px] p-8"
          style={{
            background: 'rgba(255,255,255,0.92)',
            border: '1.5px solid rgba(255,255,255,0.98)',
            boxShadow: '0 8px 32px rgba(88,204,2,0.07), 0 2px 12px rgba(0,0,0,0.06)',
          }}
        >
          <div className="mb-8 lg:hidden"><Logo /></div>

          <div className="mb-8">
            <p className="text-[11px] font-extrabold uppercase tracking-widest mb-2" style={{ color: '#58cc02' }}>Welcome back</p>
            <h2 className="text-3xl font-black tracking-tight" style={{ color: '#1a1c1c' }}>Continue learning</h2>
            <p className="text-sm font-semibold mt-1" style={{ color: '#6f7b64' }}>Sign in to keep your speaking streak alive.</p>
          </div>

          <LoginFormContainer />
        </div>
      </section>
    </div>
  );
}
