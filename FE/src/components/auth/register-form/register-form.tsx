'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, ArrowLeft, BookOpen, Briefcase, CheckCircle2,
  ChevronRight, Crown, Eye, EyeOff, GraduationCap, Lock, Mail,
  MessageCircle, Mic, Loader2, Plane, Smile, Users, X, Zap,
} from 'lucide-react';
import type { ProficiencyLevel, RegisterFormProps } from './register-form.types';
import { LANGUAGES, NATIVE_LANGUAGES, LEARNING_GOALS } from './register-form.types';
import { GoogleSignInButton } from '@/components/shared/google-sign-in-button';

/* ─── Types ─────────────────────────────────────────────────────── */
type Step = 'name' | 'native' | 'language' | 'level' | 'goal' | 'account' | 'success';
const STEP_NUM: Record<Step, number> = { name: 1, native: 2, language: 3, level: 4, goal: 5, account: 6, success: 6 };

const LEVEL_OPTIONS = [
  { value: 'beginner'     as ProficiencyLevel, label: 'Beginner',     desc: 'I know a few words',             Icon: BookOpen, iconCl: 'text-[#2b6c00]', bgCl: 'bg-[#d7ffb8]',  selBorder: 'border-[#58cc02]', selBg: 'bg-[#d7ffb8]',  selText: 'text-[#2b6c00]', selCheck: 'text-[#58cc02]' },
  { value: 'intermediate' as ProficiencyLevel, label: 'Intermediate', desc: 'I can hold basic conversations', Icon: Zap,      iconCl: 'text-[#004666]',  bgCl: 'bg-[#dceeff]', selBorder: 'border-[#2fb8ff]',   selBg: 'bg-[#dceeff]', selText: 'text-[#004666]',   selCheck: 'text-[#2fb8ff]'   },
  { value: 'advanced'     as ProficiencyLevel, label: 'Advanced',     desc: 'I want to sound fluent',         Icon: Crown,    iconCl: 'text-[#683a00]',  bgCl: 'bg-[#ffe9cc]',   selBorder: 'border-[#ff9c27]',   selBg: 'bg-[#ffe9cc]',  selText: 'text-[#683a00]',   selCheck: 'text-[#ff9c27]'   },
] as const;

const GOAL_ICONS = { Briefcase, Plane, GraduationCap, Users, Smile, MessageCircle } as const;

/* Per-step semantic color theme (from DESIGN.md palette) */
interface StepTheme {
  avatarBg: string;
  avatarIcon: string;
  selBorder: string;
  selBg: string;
  selText: string;
  selCheck: string;
  hoverBorder: string;
  hoverBg: string;
}

const STEP_THEMES: Record<Step, StepTheme> = {
  name:     { avatarBg: 'bg-[#d7ffb8]', avatarIcon: 'text-[#2b6c00]', selBorder: 'border-[#58cc02]', selBg: 'bg-[#d7ffb8]', selText: 'text-[#2b6c00]', selCheck: 'text-[#58cc02]', hoverBorder: 'border-[#c8f2a4]', hoverBg: 'bg-[#f4ffe8]' },
  native:   { avatarBg: 'bg-[#ffe9cc]', avatarIcon: 'text-[#683a00]', selBorder: 'border-[#ff9c27]', selBg: 'bg-[#ffe9cc]', selText: 'text-[#683a00]', selCheck: 'text-[#ff9c27]', hoverBorder: 'border-[#ffd19a]', hoverBg: 'bg-[#fff7ea]' },
  language: { avatarBg: 'bg-[#dceeff]', avatarIcon: 'text-[#004666]', selBorder: 'border-[#2fb8ff]', selBg: 'bg-[#dceeff]', selText: 'text-[#004666]', selCheck: 'text-[#2fb8ff]', hoverBorder: 'border-[#b8ecff]', hoverBg: 'bg-[#f0faff]' },
  level:    { avatarBg: 'bg-[#ffe9cc]', avatarIcon: 'text-[#683a00]', selBorder: 'border-[#ff9c27]', selBg: 'bg-[#ffe9cc]', selText: 'text-[#683a00]', selCheck: 'text-[#ff9c27]', hoverBorder: 'border-[#ffd19a]', hoverBg: 'bg-[#fff7ea]' },
  goal:     { avatarBg: 'bg-[#dceeff]', avatarIcon: 'text-[#004666]', selBorder: 'border-[#2fb8ff]', selBg: 'bg-[#dceeff]', selText: 'text-[#004666]', selCheck: 'text-[#2fb8ff]', hoverBorder: 'border-[#b8ecff]', hoverBg: 'bg-[#f0faff]' },
  account:  { avatarBg: 'bg-[#d7ffb8]', avatarIcon: 'text-[#2b6c00]', selBorder: 'border-[#58cc02]', selBg: 'bg-[#d7ffb8]', selText: 'text-[#2b6c00]', selCheck: 'text-[#58cc02]', hoverBorder: 'border-[#c8f2a4]', hoverBg: 'bg-[#f4ffe8]' },
  success:  { avatarBg: 'bg-[#d7ffb8]', avatarIcon: 'text-[#2b6c00]', selBorder: 'border-[#58cc02]', selBg: 'bg-[#d7ffb8]', selText: 'text-[#2b6c00]', selCheck: 'text-[#58cc02]', hoverBorder: 'border-[#c8f2a4]', hoverBg: 'bg-[#f4ffe8]' },
};

