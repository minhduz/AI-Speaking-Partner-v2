'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/chat/sidebar/sidebar';
import { useAuthContext } from '@/contexts/auth-context';
import {
  billingService, streamPaymentStatus,
  type Subscription, type Usage, type Plan,
  type CheckoutResult, type BillingHistoryItem,
} from '@/services/billing.service';
import { sessionService, type SessionQuota } from '@/services/session.service';
import { ErrorBanner } from './_components/ui';
import { CancelModal, CheckoutModal, type PendingOrder, type PlanOption } from './_components/modals';
import {
  CurrentPlanCard, UpgradeCard, BillingHistoryCard, ProLoveCard,
} from './_components/cards';

export default function BillingPage() {
  const { logout } = useAuthContext();
  const router = useRouter();
  const [subscription,    setSubscription]    = useState<Subscription | null>(null);
  const [usage,           setUsage]           = useState<Usage | null>(null);
  const [quota,           setQuota]           = useState<SessionQuota | null>(null);
  const [paidPlans,       setPaidPlans]       = useState<Plan[]>([]);
  const [history,         setHistory]         = useState<BillingHistoryItem[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [showCancel,      setShowCancel]      = useState(false);
  const [cancelling,      setCancelling]      = useState(false);
  const [pendingOrder,    setPendingOrder]    = useState<PendingOrder | null>(null);
  const [checkoutError,   setCheckoutError]   = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [sub, usg, plans, qta] = await Promise.all([
        billingService.getSubscription(), billingService.getUsage(),
        billingService.getPlans(), sessionService.getQuota().catch(() => null),
      ]);
      setSubscription(sub); setUsage(usg); setQuota(qta);
      setPaidPlans(plans.filter(p => p.priceVnd > 0));
    } catch (err) { console.error('[Billing] load failed:', err); }
    finally { setLoading(false); }
    billingService.getHistory().then(setHistory).catch(() => {});
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  /** Called by CheckoutModal after QR is generated. Returns a Promise that resolves when payment.paid is received via SSE. */
  const handleConfirmCheckout = useCallback((result: CheckoutResult): Promise<void> => {
    return new Promise((resolve, reject) => {
      (async () => {
        try {
          for await (const ev of streamPaymentStatus(result.order_id)) {
            if (ev.type === 'payment.paid') {
              await loadData();
              resolve();
              return;
            }
            if (ev.type === 'payment.expired') {
              setPendingOrder(null); // unmount modal; Promise left pending intentionally
              return;
            }
          }
        } catch (err) {
          reject(err);
        }
      })();
    });
  }, [loadData]);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    try { await billingService.cancelSubscription(); await loadData(); setShowCancel(false); }
    catch (err) { console.error('[Billing] cancel failed:', err); }
    finally { setCancelling(false); }
  }, [loadData]);

  /** Build a PlanOption from a Plan object */
  const toPlanOption = useCallback((plan: Plan): PlanOption => ({
    label:    plan.interval === 'year' ? 'Pro Yearly' : 'Pro Monthly',
    priceVnd: plan.priceVnd,
    interval: plan.interval,
    features: [
      'Unlimited speaking sessions',
      'Unlimited practice length',
      'Detailed pronunciation analysis',
      'Priority processing speed',
    ],
    factory: () => billingService.checkout(plan.id),
  }), []);

  /** Open order review for a plan — passes alt plan for toggle */
  const openPlanCheckout = useCallback((plan: Plan) => {
    const other = paidPlans.find(p => p.id !== plan.id);
    setPendingOrder({
      type:    'plan',
      primary: toPlanOption(plan),
      alt:     other ? toPlanOption(other) : undefined,
    });
  }, [paidPlans, toPlanOption]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ background: '#f9f9f9', fontFamily: 'Lexend, sans-serif' }}>
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: '#58cc02' }}
        >
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#1e5000' }} />
        </div>
        <p className="text-sm font-medium animate-pulse" style={{ color: '#6f7b64' }}>Loading your plan…</p>
      </div>
    );
  }

  const isPro        = (subscription?.plan?.priceVnd ?? 0) > 0;
  const planLabel    = subscription?.plan?.interval === 'month' ? 'Pro Monthly' : 'Pro Yearly';
  const proHighlight = paidPlans.find(p => p.interval === 'year') ?? paidPlans[0];
  const monthlyPlan  = paidPlans.find(p => p.interval === 'month');
  const hasUpgrade   = !isPro && !!proHighlight;

  return (
    <>
      <Sidebar
        onNewChat={() => router.push('/chat')}
        onLogout={logout}
        currentSessionId={null}
        onSessionClick={(session) => router.push(`/chat?sessionId=${session.id}`)}
      />

      <main
        className="flex flex-1 flex-col overflow-hidden"
        style={{ background: '#f9f9f9', fontFamily: 'Lexend, sans-serif' }}
      >
        {/* ── Top bar: synced with chat dashboard ── */}
        <header
          className="flex items-center justify-between px-10 h-20 shrink-0 sticky top-0 z-40"
          style={{ background: '#f9f9f9' }}
        >
          <h1
            className="text-2xl font-black"
            style={{ color: '#2b6c00', letterSpacing: '-0.01em' }}
          >
            Billing &amp; Subscription
          </h1>

          <div className="hidden md:flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-2xl px-4 py-2" style={{ background: '#ffffff', border: '2px solid #e2e2e2' }}>
              <ShieldCheck className="h-4 w-4" style={{ color: '#2b6c00' }} />
              <span className="text-xs font-extrabold" style={{ color: '#3f4a36' }}>
                Secure QR checkout
              </span>
            </div>
          </div>
        </header>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-6 md:px-10 md:py-8">
          <div className="max-w-5xl mx-auto space-y-6">
            <section
              className="rounded-3xl p-6 md:p-8 overflow-hidden relative"
              style={{ background: '#ffffff', border: '2px solid #e2e2e2', boxShadow: '0 4px 0 #e2e2e2' }}
            >
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="max-w-2xl">
                  <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-3" style={{ background: '#dff5c5', color: '#1e5000' }}>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-extrabold uppercase tracking-widest">
                      {isPro ? 'Pro learning unlocked' : 'Upgrade when you are ready'}
                    </span>
                  </div>
                  <h2 className="text-3xl md:text-5xl font-black leading-tight tracking-[-0.03em]" style={{ color: '#1a1c1c' }}>
                    Keep your speaking practice flowing.
                  </h2>
                  <p className="mt-3 text-base md:text-lg font-medium leading-relaxed" style={{ color: '#6f7b64' }}>
                    Track usage, manage your plan, and download invoices in the same playful dashboard style as your chat workspace.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 md:min-w-[260px]">
                  <MiniStat label="Plan" value={isPro ? 'Pro' : 'Free'} tone={isPro ? 'green' : 'gray'} />
                  <MiniStat label="Sessions" value={usage?.is_unlimited ? '∞' : String(usage?.daily_session_limit ?? '—')} tone="blue" />
                </div>
              </div>
            </section>

            {checkoutError && <ErrorBanner message={checkoutError} />}

            {/* ══ Bento Grid ══ */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className={`${hasUpgrade || isPro ? 'lg:col-span-8' : 'lg:col-span-12'} flex min-h-0 flex-col gap-5 self-stretch`}>
                <CurrentPlanCard
                  subscription={subscription} usage={usage} quota={quota}
                  isPro={isPro} planLabel={planLabel}
                  onCancel={() => setShowCancel(true)}
                />
                <BillingHistoryCard history={history} className="lg:flex-1" />
              </div>

              {isPro && (
                <div className="lg:col-span-4 self-stretch">
                  <ProLoveCard />
                </div>
              )}

              {hasUpgrade && (
                <div className="lg:col-span-4 self-stretch">
                  <UpgradeCard
                    proHighlight={proHighlight!}
                    monthlyPlan={monthlyPlan}
                    onSelectPlan={openPlanCheckout}
                  />
                </div>
              )}
            </div>

            <p className="text-center text-xs pb-2" style={{ color: '#6f7b64' }}>
              Questions about your bill?{' '}
              <a href="mailto:support@speakup.ai" className="font-bold underline underline-offset-2 hover:opacity-80" style={{ color: '#006590' }}>
                Contact support
              </a>
            </p>
          </div>
        </div>

        {/* ── Modals ── */}
        {showCancel && subscription && (
          <CancelModal
            sub={subscription}
            onConfirm={handleCancel}
            onClose={() => setShowCancel(false)}
            confirming={cancelling}
          />
        )}

        {pendingOrder && (
          <CheckoutModal
            order={pendingOrder}
            onClose={() => { setPendingOrder(null); setCheckoutError(null); }}
            onConfirm={handleConfirmCheckout}
          />
        )}
      </main>
    </>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: 'green' | 'blue' | 'gray' }) {
  const styles = {
    green: { bg: '#dff5c5', fg: '#1e5000', border: '#87fe45' },
    blue:  { bg: '#dceeff', fg: '#004666', border: '#88ceff' },
    gray:  { bg: '#f3f3f3', fg: '#3f4a36', border: '#e2e2e2' },
  }[tone];

  return (
    <div className="rounded-2xl p-4" style={{ background: styles.bg, border: `2px solid ${styles.border}` }}>
      <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: styles.fg, opacity: 0.75 }}>
        {label}
      </p>
      <p className="text-2xl font-black mt-1" style={{ color: styles.fg }}>
        {value}
      </p>
    </div>
  );
}
