import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { open, pkceChallenge, randomToken, seal, type Sealed } from '../lib/crypto';
import {
  buildAuthorizeUrl,
  exchangeToken,
  isSocialProvider,
  safeReturnUrl,
  type SocialProviderId,
  type TokenSet,
} from '../lib/oauth';
import {
  CONNECTOR_ENCRYPTION_KEY,
  LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET,
  PUBLIC_APP_URL,
  REGION,
  TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET,
  Timestamp,
  X_CLIENT_ID,
  X_CLIENT_SECRET,
  FieldValue,
  allowedOrigins,
  audit,
  callableDefaults,
  db,
  logger,
  oauthRedirectUri,
  rateLimit,
  requireAuth,
  requirePro,
} from '../lib/runtime';

const SOCIAL_SECRETS = [
  CONNECTOR_ENCRYPTION_KEY,
  LINKEDIN_CLIENT_SECRET,
  X_CLIENT_SECRET,
  TIKTOK_CLIENT_SECRET,
];

function credentials(p: SocialProviderId): { id: string; secret: string } {
  const map = {
    linkedin: [LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET],
    x: [X_CLIENT_ID, X_CLIENT_SECRET],
    tiktok: [TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET],
  } as const;
  const [id, secret] = map[p];
  const value = { id: id.value(), secret: secret.value() };
  if (!value.id || !value.secret) throw new HttpsError('failed-precondition', `${p} is not configured`);
  return value;
}

interface StoredToken {
  kind: 'social';
  provider: SocialProviderId;
  label: string;
  token: Sealed;
  createdAt: unknown;
}

const tokenPath = (uid: string, p: SocialProviderId) => `private/${uid}/connectors/social_${p}`;

/* ------------------------------ start / callback ------------------------------ */

const StartInput = z.object({ provider: z.string(), returnUrl: z.string().max(500).optional() });

export const socialStartAuth = onCall({ ...callableDefaults, secrets: SOCIAL_SECRETS }, async (req) => {
  const uid = requireAuth(req);
  await requirePro(uid);
  await rateLimit(`socialStart:${uid}`, 20, 3600);
  const parsed = StartInput.safeParse(req.data);
  if (!parsed.success || !isSocialProvider(parsed.data.provider))
    throw new HttpsError('invalid-argument', 'Unsupported provider');
  const provider = parsed.data.provider;
  const { id } = credentials(provider);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const returnUrl = safeReturnUrl(
    parsed.data.returnUrl,
    allowedOrigins(),
    `${PUBLIC_APP_URL.value()}/app.html#sources`,
  );
  await db.doc(`oauthStates/${state}`).set({
    uid,
    provider,
    verifier,
    returnUrl,
    expiresAt: Timestamp.fromMillis(Date.now() + 15 * 60_000),
  });
  return { authUrl: buildAuthorizeUrl(provider, id, oauthRedirectUri(), state, pkceChallenge(verifier)) };
});

function redirectWith(
  res: { redirect(code: number, url: string): void },
  target: string,
  status: 'connected' | 'error',
  provider: string,
) {
  const u = new URL(target);
  u.searchParams.set('sigmaSocial', status);
  u.searchParams.set('provider', provider);
  res.redirect(302, u.toString());
}

