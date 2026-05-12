'use client';
import { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2, Loader2, X, AlertCircle,
  Zap, Crown, ArrowRight, QrCode, Package, Sparkles, Share2,
} from 'lucide-react';
import type { Subscription, CheckoutResult } from '@/services/billing.service';

const fmtVnd  = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// ─── Confetti canvas ──────────────────────────────────────────────────────────
function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width  = canvas.offsetWidth;
    const H = canvas.height = canvas.offsetHeight;

    const COLORS = ['#8447FF', '#C4B5FD', '#8CFFDA', '#FFB2E6', '#FCD34D', '#60A5FA', '#F9A8D4'];

    type Particle = {
      x: number; y: number; vx: number; vy: number;
      color: string; w: number; h: number; rot: number; drot: number; alpha: number;
    };

    const particles: Particle[] = Array.from({ length: 100 }, () => ({
      x:     W / 2 + (Math.random() - 0.5) * 60,
      y:     H * 0.35,
      vx:    (Math.random() - 0.5) * 14,
      vy:    -(Math.random() * 12 + 4),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      w:     Math.random() * 9 + 5,
      h:     Math.random() * 5 + 3,
      rot:   Math.random() * 360,
      drot:  (Math.random() - 0.5) * 12,
      alpha: 1,
    }));

    let raf: number;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      let alive = false;
      for (const p of particles) {
        p.x   += p.vx;
        p.y   += p.vy;
        p.vy  += 0.35;          // gravity
        p.vx  *= 0.99;          // drag
        p.rot += p.drot;
        p.alpha = Math.max(0, p.alpha - 0.008);
        if (p.y < H + 20) alive = true;

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ borderRadius: 'inherit' }}
    />
  );
}

// ─── Shared overlay ───────────────────────────────────────────────────────────
function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden font-[family-name:var(--font-lexend)] relative"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
export type PlanOption = {
  label: string;
  priceVnd: number;
  interval: 'month' | 'year';
  features: string[];
  factory: () => Promise<CheckoutResult>;
};

export type PendingOrder =
  | { type: 'plan'; primary: PlanOption; alt?: PlanOption }
  | { type: 'addon'; label: string; priceVnd: number; features: string[]; factory: () => Promise<CheckoutResult> };

// ─── Step indicator ───────────────────────────────────────────────────────────
const STEPS = ['review', 'qr', 'success'] as const;
type Step = typeof STEPS[number];