/* ─── Confetti ───────────────────────────────────────────────────── */
function startConfetti(canvas: HTMLCanvasElement, onComplete?: () => void) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  const colors = ['#58cc02', '#2fb8ff', '#ff9c27', '#d7ffb8', '#dceeff', '#ffe9cc'];
  const ps = Array.from({ length: 150 }, () => ({
    // Start particles already in viewport (top 40%) for immediate visual burst
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height * 0.4,
    r: Math.random() * 6 + 2,
    color: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 5,
    vy: Math.random() * 2 - 3,          // initial upward burst then gravity
    alpha: 1,
    rot: Math.random() * 360,
    rotV: (Math.random() - 0.5) * 6,
  }));
  let id: number;
  function draw() {
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of ps) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.vx *= 0.99;
      p.alpha -= 0.003;                  // ~5.5s at 60fps before fade-out
      p.rot += p.rotV;
      if (p.alpha > 0) {
        alive = true;
        ctx!.save(); ctx!.globalAlpha = p.alpha; ctx!.fillStyle = p.color;
        ctx!.translate(p.x, p.y); ctx!.rotate(p.rot * Math.PI / 180);
        ctx!.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx!.restore();
      }
    }
    if (alive) id = requestAnimationFrame(draw);
    else onComplete?.();
  }
  draw();
  return () => cancelAnimationFrame(id);
}


