import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { isPro, type EntitlementDoc } from './entitlements';

// On Cloud Functions the default credentials are used. Elsewhere (Netlify) a
// least-privilege service account is passed through environment variables.
if (!getApps().length) {
  const { FIREBASE_PROJECT_ID: projectId, FIREBASE_CLIENT_EMAIL: clientEmail, FIREBASE_PRIVATE_KEY: key } = process.env;
  if (projectId && clientEmail && key)
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey: key.replace(/\\n/g, '\n') }), projectId });
  else initializeApp();
}

export const db = getFirestore();
export const auth = getAuth();
export { FieldValue, Timestamp, logger };

export const REGION = 'europe-west1';

/* -------------------------------- params ---------------------------------- */

export const CONNECTOR_ENCRYPTION_KEY = defineSecret('CONNECTOR_ENCRYPTION_KEY');
export const LEMONSQUEEZY_WEBHOOK_SECRET = defineSecret('LEMONSQUEEZY_WEBHOOK_SECRET');
export const LINKEDIN_CLIENT_SECRET = defineSecret('LINKEDIN_CLIENT_SECRET');
export const X_CLIENT_SECRET = defineSecret('X_CLIENT_SECRET');
export const TIKTOK_CLIENT_SECRET = defineSecret('TIKTOK_CLIENT_SECRET');

export const PUBLIC_APP_URL = defineString('PUBLIC_APP_URL', { description: 'Public app URL, e.g. https://sigma.example.com' });
export const ALLOWED_ORIGINS = defineString('ALLOWED_ORIGINS', { default: '', description: 'Extra comma-separated origins allowed as OAuth return targets.' });
export const LINKEDIN_CLIENT_ID = defineString('LINKEDIN_CLIENT_ID', { default: '' });
export const X_CLIENT_ID = defineString('X_CLIENT_ID', { default: '' });
export const TIKTOK_CLIENT_KEY = defineString('TIKTOK_CLIENT_KEY', { default: '' });

export function allowedOrigins(): string[] {
  const base = PUBLIC_APP_URL.value();
  const list = [base, ...ALLOWED_ORIGINS.value().split(',')].map((s) => s.trim()).filter(Boolean);
  return [...new Set(list.map((u) => new URL(u).origin))];
}

export function oauthRedirectUri(): string {
  return process.env.OAUTH_REDIRECT_URI || `${PUBLIC_APP_URL.value().replace(/\/$/, '')}/api/oauth/callback`;
}

/** App Check is enforced in production; the emulator suite runs without it. */
export const ENFORCE_APP_CHECK = process.env.FUNCTIONS_EMULATOR !== 'true';

export const callableDefaults = {
  region: REGION,
  enforceAppCheck: ENFORCE_APP_CHECK,
  cors: true,
  memory: '256MiB' as const,
  timeoutSeconds: 60,
  maxInstances: 20,
};

/* -------------------------------- guards ---------------------------------- */

export function requireAuth(req: CallableRequest<unknown>): string {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  return req.auth.uid;
}

export function requireAdmin(req: CallableRequest<unknown>): string {
  const uid = requireAuth(req);
  if (req.auth?.token.admin !== true) throw new HttpsError('permission-denied', 'Administrator only');
  return uid;
}

export async function getEntitlement(uid: string): Promise<EntitlementDoc | null> {
  const snap = await db.doc(`entitlements/${uid}`).get();
  return snap.exists ? (snap.data() as EntitlementDoc) : null;
}

export async function requirePro(uid: string): Promise<void> {
  // Launch mode (no payments yet): mirrors openAccess() in firestore.rules.
  if (process.env.OPEN_ACCESS === 'true') return;
  if (!isPro(await getEntitlement(uid))) throw new HttpsError('failed-precondition', 'Σ Pro required');
}

/**
 * Fixed-window rate limit stored in Firestore (rateLimits/{key}); protects
 * provider quotas and the IMAP connector against abuse.
 */
export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<void> {
  const ref = db.doc(`rateLimits/${key.replace(/[^\w:-]/g, '_')}`);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as { windowStart: number; count: number } | undefined;
    if (!data || now - data.windowStart > windowSeconds * 1000) {
      tx.set(ref, { windowStart: now, count: 1, expiresAt: Timestamp.fromMillis(now + windowSeconds * 2000) });
      return;
    }
    if (data.count >= max) throw new HttpsError('resource-exhausted', 'Rate limit exceeded');
    tx.update(ref, { count: FieldValue.increment(1) });
  });
}

export async function audit(uid: string, action: string, detail: Record<string, unknown> = {}): Promise<void> {
  await db.collection('auditLog').add({ uid, action, detail, at: FieldValue.serverTimestamp() });
}
