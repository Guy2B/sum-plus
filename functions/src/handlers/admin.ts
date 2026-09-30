import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { z } from 'zod';
import {
  CONNECTOR_ENCRYPTION_KEY,
  LEMONSQUEEZY_WEBHOOK_SECRET,
  LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET,
  PUBLIC_APP_URL,
  REGION,
  TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET,
  Timestamp,
  X_CLIENT_ID,
  X_CLIENT_SECRET,
  ENFORCE_APP_CHECK,
  FieldValue,
  audit,
  auth,
  callableDefaults,
  db,
  logger,
  requireAdmin,
} from '../lib/runtime';

const secretSet = (s: { value(): string }) => {
  try {
    return Boolean(s.value());
  } catch {
    return false;
  }
};

/** Server-side production readiness, shown in the Admin QA console. */
export const adminDiagnostics = onCall(
  {
    ...callableDefaults,
    secrets: [
      CONNECTOR_ENCRYPTION_KEY,
      LEMONSQUEEZY_WEBHOOK_SECRET,
      LINKEDIN_CLIENT_SECRET,
      X_CLIENT_SECRET,
      TIKTOK_CLIENT_SECRET,
    ],
  },
  async (req) => {
    requireAdmin(req);
    const [pro, admins] = await Promise.all([
      db.collection('entitlements').where('plan', '==', 'pro').count().get(),
      db.collection('auditLog').where('action', '==', 'admin.entitlement').count().get(),
    ]);
    let key = false;
    try {
      key = Buffer.from(CONNECTOR_ENCRYPTION_KEY.value(), 'base64').length === 32;
    } catch {
      key = false;
    }
    return {
      region: REGION,
      node: process.version,
      appCheckEnforced: ENFORCE_APP_CHECK,
      publicAppUrl: PUBLIC_APP_URL.value(),
      connectorKey: key,
      webhookSecret: secretSet(LEMONSQUEEZY_WEBHOOK_SECRET),
      linkedin: Boolean(LINKEDIN_CLIENT_ID.value()) && secretSet(LINKEDIN_CLIENT_SECRET),
      x: Boolean(X_CLIENT_ID.value()) && secretSet(X_CLIENT_SECRET),
      tiktok: Boolean(TIKTOK_CLIENT_KEY.value()) && secretSet(TIKTOK_CLIENT_SECRET),
      proSubscribers: pro.data().count,
      manualGrants: admins.data().count,
    };
  },
);

const GrantInput = z.object({ email: z.string().email().max(200), plan: z.enum(['pro', 'free']) });

/** Manual Pro grants (partners, QA). Every change is written to the audit log. */
export const adminSetEntitlement = onCall(callableDefaults, async (req) => {
  const adminUid = requireAdmin(req);
  const parsed = GrantInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid input');
  const user = await auth.getUserByEmail(parsed.data.email).catch(() => null);
  if (!user) throw new HttpsError('not-found', 'No user with this email');
  await db.doc(`entitlements/${user.uid}`).set({
    plan: parsed.data.plan,
    status: parsed.data.plan === 'pro' ? 'active' : 'none',
    validUntil: null,
    validUntilTs: null,
    source: parsed.data.plan === 'pro' ? 'admin' : 'none',
    customerPortalUrl: null,
    subscriptionId: null,
    providerUpdatedAt: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await audit(adminUid, 'admin.entitlement', { target: user.uid, plan: parsed.data.plan });
  return { ok: true };
});

/** Hourly housekeeping: expired OAuth states and rate-limit windows. */
export const housekeeping = onSchedule(
  { region: REGION, schedule: 'every 60 minutes', timeZone: 'Europe/Paris' },
  async () => {
    const now = Timestamp.now();
    for (const col of ['oauthStates', 'rateLimits']) {
      const stale = await db.collection(col).where('expiresAt', '<', now).limit(500).get();
      const batch = db.batch();
      stale.docs.forEach((d) => batch.delete(d.ref));
      if (!stale.empty) await batch.commit();
      logger.info('housekeeping', { collection: col, deleted: stale.size });
    }
  },
);