/* ─── Shared atoms ───────────────────────────────────────────────── */
function AvatarBubble({ text, theme }: { text: string; theme: StepTheme }) {
  return (
    <div className="flex items-start gap-3 mb-8">
      {/* Avatar — lighter, uses per-step semantic color */}
      <div className={`w-14 h-14 rounded-2xl ${theme.avatarBg} border-2 border-white flex items-center justify-center flex-shrink-0`} style={{ boxShadow: '0 4px 0 #e2e2e2' }}>
        <Mic className={`w-6 h-6 ${theme.avatarIcon}`} />
      </div>
      <div className="relative bg-white rounded-3xl rounded-tl-sm px-5 py-4 mt-1 max-w-xs" style={{ border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
        <p className="text-sm font-black leading-snug" style={{ color: '#1a1c1c' }}>{text}</p>
        {/* Tail */}
        <div className="absolute -left-[9px] top-4 w-4 h-4 overflow-hidden">
          <div className="w-3 h-3 bg-white border-l-2 border-b-2 border-[#e2e2e2] rotate-45 translate-x-[5px]" />
        </div>
      </div>
    </div>
  );
}

function TopBar({ step, onBack, stepOrder }: { step: Step; onBack: () => void; stepOrder: readonly Step[] }) {
  const totalSteps = stepOrder.length;
  const idx = stepOrder.indexOf(step as Step);
  const isSuccess = step === ('success' as Step);
  const progress = isSuccess ? totalSteps : idx + 1;
  const isFirstStep = idx === 0;
  const showBack = idx > 0 && !isSuccess;
  return (
    <div
      className="fixed top-0 left-0 right-0 z-10"
      style={{
        background: '#f9f9f9',
        borderBottom: '2px solid #e2e2e2',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <div className="max-w-xl mx-auto px-4 py-3 flex items-center gap-3">
        <div className="w-9 flex-shrink-0">
          {isSuccess ? null : showBack ? (
            // Intermediate step → back arrow
            <button
              type="button" onClick={onBack}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : isFirstStep ? (
            // First step → exit (×) to /login
            <Link
              href="/login"
              className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all"
              aria-label="Back to login"
            >
              <X className="w-5 h-5" />
            </Link>
          ) : null}
        </div>
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${(progress / totalSteps) * 100}%`, background: '#58cc02' }}
          />
        </div>
        <span className="text-xs text-gray-400 font-medium w-9 text-right flex-shrink-0">
          {progress}/{totalSteps}
        </span>
      </div>
    </div>
  );
}


function BottomBar({
  canContinue, onContinue, isLoading, label = 'Continue',
}: {
  canContinue: boolean; onContinue: () => void; isLoading?: boolean; label?: string;
}) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 px-4 pt-4"
      style={{
        background: '#f9f9f9',
        borderTop: '2px solid #e2e2e2',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
      }}
    >
      <div className="max-w-xl mx-auto flex items-center justify-between">
        <Link
          href="/login"
          className="text-xs font-extrabold transition-colors hover:text-[#2b6c00]"
          style={{ color: '#6f7b64' }}
        >
          Already have an account?
        </Link>
        <button
          type="button" onClick={onContinue}
          disabled={!canContinue || !!isLoading}
          className="flex items-center gap-2 px-8 py-3.5 rounded-2xl font-black text-sm transition-all duration-200 hover:-translate-y-0.5 hover:brightness-[1.03] active:translate-y-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          style={{ background: '#58cc02', color: '#1e5000', boxShadow: canContinue && !isLoading ? '0 4px 0 #46a302' : 'none' }}
        >
          {isLoading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
            : <>{label} <ChevronRight className="w-4 h-4" /></>}
        </button>
      </div>
    </div>
  );
}

/* ─── Choice card ─────────────────────────────────────────────────── */
function ChoiceCard({
  selected, onClick, left, title, subtitle, theme,
}: {
  selected: boolean; onClick: () => void;
  left: React.ReactNode; title: string; subtitle?: string;
  theme: StepTheme;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border text-left transition-all hover:-translate-y-0.5 active:translate-y-1 ${
        selected
          ? `${theme.selBorder} ${theme.selBg}`
          : `border-[#e2e2e2] bg-white hover:${theme.hoverBorder} hover:${theme.hoverBg}`
      }`}
      style={{ borderWidth: 2, boxShadow: selected ? '0 4px 0 #e2e2e2' : '0 2px 0 #e2e2e2' }}
    >
      <div className="flex-shrink-0">{left}</div>
      <div>
        <p className={`text-sm font-black transition-colors ${selected ? theme.selText : 'text-[#1a1c1c]'}`}>
          {title}
        </p>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {selected && (
        <div className="ml-auto">
          <CheckCircle2 className={`w-5 h-5 ${theme.selCheck}`} />
        </div>
      )}
    </button>
  );
}

/* ─── Screen: Name ───────────────────────────────────────────────── */
function ScreenName({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 100); }, []);
  return (
    <div className="flex flex-col gap-3">
      <input
        ref={ref} id="reg-name" type="text"
        value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onEnter(); }}
        placeholder="Your first name..."
        className="w-full px-5 py-4 rounded-2xl text-sm font-bold outline-none transition-all"
        style={{ background: '#fff', color: '#1a1c1c', border: '2px solid #e2e2e2', boxShadow: '0 2px 0 #e2e2e2' }}
      />
      <p className="text-xs text-gray-400 pl-1">Press Enter or click Continue</p>
    </div>
  );
}

/* ─── Screen: Language ───────────────────────────────────────────── */
function ScreenLanguage({
  selected, onSelect, theme,
}: { selected: string; onSelect: (v: string) => void; theme: StepTheme }) {
  return (
    <div className="flex flex-col gap-2.5">
      {LANGUAGES.map(({ value, label, countryCode }) => (
        <ChoiceCard
          key={value}
          selected={selected === value}
          onClick={() => onSelect(value)}
          theme={theme}
          left={
            <div className="w-10 h-7 rounded-md overflow-hidden flex-shrink-0 shadow-sm border border-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://flagcdn.com/w80/${countryCode}.png`}
                alt={`${label} flag`}
                width={40}
                height={28}
                className="w-full h-full object-cover"
              />
            </div>
          }
          title={label}
        />
      ))}
    </div>
  );
}


