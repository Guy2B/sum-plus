import { onRequest } from 'firebase-functions/v2/https';
import { verifyHmacSha256 } from '../lib/crypto';
import { HANDLED_EVENTS, isNewer, parseLemonEvent, toEntitlement } from '../lib/lemonsqueezy';
import {
  LEMONSQUEEZY_WEBHOOK_SECRET,
  REGION,
  Timestamp,
  FieldValue,
  audit,
  auth,
  db,
  logger,
} from '../lib/runtime';

/**
 * Lemon Squeezy webhook → entitlements/{uid}. The signature is verified on
 * the raw body; the Firebase UID comes from checkout custom data set by the
 * app. This is the only code path that can grant Pro to a customer.
 */
export const lemonSqueezyWebhook = onRequest(
  {
    region: REGION,
    secrets: [LEMONSQUEEZY_WEBHOOK_SECRET],
    maxInstances: 10,
    memory: '256MiB',
    invoker: 'public',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }
    const signature = String(req.get('X-Signature') ?? '');
    if (!verifyHmacSha256(req.rawBody, signature, LEMONSQUEEZY_WEBHOOK_SECRET.value())) {
      logger.warn('lemonsqueezy: invalid signature');
      res.status(401).send('Invalid signature');
      return;
    }
    const event = parseLemonEvent(req.body);
    if (!event) {
      res.status(400).send('Malformed payload');
      return;
    }
    if (!HANDLED_EVENTS.has(event.meta.event_name)) {
      res.status(200).send('Ignored');
      return;
    }
    let uid = event.meta.custom_data?.uid ?? '';
    if (!uid || !/^[A-Za-z0-9_-]{6,128}$/.test(uid)) {
      logger.error('lemonsqueezy: missing uid in custom data', { subscription: event.data.id });
      // 200 so the provider stops retrying; the case is visible in logs for support.
      res.status(200).send('No uid');
      return;
    }
    try {
      await auth.getUser(uid);
    } catch {
      logger.error('lemonsqueezy: unknown uid', { subscription: event.data.id });
      uid = '';
    }
    if (!uid) {
      res.status(200).send('Unknown user');
      return;
    }

    const next = toEntitlement(event);
    const ref = db.doc(`entitlements/${uid}`);
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as
        { providerUpdatedAt?: string | null; source?: string } | undefined;
      // Manual (admin) grants are not overwritten by an unrelated subscription expiring.
      if (current?.source === 'admin' && next.plan === 'free') return;
      if (!isNewer(next.providerUpdatedAt, current?.providerUpdatedAt)) return;
      tx.set(ref, {
        ...next,
        validUntilTs: next.validUntil ? Timestamp.fromDate(new Date(next.validUntil)) : null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await audit(uid, `billing.${event.meta.event_name}`, {
      status: next.status,
      subscription: event.data.id,
      testMode: Boolean(event.data.attributes.test_mode),
    });
    res.status(200).send('OK');
  },
);