/** Single OAuth callback for all providers, exposed at /api/oauth/callback via Hosting. */
export const socialOAuthCallback = onRequest(
  { region: REGION, secrets: SOCIAL_SECRETS, maxInstances: 10, invoker: 'public' },
  async (req, res) => {
    const fallback = `${PUBLIC_APP_URL.value()}/app.html#sources`;
    const state = String(req.query.state ?? '');
    const code = String(req.query.code ?? '');
    if (!/^[\w-]{20,64}$/.test(state)) {
      res.status(400).send('Invalid state');
      return;
    }
    const ref = db.doc(`oauthStates/${state}`);
    const snap = await ref.get();
    // One-time use regardless of outcome.
    await ref.delete().catch(() => undefined);
    const s = snap.data() as
      | { uid: string; provider: SocialProviderId; verifier: string; returnUrl: string; expiresAt: Timestamp }
      | undefined;
    if (!s || s.expiresAt.toMillis() < Date.now()) {
      res.redirect(302, fallback);
      return;
    }
    if (!code || req.query.error) {
      redirectWith(res, s.returnUrl, 'error', s.provider);
      return;
    }
    try {
      const { id, secret } = credentials(s.provider);
      const params: Record<string, string> = {
        grant_type: 'authorization_code',
        code,
        redirect_uri: oauthRedirectUri(),
      };
      if (s.provider !== 'linkedin') params.code_verifier = s.verifier;
      const tokens = await exchangeToken(s.provider, params, id, secret);
      const label = await fetchHandle(s.provider, tokens.accessToken).catch(() => s.provider);
      const stored: StoredToken = {
        kind: 'social',
        provider: s.provider,
        label,
        token: seal(
          JSON.stringify(tokens),
          CONNECTOR_ENCRYPTION_KEY.value(),
          `${s.uid}:social_${s.provider}`,
        ),
        createdAt: FieldValue.serverTimestamp(),
      };
      await db.doc(tokenPath(s.uid, s.provider)).set(stored);
      await audit(s.uid, 'connector.social.connected', { provider: s.provider });
      redirectWith(res, s.returnUrl, 'connected', s.provider);
    } catch (err) {
      logger.warn('oauth callback failed', {
        provider: s.provider,
        message: (err as Error).message.slice(0, 200),
      });
      redirectWith(res, s.returnUrl, 'error', s.provider);
    }
  },
);

/* ---------------------------------- sync ----------------------------------- */

interface Item {
  externalId: string;
  kind: 'comment' | 'mention' | 'message' | 'post' | 'video';
  author: string;
  text: string;
  url?: string;
  publishedAt: string;
  needsReply: boolean;
  metrics?: Record<string, number>;
}

async function api<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.headers ?? {}) },
  });
  if (res.status === 401) throw Object.assign(new Error('unauthorized'), { status: 401 });
  if (res.status === 403) throw Object.assign(new Error('forbidden'), { status: 403 });
  if (res.status === 429) throw new HttpsError('resource-exhausted', 'Provider rate limit');
  if (!res.ok) throw new Error(`provider-http-${res.status}`);
  return (await res.json()) as T;
}

async function fetchHandle(p: SocialProviderId, token: string): Promise<string> {
  if (p === 'linkedin') {
    const me = await api<{ name?: string; email?: string }>('https://api.linkedin.com/v2/userinfo', token);
    return me.name ?? me.email ?? 'LinkedIn';
  }
  if (p === 'x') {
    const me = await api<{ data: { username: string } }>('https://api.x.com/2/users/me', token);
    return `@${me.data.username}`;
  }
  const me = await api<{ data: { user: { display_name?: string; username?: string } } }>(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username',
    token,
  );
  return me.data.user.username ? `@${me.data.user.username}` : (me.data.user.display_name ?? 'TikTok');
}