/* ─── Screen: Level ──────────────────────────────────────────────── */
function ScreenLevel({
  selected, onSelect,
}: { selected: string; onSelect: (v: ProficiencyLevel) => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      {LEVEL_OPTIONS.map(({ value, label, desc, Icon, iconCl, bgCl, selBorder, selBg, selText, selCheck }) => {
        // Each level card uses its own semantic color for the selected state
        const levelTheme: StepTheme = {
          avatarBg: bgCl, avatarIcon: iconCl,
          selBorder, selBg, selText, selCheck,
          hoverBorder: selBorder.replace('border-', 'border-').replace('-400', '-200').replace('-300', '-100'),
          hoverBg: selBg,
        };
        return (
          <ChoiceCard
            key={value}
            selected={selected === value}
            onClick={() => onSelect(value)}
            theme={levelTheme}
            left={
              <div className={`w-10 h-10 rounded-xl ${bgCl} flex items-center justify-center`}>
                <Icon className={`w-5 h-5 ${iconCl}`} />
              </div>
            }
            title={label}
            subtitle={desc}
          />
        );
      })}
    </div>
  );
}

/* ─── Screen: Native Language ────────────────────────────────────── */
function ScreenNativeLanguage({
  selected, onSelect, theme,
}: { selected: string; onSelect: (v: string) => void; theme: StepTheme }) {
  return (
    <div className="flex flex-col gap-2.5">
      {NATIVE_LANGUAGES.map(({ value, label, countryCode }) => (
        <ChoiceCard
          key={value}
          selected={selected === value}
          onClick={() => onSelect(value)}
          theme={theme}
          left={
            <div className="w-10 h-7 rounded-md overflow-hidden flex-shrink-0 shadow-sm border border-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://flagcdn.com/w80/${countryCode}.png`}
                alt={`${label} flag`}
                width={40}
                height={28}
                className="w-full h-full object-cover"
              />
            </div>
          }
          title={label}
        />
      ))}
    </div>
  );
}

/* ─── Screen: Learning Goal ──────────────────────────────────────── */
function ScreenLearningGoal({
  selected, onSelect, theme,
}: { selected: string; onSelect: (v: string) => void; theme: StepTheme }) {
  return (
    <div className="flex flex-col gap-2.5">
      {LEARNING_GOALS.map(({ value, label, icon }) => {
        const Icon = GOAL_ICONS[icon];
        return (
          <ChoiceCard
            key={value}
            selected={selected === value}
            onClick={() => onSelect(value)}
            theme={theme}
            left={
              <div className={`w-10 h-10 rounded-xl ${selected === value ? theme.selBg : 'bg-gray-50'} flex items-center justify-center transition-colors`}>
                <Icon className={`w-5 h-5 ${selected === value ? theme.selText : 'text-gray-400'}`} />
              </div>
            }
            title={label}
          />
        );
      })}
    </div>
  );
}

