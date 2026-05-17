import { httpClient } from '@/lib/http-client';
import { getAccessToken } from '@/lib/http-client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export interface Plan {
  id: string;
  name: string;
  interval: 'month' | 'year';
  priceVnd: number;
  tokenLimit: number;
  sessionLimit: number;
  isActive: boolean;
}

export interface Subscription {
  plan: Plan;
  status: string;
  current_period_start: string;
  current_period_end: string;
  auto_renew: boolean;
  cancelled_at: string | null;
}

export interface BillingHistoryItem {
  id: string;
  order_type: 'subscription' | 'addon';
  description: string;
  amount_vnd: number;
  paid_at: string;
}

export interface Usage {
  is_unlimited: boolean;
  daily_session_limit: number;   // -1 = unlimited
  session_token_limit: number;   // -1 = unlimited
  tokens_used: number;           // cumulative this billing period
  sessions_used: number;         // cumulative this billing period
  resets_at: string;
}

export interface AddonPackage {
  id: string;
  name: string;
  tokenAmount: number;
  priceVnd: number;
  isActive: boolean;
}

export interface AddonBalance {
  balance: number;
}

export interface CheckoutResult {
  order_id: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  amount_vnd: number;
  content_code: string;
  qr_url: string;
  expires_at: string;
}

export type PaymentSSEEvent =
  | { type: 'payment.paid' }
  | { type: 'payment.expired' }
  | { type: 'error'; message: string };

export const billingService = {
  getPlans:         () => httpClient.get<Plan[]>('/billing/plans'),
  getAddonPackages: () => httpClient.get<AddonPackage[]>('/billing/addon-packages'),
  getSubscription:  () => httpClient.get<Subscription>('/billing/subscription'),
  getUsage:         () => httpClient.get<Usage>('/billing/usage'),
  getAddonBalance:  () => httpClient.get<AddonBalance>('/billing/addon/balance'),

  checkout:      (planId: string) =>
    httpClient.post<CheckoutResult>('/billing/checkout', { plan_id: planId }),
  addonCheckout: (addonPackageId: string) =>
    httpClient.post<CheckoutResult>('/billing/addon/checkout', { addon_package_id: addonPackageId }),
  cancelSubscription: () =>
    httpClient.post<{ status: string; current_period_end: string }>('/billing/subscription/cancel'),
  getHistory: () => httpClient.get<BillingHistoryItem[]>('/billing/history'),
};

// SSE stream for payment status — uses fetch (EventSource doesn't support auth headers)
export async function* streamPaymentStatus(orderId: string): AsyncGenerator<PaymentSSEEvent> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/billing/payment/${orderId}/stream`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok || !res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ') && line.length > 6) {
        try { yield JSON.parse(line.slice(6)) as PaymentSSEEvent; } catch { /* skip malformed */ }
      }
    }
  }
}
