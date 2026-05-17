'use client';
import { useState } from 'react';
import {
  Zap, Target, Clock, Crown,
  TrendingUp, Sparkles, CheckCircle2, Package,
  CreditCard, Receipt, Download, Heart, Share2,
} from 'lucide-react';

import type { Subscription, Usage, Plan, BillingHistoryItem } from '@/services/billing.service';
import { Badge, Card, CardHeader, IconBox } from './ui';

const fmtVnd  = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTok  = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000   ? `${(n / 1_000).toFixed(0)}k`
  : String(n);

// ─── Current Plan Card ────────────────────────────────────────────────────────
export function CurrentPlanCard({ subscription, usage, isPro, planLabel, onCancel }: {
  subscription: Subscription | null; usage: Usage | null;
  isPro: boolean; planLabel: string; onCancel: () => void;
}) {
  const isUnlimited = usage?.is_unlimited ?? false;

  return (
    <div className={`rounded-3xl p-6 shadow-sm ${isPro ? 'bg-[#F0EBFF]' : 'bg-white'}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="space-y-1">
          <Badge variant={isPro ? 'primary' : 'soft'}>
            <Crown className="w-3 h-3" />
            {isPro ? 'Pro Active' : 'Free Plan'}
          </Badge>
          <h2 className="text-2xl font-bold text-gray-900">{isPro ? planLabel : 'Basic Learner'}</h2>
          <p className="text-sm text-gray-400">
            {isPro
              ? subscription?.cancelled_at
                ? `Cancelled · Expires ${fmtDate(subscription.current_period_end)}`
                : `Renews ${fmtDate(subscription!.current_period_end)}`
              : 'Free forever · 10 sessions/day'}
          </p>
        </div>
        <div className="flex-shrink-0 ml-4">
          {!isPro && <p className="text-2xl font-bold text-gray-300">Free</p>}
          {isPro && !subscription?.cancelled_at && (
            <button
              onClick={onCancel}
              className="text-xs text-gray-400 hover:text-rose-500 transition underline underline-offset-2"
            >
              Cancel plan
            </button>
          )}
        </div>
      </div>

      {/* Usage blocks */}
      {usage && (
        <div className="space-y-3">

          {/* AI Energy — violet pastel */}
          <div className="bg-violet-50 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-violet-100 flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 text-[#8447FF]" />
                </div>
                <span className="text-sm font-semibold text-gray-700">AI Energy</span>
              </div>
              <span className="text-xs text-gray-500 font-mono bg-white/70 px-2.5 py-1 rounded-full">
                {fmtTok(usage.tokens_used)} used this month
              </span>
            </div>
            <p className="text-xs text-violet-500 font-medium pl-9">
              {isUnlimited ? 'Unlimited practice length' : `${fmtTok(usage.session_token_limit)} token safety limit per session`}
            </p>
          </div>

          {/* Sessions — emerald pastel */}
          <div className="bg-emerald-50 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-emerald-100 flex items-center justify-center">
                  <Target className="w-3.5 h-3.5 text-emerald-600" />
                </div>
                <span className="text-sm font-semibold text-gray-700">Sessions</span>
              </div>
              <span className="text-xs text-gray-500 font-mono bg-white/70 px-2.5 py-1 rounded-full">
                {usage.sessions_used} this month
              </span>
            </div>
            <p className="text-xs text-emerald-600 font-medium pl-9">
              {isUnlimited ? '∞ Unlimited sessions' : `${usage.daily_session_limit} per day`}
            </p>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-gray-400 pl-1">
            <Clock className="w-3 h-3" />
            Resets {usage.resets_at ? fmtDate(usage.resets_at) : 'next month'}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Upgrade Card ─────────────────────────────────────────────────────────────
export function UpgradeCard({ proHighlight, monthlyPlan, onSelectPlan }: {
  proHighlight: Plan; monthlyPlan: Plan | undefined;
  onSelectPlan: (plan: Plan) => void;
}) {
  return (
    <div className="rounded-3xl bg-[#EDE9FE] shadow-sm overflow-hidden flex flex-col h-full">
      {/* Illustration */}
      <div className="w-full h-36 bg-[#DDD6FE] flex items-end justify-center overflow-hidden px-4 pt-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/undraw_make-it-rain.svg"
          alt="Upgrade to Pro"
          className="h-full w-full object-contain object-bottom"
        />
      </div>

      <div className="p-6 flex flex-col flex-1">
        <div className="flex items-center gap-2 mb-1">
          <Crown className="w-4 h-4 text-[#8447FF]" />
          <h2 className="text-xl font-bold text-gray-900">Upgrade to Pro</h2>
        </div>
        <p className="text-sm text-gray-500 leading-relaxed mb-5">
          Unlock unlimited AI speaking practice and accelerate your learning.
        </p>

        {/* Price */}
        <div className="mb-5">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-gray-900">{fmtVnd(proHighlight.priceVnd)}</span>
            <span className="text-sm text-gray-500">/{proHighlight.interval === 'year' ? 'yr' : 'mo'}</span>
          </div>
          {proHighlight.interval === 'year' && (
            <span className="inline-flex items-center gap-1 mt-1.5 bg-[#8447FF] text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full">
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
            <li key={f} className="flex items-center gap-2.5 text-sm text-gray-700">
              <CheckCircle2 className="w-4 h-4 text-[#8447FF] flex-shrink-0" />
              {f}
            </li>
          ))}
        </ul>

        <button
          onClick={() => onSelectPlan(proHighlight)}
          className="w-full py-4 rounded-2xl bg-[#8447FF] text-white font-bold text-sm hover:bg-[#7C3AED] active:scale-[0.98] transition-all shadow-md flex items-center justify-center gap-2"
        >
          <Sparkles className="w-4 h-4" /> Get Pro Now
        </button>
        {monthlyPlan && (
          <button
            onClick={() => onSelectPlan(monthlyPlan)}
            className="w-full mt-2 py-2.5 rounded-xl text-xs text-gray-500 hover:bg-white/50 transition"
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
  // Clipboard fallback — copy full message so pasting shows text + link
  try { await navigator.clipboard.writeText(`${text}\n${url}`); } catch { /* ignore */ }
  onCopied();
}

// ─── Pro Love Card — shown in right column when user is Pro ───────────────────
export function ProLoveCard() {
  const [copied, setCopied] = useState(false);

  const handleShare = () =>
    doShare(() => { setCopied(true); setTimeout(() => setCopied(false), 2200); });

  return (
    <div className="rounded-3xl bg-[#FFF0F8] shadow-sm overflow-hidden flex flex-col h-full">
      {/* Illustration */}
      <div className="w-full h-40 bg-[#FFE4F0] flex items-end justify-center overflow-hidden px-6 pt-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/undraw_love.svg"
          alt="We love our Pro members"
          className="h-full w-full object-contain object-bottom"
        />
      </div>

      <div className="p-6 flex flex-col flex-1">
        <div className="flex items-center gap-2 mb-1">
          <Heart className="w-4 h-4 text-pink-500 fill-pink-500" />
          <h2 className="text-lg font-bold text-gray-900">Thank you! 💜</h2>
        </div>
        <p className="text-sm text-gray-500 leading-relaxed mb-5">
          You&apos;re part of our Pro family. Your support keeps us building a better AI speaking partner.
        </p>

        {/* Perks reminder */}
        <ul className="space-y-2 mb-5 flex-1">
          {[
            'Unlimited speaking sessions',
            'Unlimited practice length',
            'Priority AI processing',
          ].map(perk => (
            <li key={perk} className="flex items-center gap-2 text-sm text-gray-600">
              <div className="w-1.5 h-1.5 rounded-full bg-pink-400 flex-shrink-0" />
              {perk}
            </li>
          ))}
        </ul>

        <button
          onClick={handleShare}
          className="w-full py-3 rounded-2xl border border-pink-200 text-sm font-semibold transition flex items-center justify-center gap-2 hover:bg-pink-50 active:scale-[0.98]"
          style={{ color: copied ? '#059669' : '#EC4899' }}
        >
          {copied
            ? <><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Link copied!</>
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
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fb;color:#1f2937;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{max-width:680px;margin:40px auto;background:#fff;border-radius:16px;padding:48px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:32px;border-bottom:1px solid #e5e7eb}
.brand{font-size:22px;font-weight:800;color:#8447ff}
.brand small{display:block;font-size:12px;font-weight:400;color:#9ca3af;margin-top:3px}
.inv-label h1{font-size:28px;font-weight:800;color:#1f2937;text-align:right}
.inv-label p{font-size:13px;color:#6b7280;text-align:right;margin-top:4px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:40px}
.meta-group label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;margin-bottom:5px}
.meta-group p{font-size:14px;color:#374151;font-weight:500}
.status{display:inline-flex;align-items:center;gap:6px;background:#ecfdf5;color:#059669;font-size:12px;font-weight:700;padding:4px 12px;border-radius:999px}
.status::before{content:'';width:6px;height:6px;border-radius:50%;background:#10b981;display:inline-block}
table{width:100%;border-collapse:collapse;margin-bottom:24px}
thead th{background:#f9fafb;padding:12px 16px;text-align:left;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280}
thead th:last-child{text-align:right}
tbody td{padding:16px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151}
tbody td:last-child{text-align:right;font-weight:600}
.total-row{display:flex;justify-content:flex-end;margin-top:8px}
.total-box{background:#f5f0ff;border-radius:12px;padding:16px 24px;min-width:220px}
.total-box .lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#8447ff;margin-bottom:4px}
.total-box .amt{font-size:26px;font-weight:800;color:#8447ff}
.footer{margin-top:40px;padding-top:24px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center}
.footer p{font-size:12px;color:#9ca3af}
.ref{font-size:11px;color:#d1d5db;margin-top:6px;word-break:break-all}
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
    // Popup blocked — fall back to direct download
    const a = Object.assign(document.createElement('a'), { href: url, download: `invoice-${shortId}.html` });
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ─── Billing History Card ─────────────────────────────────────────────────────
export function BillingHistoryCard({ history }: { history: BillingHistoryItem[] }) {
  return (
    <Card>
      <CardHeader
        icon={<IconBox color="gray"><Receipt className="w-4 h-4 text-gray-500" /></IconBox>}
        title="Invoices"
      />
      {history.length === 0 ? (
        <div className="text-center py-10 flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center">
            <Receipt className="w-7 h-7 text-gray-200" />
          </div>
          <p className="text-sm text-gray-300 mt-1">No transactions yet</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {history.map(item => (
            <div key={item.id} className="flex items-center gap-3 py-4">
              <IconBox color={item.order_type === 'subscription' ? 'purple' : 'green'}>
                {item.order_type === 'subscription'
                  ? <CreditCard className="w-4 h-4 text-[#8447FF]" />
                  : <Package className="w-4 h-4 text-emerald-600" />
                }
              </IconBox>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{item.description}</p>
                <p className="text-xs text-gray-400">{fmtDate(item.paid_at)}</p>
              </div>
              <span className="text-sm font-bold text-gray-900 flex-shrink-0 mr-1">
                {fmtVnd(item.amount_vnd)}
              </span>
              <button
                onClick={() => openInvoice(item)}
                className="w-7 h-7 rounded-xl hover:bg-gray-100 flex items-center justify-center transition flex-shrink-0"
                title="Download invoice"
              >
                <Download className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
