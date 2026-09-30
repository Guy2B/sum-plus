import { describe, expect, it } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { open, pkceChallenge, seal, verifyHmacSha256 } from '../src/lib/crypto';
import { isNewer, parseLemonEvent, toEntitlement } from '../src/lib/lemonsqueezy';
import { isPro } from '../src/lib/entitlements';
import { buildAuthorizeUrl, exchangeToken, safeReturnUrl } from '../src/lib/oauth';
import { decodeQuotedPrintable, snippetFromSource } from '../src/lib/mail-text';
import { scrubForLog } from '../src/lib/scrub';

const KEY = randomBytes(32).toString('base64');

describe('crypto', () => {
  it('round-trips with the right owner and fails with another', () => {
    const s = seal('app-password', KEY, 'uid1:imap_a');
    expect(open(s, KEY, 'uid1:imap_a')).toBe('app-password');
    expect(() => open(s, KEY, 'uid2:imap_a')).toThrow();
    expect(() =>
      open({ ...s, data: Buffer.from('tampered').toString('base64') }, KEY, 'uid1:imap_a'),
    ).toThrow();
  });

  it('rejects a key of the wrong size', () => {
    expect(() => seal('x', randomBytes(16).toString('base64'), 'a')).toThrow(/32 bytes/);
  });

  it('verifies HMAC signatures in constant time', () => {
    const body = Buffer.from('{"a":1}');
    const sig = createHmac('sha256', 'whsec').update(body).digest('hex');
    expect(verifyHmacSha256(body, sig, 'whsec')).toBe(true);
    expect(verifyHmacSha256(body, sig, 'other')).toBe(false);
    expect(verifyHmacSha256(body, 'zz', 'whsec')).toBe(false);
    expect(verifyHmacSha256(Buffer.from('{"a":2}'), sig, 'whsec')).toBe(false);
  });

  it('computes RFC 7636 PKCE challenges', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('lemon squeezy', () => {
  const event = (status: string, extra: Record<string, unknown> = {}) => ({
    meta: { event_name: 'subscription_updated', custom_data: { uid: 'user_123' } },
    data: {
      id: 'sub_1',
      type: 'subscriptions',
      attributes: {
        status,
        renews_at: '2026-11-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        urls: { customer_portal: 'https://portal' },
        ...extra,
      },
    },
  });

  it('maps statuses to entitlements', () => {
    expect(toEntitlement(parseLemonEvent(event('active'))!)).toMatchObject({
      plan: 'pro',
      status: 'active',
      validUntil: '2026-11-01T00:00:00Z',
      customerPortalUrl: 'https://portal',
    });
    expect(toEntitlement(parseLemonEvent(event('expired'))!).plan).toBe('free');
    const cancelled = toEntitlement(
      parseLemonEvent(event('cancelled', { ends_at: '2026-10-15T00:00:00Z' }))!,
    );
    expect(cancelled).toMatchObject({ plan: 'pro', status: 'cancelled', validUntil: '2026-10-15T00:00:00Z' });
    expect(isPro(cancelled, new Date('2026-10-10'))).toBe(true);
    expect(isPro(cancelled, new Date('2026-10-20'))).toBe(false);
  });

  it('rejects malformed payloads and stale events', () => {
    expect(parseLemonEvent({ foo: 1 })).toBeNull();
    expect(isNewer('2026-01-01', '2026-02-01')).toBe(false);
    expect(isNewer('2026-03-01', '2026-02-01')).toBe(true);
    expect(isNewer('2026-03-01', null)).toBe(true);
  });
});

describe('oauth', () => {
  const allowed = ['https://sigma.example.com', 'http://localhost:5173'];
  it('only returns to allow-listed origins', () => {
    expect(safeReturnUrl('https://sigma.example.com/app.html#sources', allowed, 'fb')).toBe(
      'https://sigma.example.com/app.html#sources',
    );
    expect(safeReturnUrl('https://evil.example.com/', allowed, 'fb')).toBe('fb');
    expect(safeReturnUrl('javascript:alert(1)', allowed, 'fb')).toBe('fb');
    expect(safeReturnUrl('http://sigma.example.com/', allowed, 'fb')).toBe('fb');
    expect(safeReturnUrl('http://localhost:5173/app.html', allowed, 'fb')).toBe(
      'http://localhost:5173/app.html',
    );
  });

  it('builds PKCE authorize URLs with the provider parameter names', () => {
    const x = new URL(buildAuthorizeUrl('x', 'cid', 'https://a/cb', 'st', 'ch'));
    expect(x.searchParams.get('code_challenge_method')).toBe('S256');
    expect(x.searchParams.get('scope')).toBe('tweet.read users.read offline.access');
    const tt = new URL(buildAuthorizeUrl('tiktok', 'key', 'https://a/cb', 'st', 'ch'));
    expect(tt.searchParams.get('client_key')).toBe('key');
    expect(tt.searchParams.get('scope')).toBe('user.info.basic,video.list');
    const li = new URL(buildAuthorizeUrl('linkedin', 'cid', 'https://a/cb', 'st', 'ch'));
    expect(li.searchParams.has('code_challenge')).toBe(false);
  });

  it('exchanges tokens with basic auth for X and body secret for TikTok', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 7200 }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const t = await exchangeToken('x', { grant_type: 'authorization_code', code: 'c' }, 'cid', 'sec', fake);
    expect(t.accessToken).toBe('at');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    await exchangeToken('tiktok', { grant_type: 'authorization_code', code: 'c' }, 'key', 'sec', fake);
    expect(String(calls[1]!.init.body)).toContain('client_secret=sec');
    const failing = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as unknown as typeof fetch;
    await expect(exchangeToken('x', {}, 'a', 'b', failing)).rejects.toThrow(/invalid_grant/);
  });
});

describe('mail text', () => {
  it('extracts a plain-text snippet from multipart messages', () => {
    const raw = [
      'From: Alice <alice@example.com>',
      'Content-Type: multipart/alternative; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Bonjour, pouvez-vous confirmer le devis =C3=A0 500 =E2=82=AC ?',
      '> quoted line',
      '--b1',
      'Content-Type: text/html',
      '',
      '<p>ignored</p>',
      '--b1--',
    ].join('\r\n');
    expect(snippetFromSource(raw)).toBe('Bonjour, pouvez-vous confirmer le devis à 500 € ?');
  });

  it('strips HTML and decodes base64 bodies', () => {
    const html = [
      'Content-Type: text/html',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('<div>Hello <b>World</b><script>x()</script></div>').toString('base64'),
    ].join('\r\n');
    expect(snippetFromSource(html)).toBe('Hello World');
    expect(decodeQuotedPrintable('caf=C3=A9=\r\n au lait')).toBe('café au lait');
  });
});

describe('log scrubbing', () => {
  it('removes emails, tokens and OAuth codes', () => {
    const s = scrubForLog(
      'user guy@example.com token ya29.abcdefghijklmnop https://x/cb?code=SECRET&state=abc',
    );
    expect(s).not.toContain('guy@example.com');
    expect(s).not.toContain('ya29.abcdefghijklmnop');
    expect(s).not.toContain('SECRET');
  });
});