/* ─── Screen: Account ────────────────────────────────────────────── */
function ScreenAccount({
  email, password, showPw,
  setEmail, setPassword, setShowPw,
  error, onGoogleAuth,
}: {
  email: string; password: string; showPw: boolean;
  setEmail: (v: string) => void; setPassword: (v: string) => void; setShowPw: (v: boolean) => void;
  error: string | null;
  onGoogleAuth?: (credential: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl text-sm font-bold" style={{ background: '#ffe0e0', border: '2px solid #ffc6c6', color: '#9b1c1c' }}>
          <AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span>
        </div>
      )}
      {/* Google Sign-Up */}
      {onGoogleAuth && (
        <>
          <GoogleSignInButton onCredential={onGoogleAuth} text="signup_with" />
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">or use email</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>
        </>
      )}
      <div className="relative">
        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
        <input
          id="reg-email" type="email" placeholder="name@example.com"
          value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full pl-11 pr-4 py-4 rounded-2xl text-sm font-bold outline-none transition-all"
          style={{ background: '#fff', color: '#1a1c1c', border: '2px solid #e2e2e2', boxShadow: '0 2px 0 #e2e2e2' }}
        />
      </div>
      <div className="relative">
        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
        <input
          id="reg-password" type={showPw ? 'text' : 'password'} placeholder="At least 8 characters"
          value={password} onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          className="w-full pl-11 pr-12 py-4 rounded-2xl text-sm font-bold outline-none transition-all"
          style={{ background: '#fff', color: '#1a1c1c', border: '2px solid #e2e2e2', boxShadow: '0 2px 0 #e2e2e2' }}
        />
        <button
          type="button" onClick={() => setShowPw(!showPw)}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6f7b64] hover:text-[#2b6c00] transition-colors"
          aria-label="Toggle password"
        >
          {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

/* ─── Screen: Success ────────────────────────────────────────────── */
function ScreenSuccess({ name, onComplete }: { name: string; onComplete: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    return startConfetti(canvasRef.current, onComplete);
  }, [onComplete]);
  return (
    <div className="relative min-h-[320px] flex items-center justify-center overflow-hidden rounded-[32px] bg-white" style={{ border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      <div className="relative flex flex-col items-center gap-4 text-center px-6">
        <div
          className="w-16 h-16 rounded-2xl bg-[#d7ffb8] flex items-center justify-center"
          style={{ animation: 'scaleIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both' }}
        >
          <CheckCircle2 className="w-8 h-8 text-[#2b6c00]" />
        </div>
        <div style={{ animation: 'slideUp 0.3s ease-out 0.4s both' }}>
          <p className="font-bold text-gray-900 text-xl">You&apos;re all set, {name}!</p>
          <p className="text-sm text-gray-500 mt-2">Your language journey starts now.</p>
        </div>
        <p className="text-xs text-gray-400" style={{ animation: 'slideUp 0.3s ease-out 0.85s both' }}>
          Taking you to your dashboard…
        </p>
      </div>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────── */
export function RegisterForm({ onSubmit, onGoogleAuth, onUpdateProfile, googleOnboarding, isLoading, error, onConfettiDone }: RegisterFormProps) {
  const [step, setStep] = useState<Step>(googleOnboarding ? 'native' : 'name');

  // Collected data
  const [name, setName]             = useState('');
  const [nativeLang, setNativeLang] = useState('');
  const [language, setLanguage]     = useState('');
  const [langLabel, setLangLabel]   = useState('');
  const [langCode, setLangCode]     = useState('');
  const [level, setLevel]           = useState<ProficiencyLevel | ''>('');
  const [goal, setGoal]             = useState('');
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [showPw, setShowPw]         = useState(false);

  // If error arrives while showing success → go back to account
  useEffect(() => {
    if (error && step === 'success') setStep('account');
  }, [error, step]);

  // Question text per step
  const questions: Record<Step, string> = {
    name:     "Hi there! I'm your AI speaking partner. What should I call you?",
    native:   `Nice to meet you, ${name}! What's your native language?`,
    language: 'Awesome! Which language do you want to learn?',
    level:    `Great choice! How would you rate your ${langLabel} right now?`,
    goal:     'What\'s your main reason for learning?',
    account:  'Last step! Create your account to save progress.',
    success:  '',
  };

  // Navigation — step order (Google onboarding skips name & account)
  const STEP_ORDER: Step[] = googleOnboarding
    ? ['native', 'language', 'level', 'goal']
    : ['name', 'native', 'language', 'level', 'goal', 'account'];
  const goBack = () => {
    const i = STEP_ORDER.indexOf(step as Step);
    if (i > 0) setStep(STEP_ORDER[i - 1]);
  };

  // Continue logic per step
  const handleContinue = () => {
    if (step === 'name'     && name.trim())   return setStep('native');
    if (step === 'native'   && nativeLang)    return setStep('language');
    if (step === 'language' && language)       return setStep('level');
    if (step === 'level'    && level)          return setStep('goal');
    if (step === 'goal'     && goal) {
      if (googleOnboarding && onUpdateProfile) {
        // Google user: skip account, update profile and show success
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        setStep('success');
        onUpdateProfile({ targetLanguage: language, level, nativeLanguage: nativeLang, learningGoal: goal, timezone });
        return;
      }
      return setStep('account');
    }
    if (step === 'account'  && email && password.length >= 8 && language && level) {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setStep('success');
      onSubmit({
        name: name.trim(), email, password,
        target_language: language, level,
        native_language: nativeLang, learning_goal: goal, timezone,
      });
    }
  };

  const canContinue =
    (step === 'name'     && name.trim().length > 0) ||
    (step === 'native'   && !!nativeLang)           ||
    (step === 'language' && !!language)              ||
    (step === 'level'    && !!level)                 ||
    (step === 'goal'     && !!goal)                  ||
    (step === 'account'  && email.includes('@') && password.length >= 8);

  const handleLangSelect = (value: string) => {
    const found = LANGUAGES.find((l) => l.value === value);
    setLanguage(value);
    setLangLabel(found?.label ?? value);
    setLangCode(found?.countryCode ?? '');
  };

  // Allow Enter key to advance on selection screens
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (['native', 'language', 'level', 'goal'].includes(step) && canContinue) {
          handleContinue();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const theme = STEP_THEMES[step];

  return (
    <div className="min-h-screen font-[family-name:var(--font-lexend)]" style={{ background: '#f9f9f9' }}>
      <TopBar step={step} onBack={goBack} stepOrder={STEP_ORDER} />

      {/* Content area — extra top padding accounts for safe-area-inset-top on notched phones */}
      <div className="pt-20 pb-28 px-5 min-h-screen" style={{ paddingTop: 'calc(80px + env(safe-area-inset-top, 0px))' }}>
        <div
          className="max-w-xl mx-auto pt-8"
          key={step}
          style={{ animation: 'pageIn 0.28s ease-out both' }}
        >
          {step !== 'success' && <AvatarBubble text={questions[step]} theme={theme} />}

          {step === 'name'     && <ScreenName value={name} onChange={setName} onEnter={handleContinue} />}
          {step === 'native'   && <ScreenNativeLanguage selected={nativeLang} onSelect={setNativeLang} theme={theme} />}
          {step === 'language' && <ScreenLanguage selected={language} onSelect={handleLangSelect} theme={theme} />}
          {step === 'level'    && <ScreenLevel selected={level} onSelect={(v) => setLevel(v)} />}
          {step === 'goal'     && <ScreenLearningGoal selected={goal} onSelect={setGoal} theme={theme} />}
          {step === 'account'  && (
            <ScreenAccount
              email={email} password={password} showPw={showPw}
              setEmail={setEmail} setPassword={setPassword} setShowPw={setShowPw}
              error={error}
              onGoogleAuth={(credential) => {
                // Google auth on register: save onboarding data then auth
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                setStep('success');
                onGoogleAuth(credential);
              }}
            />
          )}
          {step === 'success' && <ScreenSuccess name={name} onComplete={onConfettiDone} />}
        </div>
      </div>

      {/* Bottom bar — hidden on success */}
      {step !== 'success' && (
        <BottomBar
          canContinue={!!canContinue}
          onContinue={handleContinue}
          isLoading={step === 'account' ? isLoading : false}
          label={step === 'account' ? "Create Account" : "Continue"}
        />
      )}

      {/* Global keyframes */}
      <style>{`
        @keyframes pageIn {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.5); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

