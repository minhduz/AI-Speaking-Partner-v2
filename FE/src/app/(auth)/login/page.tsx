import { Logo } from '@/components/shared/logo/logo';
import { Zap, Target, Crown, Mic } from 'lucide-react';
import { LoginFormContainer } from './login-form-container';

const features = [
  { icon: <Mic className="w-4 h-4" />, bg: '#d7ffb8', color: '#2b6c00', label: 'AI Conversations', sub: 'Real speaking practice' },
  { icon: <Target className="w-4 h-4" />, bg: '#dceeff', color: '#004666', label: 'Track Progress', sub: 'Session by session' },
  { icon: <Zap className="w-4 h-4" />, bg: '#ffe9cc', color: '#683a00', label: 'Instant Feedback', sub: 'Pronunciation & fluency' },
  { icon: <Crown className="w-4 h-4" />, bg: '#d7ffb8', color: '#2b6c00', label: 'Go Pro', sub: 'Unlimited every day' },
];

export default function LoginPage() {
  return (
    <div className="flex min-h-screen font-[family-name:var(--font-lexend)]" style={{ background: '#f9f9f9' }}>
      <section className="hidden lg:flex lg:w-[52%] flex-col justify-between p-10 relative overflow-hidden">
        <div className="absolute top-10 right-10 w-72 h-72 rounded-full opacity-70 pointer-events-none" style={{ background: '#d7ffb8', filter: 'blur(10px)' }} />
        <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full opacity-80 pointer-events-none" style={{ background: '#dceeff', filter: 'blur(12px)', transform: 'translate(-30%, 30%)' }} />

        <div className="relative z-10"><Logo /></div>

        <div className="relative z-10 max-w-lg">
          <div className="rounded-[36px] p-8 mb-6" style={{ background: 'linear-gradient(135deg,#58cc02 0%,#2fb8ff 100%)', color: '#fff', boxShadow: '0 6px 0 #2b6c00' }}>
            <span className="inline-flex px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-widest mb-5" style={{ background: 'rgba(255,255,255,0.22)' }}>
              AI Speaking Partner
            </span>
            <h1 className="text-5xl font-black leading-tight tracking-tight">
              Speak fluently.<br />Practice daily.
            </h1>
            <p className="text-base font-bold mt-4 max-w-sm" style={{ color: 'rgba(255,255,255,0.78)' }}>
              Your personal AI coach — real conversations, instant feedback, and steady progress.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {features.map((f) => (
              <div key={f.label} className="rounded-3xl p-4" style={{ background: '#fff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
                <div className="w-9 h-9 rounded-2xl flex items-center justify-center mb-3" style={{ background: f.bg, color: f.color }}>
                  {f.icon}
                </div>
                <p className="text-sm font-black" style={{ color: '#1a1c1c' }}>{f.label}</p>
                <p className="text-xs font-semibold" style={{ color: '#6f7b64' }}>{f.sub}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-xs font-bold" style={{ color: '#6f7b64' }}>Trusted by language learners worldwide.</p>
      </section>

      <section className="flex flex-1 flex-col justify-center px-8 py-12 lg:px-14 relative">
        <div className="lg:hidden absolute top-0 right-0 w-40 h-40 rounded-full opacity-70 translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ background: '#d7ffb8' }} />
        <div className="w-full max-w-sm mx-auto relative z-10 rounded-[32px] p-6 lg:p-0 lg:rounded-none" style={{ background: 'transparent' }}>
          <div className="mb-8 lg:hidden"><Logo /></div>
          <div className="mb-8">
            <p className="text-[11px] font-extrabold uppercase tracking-widest mb-2" style={{ color: '#2b6c00' }}>Welcome back</p>
            <h2 className="text-3xl font-black tracking-tight" style={{ color: '#1a1c1c' }}>Continue learning</h2>
            <p className="text-sm font-semibold mt-1" style={{ color: '#6f7b64' }}>Sign in to keep your speaking streak alive.</p>
          </div>
          <LoginFormContainer />
        </div>
      </section>
    </div>
  );
}