function StepBar({ step, onClose }: { step: Step; onClose: () => void }) {
  const idx = STEPS.indexOf(step);
  return (
    <div className="flex items-center px-6 py-4 border-b border-gray-100">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
            idx === i ? 'bg-[#8447FF] text-white'
            : idx > i  ? 'bg-emerald-100 text-emerald-700'
            : 'bg-gray-100 text-gray-400'
          }`}>
            {idx > i ? '✓' : i + 1}
          </div>
          {i < 2 && <div className={`w-8 h-px mx-1 transition-all ${idx > i ? 'bg-[#8447FF]/40' : 'bg-gray-100'}`} />}
        </div>
      ))}
      <span className="ml-auto text-xs text-gray-400">
        {step === 'review' ? 'Review' : step === 'qr' ? 'Payment' : 'Done'}
      </span>
      {/* X always visible */}
      <button
        onClick={onClose}
        className="ml-3 w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center transition"
        title="Close"
      >
        <X className="w-3.5 h-3.5 text-gray-400" />
      </button>
    </div>
  );
}

// ─── Cancel Modal ─────────────────────────────────────────────────────────────
export function CancelModal({ sub, onConfirm, onClose, confirming }: {
  sub: Subscription; onConfirm: () => void; onClose: () => void; confirming: boolean;
}) {
  const label = sub.plan.interval === 'month' ? 'Pro Monthly' : 'Pro Yearly';
  return (
    <Overlay onClose={onClose}>
      <div className="p-7">
        <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-7 h-7 text-rose-400" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 text-center mb-2">Cancel Subscription?</h3>
        <p className="text-sm text-gray-500 text-center leading-relaxed mb-1">
          You keep <span className="font-semibold text-gray-800">{label}</span> access until{' '}
          <span className="font-semibold text-gray-800">{fmtDate(sub.current_period_end)}</span>.
        </p>
        <p className="text-xs text-gray-400 text-center mb-7">
          After that you revert to Free — 50k tokens · 10 sessions/mo.
        </p>
        <button onClick={onClose} className="w-full py-3.5 rounded-2xl bg-[#8447FF] text-white font-bold text-sm hover:bg-[#7C3AED] transition mb-2">
          Keep My Plan
        </button>
        <button onClick={onConfirm} disabled={confirming} className="w-full py-3 rounded-2xl text-rose-400 font-medium text-sm hover:bg-rose-50 transition disabled:opacity-50">
          {confirming ? 'Cancelling…' : 'Yes, Cancel'}
        </button>
      </div>
    </Overlay>
  );
}

// ─── Share helper (same logic as ProLoveCard) ─────────────────────────────────
async function doShare(onCopied: () => void) {
  const url  = window.location.origin;
  const text = "I'm practicing English with an AI speaking coach 🎯 — try it free!";
  const data = { title: 'AI Speaking Partner', text, url };
  if (typeof navigator.share === 'function' && navigator.canShare?.(data)) {
    try { await navigator.share(data); return; }
    catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); } catch { /* ignore */ }
  onCopied();
}

// ─── Success state with Free→Pro upgrade animation ────────────────────────────
function SuccessView({ isPlanUpgrade, onClose }: { isPlanUpgrade: boolean; onClose: () => void }) {
  // Staged reveal: badge → crown → text → button
  const [phase,  setPhase]  = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 500),
      setTimeout(() => setPhase(3), 900),
      setTimeout(() => setPhase(4), 1300),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="relative p-7 text-center overflow-hidden" style={{ minHeight: 380 }}>
      {/* Confetti layer */}
      <Confetti />

      {/* Content — layered above confetti */}
      <div className="relative z-10">
        {/* Animated crown / checkmark */}
        <div className={`transition-all duration-500 ${phase >= 1 ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}>
          {isPlanUpgrade ? (
            <div className="w-24 h-24 rounded-full bg-[#EDE9FE] ring-4 ring-violet-200 flex items-center justify-center mx-auto mb-4">
              <Crown className="w-12 h-12 text-[#8447FF]" />
            </div>
          ) : (
            <div className="w-24 h-24 rounded-full bg-emerald-50 ring-4 ring-emerald-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            </div>
          )}
        </div>

        {/* Free → Pro transition badge */}
        {isPlanUpgrade && (
          <div className={`flex items-center justify-center gap-2 mb-3 transition-all duration-500 ${phase >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
            <span className="text-xs font-bold bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full">Free</span>
            <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-bold bg-[#8447FF] text-white px-2.5 py-1 rounded-full flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Pro
            </span>
          </div>
        )}

        <div className={`transition-all duration-500 ${phase >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <h3 className="text-2xl font-bold text-gray-900 mb-1">
            {isPlanUpgrade ? "You're Pro now! 🎉" : 'Tokens Added!'}
          </h3>
          <p className="text-sm text-gray-500 mb-1">
            {isPlanUpgrade
              ? 'Unlimited AI speaking practice is now unlocked.'
              : 'Your token balance has been updated.'}
          </p>
          <p className="text-xs text-gray-400 mb-7">A confirmation has been sent to your email.</p>
        </div>

        <div className={`space-y-2 transition-all duration-500 ${phase >= 4 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <button
            onClick={onClose}
            className="w-full py-3.5 rounded-2xl bg-[#8447FF] text-white font-bold text-sm hover:bg-[#7C3AED] transition"
          >
            {isPlanUpgrade ? 'Start Learning →' : 'Great, thanks!'}
          </button>
          {isPlanUpgrade && (
            <button
              onClick={() => doShare(() => { setCopied(true); setTimeout(() => setCopied(false), 2200); })}
              className="w-full py-3 rounded-2xl border border-violet-200 text-sm font-semibold transition flex items-center justify-center gap-2 hover:bg-violet-50 active:scale-[0.98]"
              style={{ color: copied ? '#059669' : '#8447FF' }}
            >
              {copied
                ? <><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Link copied!</>
                : <><Share2 className="w-4 h-4" /> Share with friends</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Checkout Modal ───────────────────────────────────────────────────────────
export function CheckoutModal({ order, onClose, onConfirm }: {
  order: PendingOrder;
  onClose: () => void;
  onConfirm: (result: CheckoutResult) => Promise<void>;
}) {
  const [useAlt,   setUseAlt]   = useState(false);
  const [step,     setStep]     = useState<Step>('review');
  const [loading,  setLoading]  = useState(false);
  const [checkout, setCheckout] = useState<CheckoutResult | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  const active: { label: string; priceVnd: number; interval?: 'month' | 'year'; features: string[]; factory: () => Promise<CheckoutResult> } =
    order.type === 'plan'
      ? (useAlt && order.alt ? order.alt : order.primary)
      : order;

  const handlePay = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await active.factory();
      setCheckout(result);
      setStep('qr');
      await onConfirm(result);
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  // QR step: allow close (user changed mind) — just call onClose
  const handleClose = () => onClose();

  return (
    <Overlay onClose={handleClose}>
      {/* Step bar — X always visible now */}
      {step !== 'success' && <StepBar step={step} onClose={handleClose} />}

      {/* ── Step 1: Review ── */}
      {step === 'review' && (
        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${order.type === 'plan' ? 'bg-violet-100' : 'bg-amber-100'}`}>
              {order.type === 'plan'
                ? <Crown className="w-5 h-5 text-[#8447FF]" />
                : <Package className="w-5 h-5 text-amber-500" />}
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Order Summary</p>
              <h3 className="text-lg font-bold text-gray-900">{active.label}</h3>
            </div>
          </div>

          {/* Plan toggle */}
          {order.type === 'plan' && order.alt && (
            <div className="flex items-center gap-1 bg-gray-100 rounded-2xl p-1 mb-5">
              {([false, true] as const).map(isAlt => {
                const opt = isAlt ? order.alt! : order.primary;
                const sel = useAlt === isAlt;
                return (
                  <button
                    key={String(isAlt)}
                    onClick={() => setUseAlt(isAlt)}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${
                      sel ? 'bg-white text-[#8447FF] shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {opt.interval === 'year' ? 'Yearly' : 'Monthly'}
                    {opt.interval === 'year' && (
                      <span className="ml-1.5 text-[10px] bg-[#8447FF] text-white px-1.5 py-0.5 rounded-full font-bold">−17%</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Features */}
          <ul className="space-y-2 mb-5">
            {active.features.map(f => (
              <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                <Zap className="w-3.5 h-3.5 text-[#8447FF] flex-shrink-0" />{f}
              </li>
            ))}
          </ul>

          {/* Price breakdown */}
          <div className="bg-gray-50 rounded-2xl p-4 mb-4 space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>{active.label}</span>
              <span className="font-semibold">{fmtVnd(active.priceVnd)}</span>
            </div>
            {active.interval === 'year' && (
              <div className="flex justify-between text-xs text-gray-400">
                <span>Monthly equivalent</span>
                <span>{fmtVnd(Math.round(active.priceVnd / 12))}/mo</span>
              </div>
            )}
            <div className="border-t border-gray-200 pt-2 flex justify-between font-bold text-gray-900 text-sm">
              <span>Total due today</span>
              <span className="text-[#8447FF]">{fmtVnd(active.priceVnd)}</span>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-rose-50 rounded-xl px-3 py-2.5 text-xs text-rose-500 mb-4">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{error}
            </div>
          )}

          <button
            onClick={handlePay}
            disabled={loading}
            className="w-full py-4 rounded-2xl bg-[#8447FF] text-white font-bold text-sm hover:bg-[#7C3AED] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating QR…</>
              : <><QrCode className="w-4 h-4" /> Pay with Bank Transfer <ArrowRight className="w-4 h-4" /></>
            }
          </button>
          <p className="text-center text-xs text-gray-400 mt-3">Secure payment via QR bank transfer</p>
        </div>
      )}

      {/* ── Step 2: QR ── */}
      {step === 'qr' && checkout && (
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-1">Scan to Pay</h3>
          <p className="text-sm text-gray-400 mb-4">Open your banking app and scan the QR below</p>

          <div className="flex justify-center mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={checkout.qr_url} alt="Payment QR" className="w-52 h-52 rounded-2xl border border-gray-100" />
          </div>

          <div className="bg-[#F5F0FF] rounded-2xl p-4 mb-4 space-y-3">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                Transfer Note <span className="text-rose-400 normal-case font-medium">(required exactly)</span>
              </p>
              <p className="font-mono font-bold text-[#8447FF] text-sm tracking-wide">{checkout.content_code}</p>
            </div>
            <div className="border-t border-violet-100 pt-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Amount</p>
              <p className="font-bold text-gray-900 text-xl">{fmtVnd(checkout.amount_vnd)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-500 mb-4">
            <Loader2 className="w-4 h-4 animate-spin text-[#8447FF] flex-shrink-0" />
            <span>Waiting for payment confirmation…</span>
          </div>

          {/* Cancel option — clearly secondary */}
          <button
            onClick={handleClose}
            className="w-full py-2.5 rounded-xl text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition"
          >
            Cancel payment
          </button>
          <p className="text-center text-xs text-gray-300 mt-1">
            QR expires in 15 min. Wrong amount or note won&apos;t be processed.
          </p>
        </div>
      )}

      {/* ── Step 3: Success ── */}
      {step === 'success' && (
        <SuccessView isPlanUpgrade={order.type === 'plan'} onClose={onClose} />
      )}
    </Overlay>
  );
}
