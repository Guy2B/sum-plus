import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { ImapFlow } from 'imapflow';
import { z } from 'zod';
import { open, randomToken, seal, type Sealed } from '../lib/crypto';
import { snippetFromSource } from '../lib/mail-text';
import {
  CONNECTOR_ENCRYPTION_KEY,
  FieldValue,
  audit,
  callableDefaults,
  db,
  logger,
  rateLimit,
  requireAuth,
  requirePro,
} from '../lib/runtime';

const PRESETS = {
  yahoo: { host: 'imap.mail.yahoo.com', port: 993 },
  gmx: { host: 'imap.gmx.net', port: 993 },
  icloud: { host: 'imap.mail.me.com', port: 993 },
} as const;

// nullish, not optional: the Firebase callable SDK encodes `undefined` as `null`.
const ConnectInput = z.object({
  preset: z.enum(['yahoo', 'gmx', 'icloud', 'custom']),
  email: z.string().email().max(200),
  password: z.string().min(4).max(200),
  host: z
    .string()
    .max(200)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)
    .nullish(),
  port: z.number().int().min(1).max(65535).nullish(),
});

/** Blocks internal / link-local targets for custom hosts (SSRF protection). */
function assertPublicHost(host: string) {
  if (
    /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
  ) {
    throw new HttpsError('invalid-argument', 'Host not allowed');
  }
}

interface StoredImap {
  kind: 'imap';
  label: string;
  host: string;
  port: number;
  user: string;
  secret: Sealed;
  createdAt: unknown;
  lastSyncAt?: unknown;
}

function client(host: string, port: number, user: string, pass: string) {
  return new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user, pass },
    logger: false,
    socketTimeout: 30_000,
    greetingTimeout: 15_000,
    tls: { rejectUnauthorized: true },
  });
}

export const imapConnect = onCall(
  { ...callableDefaults, secrets: [CONNECTOR_ENCRYPTION_KEY], timeoutSeconds: 60 },
  async (req) => {
    const uid = requireAuth(req);
    await requirePro(uid);
    await rateLimit(`imapConnect:${uid}`, 10, 3600);
    const parsed = ConnectInput.safeParse(req.data);
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid input');
    const input = parsed.data;
    const target =
      input.preset === 'custom' ? { host: input.host ?? '', port: input.port ?? 993 } : PRESETS[input.preset];
    if (!target.host) throw new HttpsError('invalid-argument', 'Host required');
    assertPublicHost(target.host);

    const c = client(target.host, target.port, input.email, input.password);
    try {
      await c.connect();
      await c.logout();
    } catch (err) {
      logger.warn('imap login failed', { host: target.host, code: (err as { code?: string }).code });
      throw new HttpsError('permission-denied', 'IMAP login failed: check the app password');
    }

    const accountId = `imap_${randomToken(12)}`;
    const doc: StoredImap = {
      kind: 'imap',
      label: input.email,
      host: target.host,
      port: target.port,
      user: input.email,
      secret: seal(input.password, CONNECTOR_ENCRYPTION_KEY.value(), `${uid}:${accountId}`),
      createdAt: FieldValue.serverTimestamp(),
    };
    await db.doc(`private/${uid}/connectors/${accountId}`).set(doc);
    await audit(uid, 'connector.imap.connected', { host: target.host });
    return { accountId };
  },
);

const SyncInput = z.object({ accountId: z.string().regex(/^imap_[\w-]{8,40}$/) });

export const imapSync = onCall(
  { ...callableDefaults, secrets: [CONNECTOR_ENCRYPTION_KEY], timeoutSeconds: 120, memory: '512MiB' },
  async (req) => {
    const uid = requireAuth(req);
    await requirePro(uid);
    const parsed = SyncInput.safeParse(req.data);
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid input');
    await rateLimit(`imapSync:${uid}`, 60, 3600);
    const ref = db.doc(`private/${uid}/connectors/${parsed.data.accountId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Unknown account');
    const acc = snap.data() as StoredImap;
    const pass = open(acc.secret, CONNECTOR_ENCRYPTION_KEY.value(), `${uid}:${parsed.data.accountId}`);

    const c = client(acc.host, acc.port, acc.user, pass);
    const messages: {
      externalId: string;
      subject: string;
      sender: string;
      senderEmail: string;
      snippet: string;
      receivedAt: string;
      unread: boolean;
    }[] = [];
    try {
      await c.connect();
      const lock = await c.getMailboxLock('INBOX');
      try {
        const since = new Date(Date.now() - 21 * 86_400_000);
        const uids = ((await c.search({ since }, { uid: true })) || []).slice(-40);
        if (uids.length) {
          for await (const m of c.fetch(
            uids,
            {
              uid: true,
              envelope: true,
              flags: true,
              internalDate: true,
              source: { start: 0, maxLength: 6000 },
            },
            { uid: true },
          )) {
            const from = m.envelope?.from?.[0];
            messages.push({
              externalId: `${m.uid}`,
              subject: (m.envelope?.subject ?? '(—)').slice(0, 300),
              sender: (from?.name || from?.address || '').slice(0, 200),
              senderEmail: (from?.address ?? '').slice(0, 200),
              snippet: m.source ? snippetFromSource(m.source.toString('utf8')) : '',
              receivedAt: new Date(m.internalDate ?? m.envelope?.date ?? Date.now()).toISOString(),
              unread: !m.flags?.has('\\Seen'),
            });
          }
        }
      } finally {
        lock.release();
      }
      await c.logout();
    } catch (err) {
      logger.warn('imap sync failed', {
        code: (err as { code?: string }).code,
        authenticationFailed: (err as { authenticationFailed?: boolean }).authenticationFailed,
      });
      throw new HttpsError(
        (err as { authenticationFailed?: boolean }).authenticationFailed
          ? 'permission-denied'
          : 'unavailable',
        'IMAP sync failed',
      );
    }
    await ref.update({ lastSyncAt: FieldValue.serverTimestamp() });
    // Messages are returned to the device only; nothing is persisted server-side.
    return { messages: messages.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)) };
  },
);

export const imapDisconnect = onCall(callableDefaults, async (req) => {
  const uid = requireAuth(req);
  const parsed = SyncInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid input');
  await db.doc(`private/${uid}/connectors/${parsed.data.accountId}`).delete();
  await audit(uid, 'connector.imap.disconnected');
  return { ok: true };
});
