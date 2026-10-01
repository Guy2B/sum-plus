import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { auth as authV1 } from 'firebase-functions/v1';
import { z } from 'zod';
import { auth, audit, callableDefaults, db, logger, requireAuth } from '../lib/runtime';
import { scrubForLog } from '../lib/scrub';

/** Deletes everything Σ stores for a user. Idempotent. */
export async function purgeUser(uid: string): Promise<void> {
  await db.recursiveDelete(db.doc(`users/${uid}`));
  await db.recursiveDelete(db.doc(`private/${uid}`));
  const states = await db.collection('oauthStates').where('uid', '==', uid).get();
  await Promise.all(states.docs.map((d) => d.ref.delete()));
  // The entitlement is removed; billing records remain with the payment provider (legal retention).
  await db.doc(`entitlements/${uid}`).delete();
  await db.doc(`founders/${uid}`).delete();
}

/** GDPR art. 17: erase account, synced data, connector credentials and the auth user. */
export const deleteMyAccount = onCall({ ...callableDefaults, timeoutSeconds: 300 }, async (req) => {
  const uid = requireAuth(req);
  await purgeUser(uid);
  await audit(uid, 'account.deleted');
  await auth.deleteUser(uid).catch((err: { code?: string }) => {
    if (err.code !== 'auth/user-not-found') throw err;
  });
  logger.info('account deleted', { uid });
  return { deleted: true as const };
});

/** Safety net when a user is deleted from the console or by an admin. */
export const onAuthUserDeleted = authV1.user().onDelete(async (user) => {
  await purgeUser(user.uid);
});

/** GDPR art. 15/20: a portable copy of everything stored server-side for the user. */
export const exportMyData = onCall(
  { ...callableDefaults, timeoutSeconds: 120, memory: '512MiB' },
  async (req) => {
    const uid = requireAuth(req);
    const userRef = db.doc(`users/${uid}`);
    const collections = await userRef.listCollections();
    const out: Record<string, unknown[]> = {};
    let total = 0;
    for (const col of collections) {
      const snap = await col.get();
      total += snap.size;
      if (total > 50_000) throw new HttpsError('resource-exhausted', 'Export too large; contact support');
      out[col.id] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
    const ent = await db.doc(`entitlements/${uid}`).get();
    const connectors = await db.collection(`private/${uid}/connectors`).get();
    const record = await auth.getUser(uid);
    return {
      format: 'sigma-life-os-cloud-export',
      exportedAt: new Date().toISOString(),
      account: {
        uid,
        email: record.email ?? null,
        displayName: record.displayName ?? null,
        createdAt: record.metadata.creationTime,
        providers: record.providerData.map((p) => p.providerId),
      },
      entitlement: ent.exists ? ent.data() : null,
      // Credentials are never exported, only which connectors exist.
      connectors: connectors.docs.map((d) => ({ id: d.id, kind: d.get('kind'), label: d.get('label') })),
      collections: out,
    };
  },
);

const ErrorReport = z.object({
  message: z.string().max(4000),
  stack: z.string().max(4000).nullish(),
  where: z.string().max(200).nullish(),
  version: z.string().max(40).nullish(),
  url: z.string().max(500).nullish(),
  ua: z.string().max(300).nullish(),
});

/** Client error sink → Cloud Logging (alerting policies are defined on these entries). */
export const reportClientError = onCall({ ...callableDefaults, maxInstances: 5 }, async (req) => {
  const parsed = ErrorReport.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid report');
  const r = parsed.data;
  logger.error('client-error', {
    message: scrubForLog(r.message),
    stack: scrubForLog(r.stack ?? ''),
    where: r.where,
    version: r.version,
    url: scrubForLog(r.url ?? ''),
    ua: r.ua,
    uid: req.auth?.uid ?? null,
  });
  return { ok: true };
});
