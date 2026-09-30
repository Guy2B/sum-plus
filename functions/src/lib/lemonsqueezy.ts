import type { EntitlementDoc, SubStatus } from './entitlements';

/** Subset of a Lemon Squeezy subscription webhook payload that we rely on. */
export interface LemonEvent {
  meta: { event_name: string; custom_data?: { uid?: string } | null };
  data: {
    id: string;
    type: string;
    attributes: {
      status: string;
      ends_at?: string | null;
      renews_at?: string | null;
      trial_ends_at?: string | null;
      updated_at?: string;
      test_mode?: boolean;
      urls?: { customer_portal?: string | null };
    };
  };
}

const STATUS_MAP: Record<string, SubStatus> = {
  on_trial: 'on_trial',
  active: 'active',
  paused: 'expired',
  past_due: 'past_due',
  unpaid: 'expired',
  cancelled: 'cancelled',
  expired: 'expired',
};

export const HANDLED_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'subscription_resumed',
  'subscription_expired',
  'subscription_paused',
  'subscription_unpaused',
  'subscription_payment_success',
  'subscription_payment_failed',
  'subscription_payment_recovered',
]);

export function parseLemonEvent(body: unknown): LemonEvent | null {
  if (!body || typeof body !== 'object') return null;
  const e = body as LemonEvent;
  if (typeof e.meta?.event_name !== 'string' || typeof e.data?.id !== 'string' || typeof e.data?.attributes?.status !== 'string') return null;
  return e;
}

/** Maps a subscription event to the entitlement it implies (without timestamps). */
export function toEntitlement(e: LemonEvent): Omit<EntitlementDoc, 'validUntilTs'> {
  const a = e.data.attributes;
  const status = STATUS_MAP[a.status] ?? 'expired';
  const validUntil = a.ends_at ?? a.renews_at ?? a.trial_ends_at ?? null;
  const pro = status === 'active' || status === 'on_trial' || status === 'past_due' || status === 'cancelled';
  return {
    plan: pro ? 'pro' : 'free',
    status,
    validUntil,
    source: 'lemonsqueezy',
    customerPortalUrl: a.urls?.customer_portal ?? null,
    subscriptionId: e.data.id,
    providerUpdatedAt: a.updated_at ?? null,
  };
}

/** Out-of-order delivery guard: never let an older event overwrite a newer one. */
export function isNewer(incoming: string | null | undefined, stored: string | null | undefined): boolean {
  if (!stored || !incoming) return true;
  return new Date(incoming).getTime() >= new Date(stored).getTime();
}
