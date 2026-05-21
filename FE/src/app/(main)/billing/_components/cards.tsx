'use client';
import { useState } from 'react';
import {
  Zap, Target, Clock, Crown,
  TrendingUp, Sparkles, CheckCircle2, Package,
  CreditCard, Receipt, Download, Heart, Share2,
} from 'lucide-react';

import type { Subscription, Usage, Plan, BillingHistoryItem } from '@/services/billing.service';
import type { SessionQuota } from '@/services/session.service';
import { Badge, Card, CardHeader, IconBox } from './ui';

const fmtVnd  = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTok  = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000   ? `${(n / 1_000).toFixed(0)}k`
  : String(n);
const pctOf = (used: number, limit: number) =>
  limit <= 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));

// ─── Vibrant Play lip-press button ───────────────────────────────────────────
function VpButton({
  children, onClick, variant = 'primary', fullWidth = false, disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  fullWidth?: boolean;
  disabled?: boolean;
}) {
  const base: Record<string, React.CSSProperties> = {
    primary:   { background: '#58cc02', color: '#1e5000', boxShadow: '0 4px 0 #1f5100' },
    secondary: { background: '#2fb8ff', color: '#004666', boxShadow: '0 4px 0 #004c6e' },
    ghost:     { background: '#fff',    color: '#3c3c3c', boxShadow: '0 4px 0 #e2e2e2', border: '2px solid #e2e2e2' },
    danger:    { background: '#ff5252', color: '#fff',    boxShadow: '0 4px 0 #93000a' },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl font-extrabold text-sm select-none${fullWidth ? ' w-full' : ''}`}
      style={{
        fontFamily: 'Lexend, sans-serif',
        padding: '14px 24px',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'transform 80ms ease, box-shadow 80ms ease',
        ...base[variant],
      }}
      onMouseDown={e => {
        const b = e.currentTarget;
        b.style.transform = 'translateY(4px)';
        b.style.boxShadow = '0 0px 0 ' + (base[variant].boxShadow as string).split(' ').at(-1)!;
      }}
      onMouseUp={e => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.boxShadow = base[variant].boxShadow as string;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.boxShadow = base[variant].boxShadow as string;
      }}
    >
      {children}
    </button>
  );
}

// ─── Current Plan Card ────────────────────────────────────────────────────────
// Pro  → solid #58cc02 (primary-container) — vibrant green status card
// Free → white card with border
export function CurrentPlanCard({ subscription, usage, quota, isPro, planLabel, onCancel }: {
  subscription: Subscription | null; usage: Usage | null; quota?: SessionQuota | null;
  isPro: boolean; planLabel: string; onCancel: () => void;
}) {
  const isUnlimited = usage?.is_unlimited ?? false;
  const sessionsToday = quota?.sessions_used ?? usage?.sessions_used ?? 0;
  const dailyLimit = quota?.daily_session_limit ?? usage?.daily_session_limit ?? -1;

  return (
    <div
      className="rounded-3xl p-6"
      style={{
        background:  isPro ? '#58cc02' : '#ffffff',
        border:      '2px solid ' + (isPro ? '#2b6c00' : '#e2e2e2'),
        boxShadow:   '0 4px 0 ' + (isPro ? '#1f5100' : '#e2e2e2'),
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="space-y-1">
          <Badge variant={isPro ? 'pro' : 'soft'}>
            <Crown className="w-3 h-3" />
            {isPro ? 'Pro Active' : 'Free Plan'}
          </Badge>
          <h2
            className="text-2xl font-extrabold mt-1"
            style={{ color: isPro ? '#1e5000' : '#1a1c1c', fontFamily: 'Lexend, sans-serif' }}
          >
            {isPro ? planLabel : 'Basic Learner'}
          </h2>
          <p className="text-sm font-medium" style={{ color: isPro ? '#2b6c00' : '#6f7b64' }}>
            {isPro
              ? subscription?.cancelled_at
                ? `Cancelled · Expires ${fmtDate(subscription.current_period_end)}`
                : `Renews ${fmtDate(subscription!.current_period_end)}`
              : 'Free forever · 10 sessions/day'}
          </p>
        </div>
        <div className="flex-shrink-0 ml-4">
          {!isPro && (
            <p className="text-2xl font-extrabold" style={{ color: '#becbb1', fontFamily: 'Lexend, sans-serif' }}>Free</p>
          )}
          {isPro && !subscription?.cancelled_at && (
            <button
              onClick={onCancel}
              className="text-xs font-semibold underline underline-offset-2 transition-opacity hover:opacity-60"
              style={{ color: '#2b6c00', fontFamily: 'Lexend, sans-serif' }}
            >
              Cancel plan
            </button>
          )}
        </div>
      </div>

      {/* Usage blocks */}
      {usage && (
        <div className="space-y-3">
          {/* AI Energy */}
          <UsageMeter
            icon={<Zap className="w-3.5 h-3.5" />}
            iconBg="#dceeff"
            iconColor="#004666"
            label="AI Energy"
            usedLabel={`${fmtTok(usage.tokens_used)} used`}
            limitLabel={isUnlimited ? 'Unlimited practice length' : `${fmtTok(usage.session_token_limit)} token limit per session`}
            pct={isUnlimited ? 100 : pctOf(usage.tokens_used, usage.session_token_limit)}
            barColor="#2fb8ff"
            soft={isPro}
          />

          {/* Sessions */}
          <UsageMeter
            icon={<Target className="w-3.5 h-3.5" />}
            iconBg="#ffe9cc"
            iconColor="#683a00"
            label="Sessions"
            usedLabel={`${sessionsToday} today`}
            limitLabel={isUnlimited ? '\u221e Unlimited sessions' : `${dailyLimit} per day`}
            pct={isUnlimited ? 100 : pctOf(sessionsToday, dailyLimit)}
            barColor="#58cc02"
            soft={isPro}
          />

          <div className="flex items-center gap-1.5 text-xs font-medium pl-1" style={{ color: isPro ? '#2b6c00' : '#6f7b64' }}>
            <Clock className="w-3 h-3" />
            Resets {usage.resets_at ? fmtDate(usage.resets_at) : 'next month'}
          </div>
        </div>
      )}
    </div>
  );
}

// Compact usage row with progress feedback for the current plan card.
function UsageMeter({
  icon, iconBg, iconColor, label, usedLabel, limitLabel, pct, barColor, soft,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  usedLabel: string;
  limitLabel: string;
  pct: number;
  barColor: string;
  soft: boolean;
}) {
  const barWidth = pct > 0 && pct < 8 ? '8%' : `${pct}%`;

  return (
    <div className="rounded-2xl p-4" style={{ background: soft ? 'rgba(0,0,0,0.10)' : '#f3f3f3' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: iconBg, color: iconColor }}>
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-extrabold" style={{ color: soft ? '#1e5000' : '#1a1c1c', fontFamily: 'Lexend, sans-serif' }}>
              {label}
            </p>
            <p className="text-xs font-medium truncate" style={{ color: soft ? '#2b6c00' : '#6f7b64' }}>
              {limitLabel}
            </p>
          </div>
        </div>
        <span className="text-xs font-extrabold font-mono px-2.5 py-1 rounded-full flex-shrink-0" style={{ background: soft ? 'rgba(255,255,255,0.32)' : '#ffffff', color: soft ? '#1e5000' : '#3f4a36' }}>
          {usedLabel}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="h-3 flex-1 rounded-full overflow-hidden" style={{ background: soft ? 'rgba(255,255,255,0.35)' : '#ffffff' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: barWidth, background: barColor }}
          />
        </div>
        <span className="w-10 text-right text-[11px] font-extrabold" style={{ color: soft ? '#1e5000' : '#6f7b64' }}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

// ─── Upgrade Card ─────────────────────────────────────────────────────────────
// White card with border — colorful accents inside
export function UpgradeCard({ proHighlight, monthlyPlan, onSelectPlan }: {
  proHighlight: Plan; monthlyPlan: Plan | undefined;
  onSelectPlan: (plan: Plan) => void;
}) {
  return (
    <div
      className="rounded-3xl overflow-hidden flex flex-col h-full"
      style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}
    >
      <div
        className="w-full h-36 flex items-end justify-center overflow-hidden px-4 pt-4"
        style={{ background: '#f9f9f9', borderBottom: '2px solid #e2e2e2' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/undraw_make-it-rain.svg" alt="Upgrade to Pro" className="h-full w-full object-contain object-bottom" />
      </div>

      <div className="p-6 flex flex-col flex-1">
        <div className="flex items-center gap-2 mb-1">
          <IconBox color="orange"><Crown className="w-4 h-4" /></IconBox>
          <h2 className="text-xl font-extrabold" style={{ color: '#1a1c1c', fontFamily: 'Lexend, sans-serif' }}>Upgrade to Pro</h2>
        </div>
        <p className="text-sm leading-relaxed mb-5" style={{ color: '#6f7b64' }}>
          Unlock unlimited AI speaking practice and accelerate your learning.
        </p>

        {/* Price */}
        <div className="mb-5">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold" style={{ color: '#1a1c1c', fontFamily: 'Lexend, sans-serif' }}>{fmtVnd(proHighlight.priceVnd)}</span>
            <span className="text-sm font-medium" style={{ color: '#6f7b64' }}>/{proHighlight.interval === 'year' ? 'yr' : 'mo'}</span>
          </div>
          {proHighlight.interval === 'year' && (
            <span
              className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full"
              style={{ background: '#58cc02', color: '#1e5000', fontFamily: 'Lexend, sans-serif' }}
            >
              <TrendingUp className="w-2.5 h-2.5" /> Save 17%
            </span>
          )}
        </div>

        {/* Features */}
        <ul className="space-y-2.5 mb-6 flex-1">
          {[
            'Unlimited AI sessions, every day',
            'Unlimited practice length',
            'Detailed pronunciation analysis',
            'Priority processing speed',
          ].map(f => (
            <li key={f} className="flex items-center gap-2.5 text-sm font-medium" style={{ color: '#3c3c3c' }}>
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: '#2b6c00' }} />
              {f}
            </li>
          ))}
        </ul>

        <VpButton variant="primary" fullWidth onClick={() => onSelectPlan(proHighlight)}>
          <Sparkles className="w-4 h-4" /> Get Pro Now
        </VpButton>
        {monthlyPlan && (
          <button
            onClick={() => onSelectPlan(monthlyPlan)}
            className="w-full mt-2.5 py-2.5 rounded-xl text-xs font-semibold transition-colors hover:bg-gray-50"
            style={{ color: '#6f7b64', fontFamily: 'Lexend, sans-serif' }}
          >
            Or monthly · {fmtVnd(monthlyPlan.priceVnd)}/mo
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Shared share helper ──────────────────────────────────────────────────────
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

// ─── Pro Love Card ────────────────────────────────────────────────────────────
export function ProLoveCard() {
  const [copied, setCopied] = useState(false);

  return (
    <div
      className="rounded-3xl overflow-hidden flex flex-col h-full"
      style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}
    >
      {/* Orange/warm illustration area */}
      <div className="w-full h-40 flex items-end justify-center overflow-hidden px-6 pt-4" style={{ background: '#ff9c27' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/undraw_love.svg" alt="We love our Pro members" className="h-full w-full object-contain object-bottom" />
      </div>

      <div className="p-6 flex flex-col flex-1">
        <div className="flex items-center gap-2 mb-1">
          <Heart className="w-4 h-4 fill-pink-400" style={{ color: '#ec4899' }} />
          <h2 className="text-lg font-extrabold" style={{ color: '#1a1c1c', fontFamily: 'Lexend, sans-serif' }}>Thank you! 💜</h2>
        </div>
        <p className="text-sm leading-relaxed mb-5" style={{ color: '#6f7b64' }}>
          You&apos;re part of our Pro family. Your support keeps us building a better AI speaking partner.
        </p>

        <ul className="space-y-2 mb-5 flex-1">
          {['Unlimited speaking sessions', 'Unlimited practice length', 'Priority AI processing'].map(perk => (
            <li key={perk} className="flex items-center gap-2 text-sm font-medium" style={{ color: '#3c3c3c' }}>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#ec4899' }} />
              {perk}
            </li>
          ))}
        </ul>

        <button
          onClick={() => doShare(() => { setCopied(true); setTimeout(() => setCopied(false), 2200); })}
          className="w-full py-3 rounded-2xl text-sm font-extrabold flex items-center justify-center gap-2 select-none"
          style={{
            fontFamily: 'Lexend, sans-serif',
            border: '2px solid #e2e2e2',
            background: copied ? '#f0fdf4' : '#ffffff',
            color: copied ? '#059669' : '#ec4899',
            boxShadow: '0 3px 0 #e2e2e2',
            transition: 'transform 80ms, box-shadow 80ms, background 120ms',
          }}
          onMouseDown={e => { e.currentTarget.style.transform = 'translateY(2px)'; e.currentTarget.style.boxShadow = '0 1px 0 #e2e2e2'; }}
          onMouseUp={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 3px 0 #e2e2e2'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 3px 0 #e2e2e2'; }}
        >
          {copied
            ? <><CheckCircle2 className="w-4 h-4" /> Link copied!</>
            : <><Share2 className="w-4 h-4" /> Share with friends</>
          }
        </button>
      </div>
    </div>
  );
}

// ─── Invoice generator ────────────────────────────────────────────────────────
function openInvoice(item: BillingHistoryItem) {
  const shortId = item.id.slice(-8).toUpperCase();
  const date    = new Date(item.paid_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const amount  = item.amount_vnd.toLocaleString('vi-VN');
  const type    = item.order_type === 'subscription' ? 'Subscription' : 'Legacy add-on';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Invoice #${shortId}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9f9f9;color:#1a1c1c;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{max-width:680px;margin:40px auto;background:#fff;border-radius:16px;padding:48px;box-shadow:0 4px 0 #e2e2e2;border:2px solid #e2e2e2}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:32px;border-bottom:2px solid #e2e2e2}
.brand{font-size:22px;font-weight:800;color:#2b6c00}
.brand small{display:block;font-size:12px;font-weight:500;color:#6f7b64;margin-top:3px}
.inv-label h1{font-size:28px;font-weight:800;color:#1a1c1c;text-align:right}
.inv-label p{font-size:13px;color:#6f7b64;text-align:right;margin-top:4px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:40px}
.meta-group label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6f7b64;margin-bottom:5px}
.meta-group p{font-size:14px;color:#1a1c1c;font-weight:600}
.status{display:inline-flex;align-items:center;gap:6px;background:#dff5c5;color:#1e5000;font-size:12px;font-weight:700;padding:4px 12px;border-radius:999px}
.status::before{content:'';width:6px;height:6px;border-radius:50%;background:#58cc02;display:inline-block}
table{width:100%;border-collapse:collapse;margin-bottom:24px}
thead th{background:#f3f3f3;padding:12px 16px;text-align:left;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6f7b64}
thead th:last-child{text-align:right}
tbody td{padding:16px;border-bottom:2px solid #f3f3f3;font-size:14px;color:#1a1c1c}
tbody td:last-child{text-align:right;font-weight:700}
.total-row{display:flex;justify-content:flex-end;margin-top:8px}
.total-box{background:#dff5c5;border-radius:12px;padding:16px 24px;min-width:220px;border:2px solid #becbb1}
.total-box .lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#2b6c00;margin-bottom:4px}
.total-box .amt{font-size:26px;font-weight:800;color:#1e5000}
.footer{margin-top:40px;padding-top:24px;border-top:2px solid #e2e2e2;display:flex;justify-content:space-between;align-items:center}
.footer p{font-size:12px;color:#6f7b64}
.ref{font-size:11px;color:#becbb1;margin-top:6px;word-break:break-all}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;border-radius:0;padding:32px}}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="brand">SpeakUp AI<small>AI Speaking Partner</small></div>
    <div class="inv-label"><h1>INVOICE</h1><p>#${shortId}</p></div>
  </div>
  <div class="meta">
    <div class="meta-group"><label>Date</label><p>${date}</p></div>
    <div class="meta-group"><label>Status</label><p><span class="status">Paid</span></p></div>
    <div class="meta-group"><label>Payment Method</label><p>Bank Transfer (QR)</p></div>
    <div class="meta-group"><label>Order Type</label><p>${type}</p></div>
  </div>
  <table>
    <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody><tr><td>${item.description}</td><td>${amount}₫</td></tr></tbody>
  </table>
  <div class="total-row">
    <div class="total-box"><div class="lbl">Total Paid</div><div class="amt">${amount}₫</div></div>
  </div>
  <p class="ref">Order ID: ${item.id}</p>
  <div class="footer">
    <p>Thank you for your support 💜</p>
    <p>support@speakup.ai</p>
  </div>
</div>
<script>window.addEventListener('load',()=>window.print())<\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  if (!win) {
    const a = Object.assign(document.createElement('a'), { href: url, download: `invoice-${shortId}.html` });
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ─── Billing History Card ─────────────────────────────────────────────────────
export function BillingHistoryCard({ history, className = '' }: { history: BillingHistoryItem[]; className?: string }) {
  return (
    <Card className={`flex flex-col ${className}`}>
      <CardHeader
        icon={<IconBox color="gray"><Receipt className="w-4 h-4" /></IconBox>}
        title="Invoices"
      />
      {history.length === 0 ? (
        <div className="flex-1 min-h-40 text-center py-10 flex flex-col items-center justify-center gap-2">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#f3f3f3' }}>
            <Receipt className="w-7 h-7" style={{ color: '#e2e2e2' }} />
          </div>
          <p className="text-sm font-medium" style={{ color: '#becbb1' }}>No transactions yet</p>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: '#f3f3f3' }}>
          {history.map(item => (
            <div key={item.id} className="flex items-center gap-3 py-4">
              <IconBox color={item.order_type === 'subscription' ? 'blue' : 'green'}>
                {item.order_type === 'subscription'
                  ? <CreditCard className="w-4 h-4" />
                  : <Package className="w-4 h-4" />
                }
              </IconBox>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: '#1a1c1c', fontFamily: 'Lexend, sans-serif' }}>{item.description}</p>
                <p className="text-xs font-medium" style={{ color: '#6f7b64' }}>{fmtDate(item.paid_at)}</p>
              </div>
              <span className="text-sm font-extrabold flex-shrink-0 mr-1" style={{ color: '#1a1c1c', fontFamily: 'Lexend, sans-serif' }}>
                {fmtVnd(item.amount_vnd)}
              </span>
              <button
                onClick={() => openInvoice(item)}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110 flex-shrink-0"
                style={{ background: '#f3f3f3' }}
                title="Download invoice"
              >
                <Download className="w-3.5 h-3.5" style={{ color: '#6f7b64' }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
