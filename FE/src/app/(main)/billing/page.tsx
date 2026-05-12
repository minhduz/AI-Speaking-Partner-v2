'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import {
  billingService, streamPaymentStatus,
  type Subscription, type Usage, type Plan,
  type AddonPackage, type CheckoutResult, type BillingHistoryItem,
} from '@/services/billing.service';
import { ErrorBanner } from './_components/ui';
import { CancelModal, CheckoutModal, type PendingOrder, type PlanOption } from './_components/modals';
import {
  CurrentPlanCard, UpgradeCard, TokenPacksCard, BillingHistoryCard, ProLoveCard,
} from './_components/cards';

export default function BillingPage() {
  const [subscription,    setSubscription]    = useState<Subscription | null>(null);
  const [usage,           setUsage]           = useState<Usage | null>(null);
  const [paidPlans,       setPaidPlans]       = useState<Plan[]>([]);
  const [addonPackages,   setAddonPackages]   = useState<AddonPackage[]>([]);
  const [addonBalance,    setAddonBalance]    = useState(0);
  const [history,         setHistory]         = useState<BillingHistoryItem[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [showCancel,      setShowCancel]      = useState(false);
  const [cancelling,      setCancelling]      = useState(false);
  const [pendingOrder,    setPendingOrder]    = useState<PendingOrder | null>(null);
  const [checkoutError,   setCheckoutError]   = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [sub, usg, plans, addons, balance] = await Promise.all([
        billingService.getSubscription(), billingService.getUsage(),
        billingService.getPlans(), billingService.getAddonPackages(),
        billingService.getAddonBalance(),
      ]);
      setSubscription(sub); setUsage(usg);
      setPaidPlans(plans.filter(p => p.priceVnd > 0));
      setAddonPackages(addons); setAddonBalance(balance.balance);
    } catch (err) { console.error('[Billing] load failed:', err); }
    finally { setLoading(false); }
    billingService.getHistory().then(setHistory).catch(() => {});
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

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
      '5M AI tokens per month',
      'Unlimited speaking sessions',
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

  /** Open order review modal for an addon token pack */
  const openAddonCheckout = useCallback((pkg: AddonPackage) => {
    setPendingOrder({
      label:    pkg.name,
      priceVnd: pkg.priceVnd,
      type:     'addon',
      features: [`+${pkg.tokenAmount.toLocaleString()} tokens added to your balance`, 'Never expires'],
      factory:  () => billingService.addonCheckout(pkg.id),
    });
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-[#F8F9FB] font-[family-name:var(--font-lexend)]">
        <div className="w-14 h-14 rounded-2xl bg-[#d972ff]/20 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-[#8447ff] animate-spin" />
        </div>
        <p className="text-sm text-gray-400 animate-pulse">Loading your plan…</p>
      </div>
    );
  }

  const isPro        = (subscription?.plan?.priceVnd ?? 0) > 0;
  const planLabel    = subscription?.plan?.interval === 'month' ? 'Pro Monthly' : 'Pro Yearly';
  const proHighlight = paidPlans.find(p => p.interval === 'year') ?? paidPlans[0];
  const monthlyPlan  = paidPlans.find(p => p.interval === 'month');
  const hasUpgrade   = !isPro && !!proHighlight;

  return (
    <div className="flex-1 flex flex-col bg-[#F8F9FB] overflow-hidden font-[family-name:var(--font-lexend)]">

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-5 pt-5 pb-4 flex items-center gap-3">
        <Link href="/chat" className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition">
          <ArrowLeft className="w-4 h-4 text-gray-600" />
        </Link>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Billing &amp; Subscription</h1>
          <p className="text-xs text-gray-400">Manage your plan and AI tokens</p>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-4xl mx-auto space-y-4">

          {checkoutError && <ErrorBanner message={checkoutError} />}

          {/* ══ Bento Grid ══ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            <div className={hasUpgrade || isPro ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <CurrentPlanCard
                subscription={subscription} usage={usage}
                isPro={isPro} planLabel={planLabel}
                onCancel={() => setShowCancel(true)}
              />
            </div>

            {/* Love card — Pro only, mirrors UpgradeCard slot */}
            {isPro && (
              <div className="lg:row-span-2">
                <ProLoveCard />
              </div>
            )}

            {hasUpgrade && (
              <div className="lg:row-span-2">
                <UpgradeCard
                  proHighlight={proHighlight!}
                  monthlyPlan={monthlyPlan}
                  onSelectPlan={openPlanCheckout}
                />
              </div>
            )}

            <div className={hasUpgrade || isPro ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <TokenPacksCard
                packages={addonPackages}
                balance={addonBalance}
                onSelectAddon={openAddonCheckout}
              />
            </div>

            <div className="lg:col-span-3">
              <BillingHistoryCard history={history} />
            </div>

          </div>

          <p className="text-center text-xs text-gray-400 pb-2">
            Questions about your bill?{' '}
            <a href="mailto:support@speakup.ai" className="text-[#8447ff] underline underline-offset-2 hover:opacity-80">
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
    </div>
  );
}
