/**
 * Server-side OAuth 2.0 for providers that require a client secret.
 * Every flow uses an unguessable one-time `state` bound to the Firebase user,
 * PKCE where the provider supports it, and a return URL restricted to an
 * allow-list of app origins (no open redirect).
 */
export type SocialProviderId = 'linkedin' | 'x' | 'tiktok';

export interface ProviderSpec {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  scopeSeparator: string;
  pkce: boolean;
  clientIdParam: string;
  /** How the client secret is sent to the token endpoint. */
  tokenAuth: 'body' | 'basic';
}

export const PROVIDERS: Record<SocialProviderId, ProviderSpec> = {
  linkedin: {
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['openid', 'profile', 'email'],
    scopeSeparator: ' ',
    pkce: false,
    clientIdParam: 'client_id',
    tokenAuth: 'body',
  },
  x: {
    authorizeUrl: 'https://x.com/i/oauth2/authorize',
    tokenUrl: 'https://api.x.com/2/oauth2/token',
    scopes: ['tweet.read', 'users.read', 'offline.access'],
    scopeSeparator: ' ',
    pkce: true,
    clientIdParam: 'client_id',
    tokenAuth: 'basic',
  },
  tiktok: {
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopes: ['user.info.basic', 'video.list'],
    scopeSeparator: ',',
    pkce: true,
    clientIdParam: 'client_key',
    tokenAuth: 'body',
  },
};

export function isSocialProvider(v: unknown): v is SocialProviderId {
  return v === 'linkedin' || v === 'x' || v === 'tiktok';
}

export function buildAuthorizeUrl(p: SocialProviderId, clientId: string, redirectUri: string, state: string, challenge?: string): string {
  const spec = PROVIDERS[p];
  const url = new URL(spec.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set(spec.clientIdParam, clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', spec.scopes.join(spec.scopeSeparator));
  if (spec.pkce && challenge) {
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

/**
 * Accepts only https URLs whose origin is in the allow-list (plus localhost for
 * development). Anything else falls back to the default app URL.
 */
export function safeReturnUrl(candidate: unknown, allowedOrigins: string[], fallback: string): string {
  if (typeof candidate !== 'string' || candidate.length > 500) return fallback;
  try {
    const u = new URL(candidate);
    const local = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    if ((u.protocol === 'https:' || local) && allowedOrigins.includes(u.origin)) return u.toString();
  } catch {
    /* invalid URL */
  }
  return fallback;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scope: string | null;
}

export async function exchangeToken(
  p: SocialProviderId,
  params: Record<string, string>,
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenSet> {
  const spec = PROVIDERS[p];
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (spec.tokenAuth === 'basic') {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    body.set('client_id', clientId);
  } else {
    body.set(spec.clientIdParam, clientId);
    body.set('client_secret', clientSecret);
  }
  const res = await fetchImpl(spec.tokenUrl, { method: 'POST', headers, body });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const token = (json.access_token ?? (json.data as Record<string, unknown> | undefined)?.access_token) as string | undefined;
  if (!res.ok || !token) {
    const detail = String(json.error_description ?? json.error ?? res.status).slice(0, 200);
    throw new Error(`token-exchange-failed: ${detail}`);
  }
  const expiresIn = Number(json.expires_in ?? 0);
  return {
    accessToken: token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
    scope: typeof json.scope === 'string' ? json.scope : null,
  };
}
