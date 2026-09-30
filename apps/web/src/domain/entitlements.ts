/**
 * Commercial plans. The client uses this table to explain limits; the
 * authoritative check for anything server-side (cloud sync, connectors, IMAP,
 * social) is `entitlements/{uid}`, written only by the payment webhook and
 * enforced by Firestore rules and Cloud Functions.
 */

export type Plan = 'free' | 'pro';

export type Feature =
  | 'finance'
  | 'health'
  | 'household'
  | 'career'
  | 'cloudSync'
  | 'driveBackup'
  | 'mailMultiAccount'
  | 'imap'
  | 'social'
  | 'calendarSync'
  | 'unlimitedCoach'
  | 'unlimitedProjects'
  | 'unlimitedHabits';

export const PRO_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  'finance',
  'health',
  'household',
  'career',
  'cloudSync',
  'driveBackup',
  'mailMultiAccount',
  'imap',
  'social',
  'calendarSync',
  'unlimitedCoach',
  'unlimitedProjects',
  'unlimitedHabits',
]);

export const FREE_LIMITS = Object.freeze({
  coachPerDay: 5,
  projects: 1,
  habits: 3,
  mailAccounts: 1,
});

export interface Entitlement {
  plan: Plan;
  status: 'active' | 'on_trial' | 'past_due' | 'cancelled' | 'expired' | 'none';
  /** ISO date until which Pro remains valid (e.g. after cancellation). */
  validUntil?: string | null;
  source?: 'lemonsqueezy' | 'admin' | 'none';
  customerPortalUrl?: string | null;
}

export const FREE_ENTITLEMENT: Entitlement = { plan: 'free', status: 'none', source: 'none' };

export function isPro(e: Entitlement | null | undefined, now: Date = new Date()): boolean {
  if (!e || e.plan !== 'pro') return false;
  if (e.status === 'active' || e.status === 'on_trial' || e.status === 'past_due') return true;
  // Cancelled subscriptions keep access until the end of the paid period.
  if (e.status === 'cancelled' && e.validUntil) return new Date(e.validUntil).getTime() > now.getTime();
  return false;
}

export function can(feature: Feature, e: Entitlement | null | undefined, now: Date = new Date()): boolean {
  return !PRO_FEATURES.has(feature) || isPro(e, now);
}

export function withinLimit(
  kind: keyof typeof FREE_LIMITS,
  currentCount: number,
  e: Entitlement | null | undefined,
): boolean {
  if (isPro(e)) return true;
  return currentCount < FREE_LIMITS[kind];
}