async function fetchItems(
  p: SocialProviderId,
  token: string,
): Promise<{ capabilities: string[]; items: Item[] }> {
  if (p === 'linkedin') {
    // OpenID Connect grants profile access only; post/comment access requires LinkedIn partner approval.
    return { capabilities: ['profile'], items: [] };
  }
  if (p === 'x') {
    const me = await api<{ data: { id: string } }>('https://api.x.com/2/users/me', token);
    try {
      const mentions = await api<{
        data?: { id: string; text: string; created_at: string; author_id: string }[];
        includes?: { users?: { id: string; username: string; name: string }[] };
      }>(
        `https://api.x.com/2/users/${me.data.id}/mentions?max_results=20&tweet.fields=created_at,author_id&expansions=author_id&user.fields=username,name`,
        token,
      );
      const users = new Map((mentions.includes?.users ?? []).map((u) => [u.id, u]));
      return {
        capabilities: ['profile', 'mentions'],
        items: (mentions.data ?? []).map((t) => ({
          externalId: t.id,
          kind: 'mention',
          author: users.get(t.author_id)?.name ?? users.get(t.author_id)?.username ?? t.author_id,
          text: t.text.slice(0, 2000),
          url: `https://x.com/${users.get(t.author_id)?.username ?? 'i'}/status/${t.id}`,
          publishedAt: t.created_at,
          needsReply: true,
        })),
      };
    } catch (err) {
      // Mentions need a paid API tier; report capability honestly instead of failing.
      if ((err as { status?: number }).status === 403) return { capabilities: ['profile'], items: [] };
      throw err;
    }
  }
  const videos = await api<{
    data?: {
      videos?: {
        id: string;
        title?: string;
        create_time: number;
        share_url?: string;
        comment_count?: number;
        like_count?: number;
      }[];
    };
  }>(
    'https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,share_url,comment_count,like_count',
    token,
    {
      method: 'POST',
      body: JSON.stringify({ max_count: 20 }),
      headers: { 'Content-Type': 'application/json' },
    },
  );
  return {
    capabilities: ['profile', 'videos'],
    items: (videos.data?.videos ?? []).map((v) => ({
      externalId: v.id,
      kind: 'video',
      author: 'TikTok',
      text: (v.title ?? '').slice(0, 2000),
      url: v.share_url,
      publishedAt: new Date(v.create_time * 1000).toISOString(),
      // Comment content is not available through the public API; only counts.
      needsReply: false,
      metrics: { comments: v.comment_count ?? 0, likes: v.like_count ?? 0 },
    })),
  };
}

async function freshToken(uid: string, p: SocialProviderId, stored: StoredToken): Promise<TokenSet> {
  const aad = `${uid}:social_${p}`;
  const tokens = JSON.parse(open(stored.token, CONNECTOR_ENCRYPTION_KEY.value(), aad)) as TokenSet;
  if (!tokens.expiresAt || tokens.expiresAt > Date.now() + 60_000 || !tokens.refreshToken) return tokens;
  const { id, secret } = credentials(p);
  const next = await exchangeToken(
    p,
    { grant_type: 'refresh_token', refresh_token: tokens.refreshToken },
    id,
    secret,
  );
  const merged = { ...next, refreshToken: next.refreshToken ?? tokens.refreshToken };
  await db
    .doc(tokenPath(uid, p))
    .update({ token: seal(JSON.stringify(merged), CONNECTOR_ENCRYPTION_KEY.value(), aad) });
  return merged;
}

const ProviderInput = z.object({ provider: z.string() });

export const socialSync = onCall(
  { ...callableDefaults, secrets: SOCIAL_SECRETS, timeoutSeconds: 90 },
  async (req) => {
    const uid = requireAuth(req);
    await requirePro(uid);
    const parsed = ProviderInput.safeParse(req.data);
    if (!parsed.success || !isSocialProvider(parsed.data.provider))
      throw new HttpsError('invalid-argument', 'Unsupported provider');
    const p = parsed.data.provider;
    await rateLimit(`socialSync:${uid}:${p}`, 30, 3600);
    const snap = await db.doc(tokenPath(uid, p)).get();
    if (!snap.exists) throw new HttpsError('failed-precondition', 'Provider not connected');
    const stored = snap.data() as StoredToken;
    try {
      const tokens = await freshToken(uid, p, stored);
      const { capabilities, items } = await fetchItems(p, tokens.accessToken);
      return { handle: stored.label, capabilities, items };
    } catch (err) {
      if ((err as { status?: number }).status === 401) throw new HttpsError('unauthenticated', 'expired');
      if (err instanceof HttpsError) throw err;
      logger.warn('social sync failed', { provider: p, message: (err as Error).message.slice(0, 200) });
      throw new HttpsError('unavailable', 'Provider unavailable');
    }
  },
);

export const socialDisconnect = onCall(callableDefaults, async (req) => {
  const uid = requireAuth(req);
  const parsed = ProviderInput.safeParse(req.data);
  if (!parsed.success || !isSocialProvider(parsed.data.provider))
    throw new HttpsError('invalid-argument', 'Unsupported provider');
  await db.doc(tokenPath(uid, parsed.data.provider)).delete();
  await audit(uid, 'connector.social.disconnected', { provider: parsed.data.provider });
  return { ok: true };
});
