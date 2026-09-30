/**
 * Server-side entitlement model. Mirrors apps/web/src/domain/entitlements.ts;
 * this copy is the authoritative one (Firestore rules implement the same test).
 */
export type Plan = 'free' | 'pro';
export type SubStatus = 'active' | 'on_trial' | 'past_due' | 'cancelled' | 'expired' | 'none';

export interface EntitlementDoc {
  plan: Plan;
  status: SubStatus;
  /** ISO string for clients. */
  validUntil: string | null;
  /** Same instant as a Firestore Timestamp, for security rules. */
  validUntilTs?: unknown;
  source: 'lemonsqueezy' | 'admin' | 'none';
  customerPortalUrl?: string | null;
  subscriptionId?: string | null;
  providerUpdatedAt?: string | null;
}

export function isPro(e: Pick<EntitlementDoc, 'plan' | 'status' | 'validUntil'> | null | undefined, now: Date = new Date()): boolean {
  if (!e || e.plan !== 'pro') return false;
  if (e.status === 'active' || e.status === 'on_trial' || e.status === 'past_due') return true;
  if (e.status === 'cancelled' && e.validUntil) return new Date(e.validUntil).getTime() > now.getTime();
  return false;
}
