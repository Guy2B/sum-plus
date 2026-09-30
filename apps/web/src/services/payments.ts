/**
 * Hosted checkout (Lemon Squeezy, merchant of record). The Firebase UID is
 * passed as custom checkout data; the signed webhook maps the subscription to
 * `entitlements/{uid}`. The client never grants itself Pro.
 */
import { config } from '../config';
import { authUser } from '../data/store';

export type Billing = 'monthly' | 'annual';

export function checkoutConfigured(): boolean {
  return Boolean(config.payments.monthlyCheckoutUrl && config.payments.annualCheckoutUrl);
}

export function checkoutUrl(billing: Billing): string | null {
  const base = billing === 'monthly' ? config.payments.monthlyCheckoutUrl : config.payments.annualCheckoutUrl;
  const user = authUser.value;
  if (!base || !user) return null;
  const url = new URL(base);
  url.searchParams.set('checkout[custom][uid]', user.uid);
  if (user.email) url.searchParams.set('checkout[email]', user.email);
  url.searchParams.set('checkout[custom][return]', new URL('app.html#account', location.href).toString());
  return url.toString();
}
