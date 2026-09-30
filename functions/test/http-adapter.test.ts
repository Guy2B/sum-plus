import { describe, expect, it } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import { createHandler, routeName, type LambdaEvent } from '../src/lib/http-adapter';

const ORIGIN = 'https://guy2b.github.io';

function event(over: Partial<LambdaEvent> = {}): LambdaEvent {
  return {
    httpMethod: 'POST',
    path: '/api/echo',
    headers: { origin: ORIGIN, authorization: 'Bearer good', 'content-type': 'application/json' },
    body: JSON.stringify({ data: { x: 1 } }),
    ...over,
  };
}

const handler = createHandler({
  callables: {
    echo: { run: (req) => ({ data: req.data, uid: req.auth?.uid ?? null }) },
    fails: {
      run: () => {
        throw new HttpsError('permission-denied', 'nope');
      },
    },
    crashes: {
      run: () => {
        throw new Error('secret detail');
      },
    },
  },
  requests: {
    'oauth/callback': ((req: { query: Record<string, string> }, res: { redirect(c: number, u: string): void }) => {
      res.redirect(302, `https://app.example/#${req.query.state}`);
    }) as never,
  },
  verifyIdToken: async (t) => {
    if (t !== 'good') throw new Error('bad token');
    return { uid: 'alice' };
  },
  allowedOrigins: () => [ORIGIN],
});

describe('http adapter', () => {
  it('extracts route names from rewritten and direct paths', () => {
    expect(routeName(event({ path: '/api/imapSync' }))).toBe('imapSync');
    expect(routeName(event({ path: '/.netlify/functions/api/imapSync' }))).toBe('imapSync');
    expect(routeName(event({ path: '/x', rawUrl: 'https://h.netlify.app/api/oauth/callback?state=1' }))).toBe(
      'oauth/callback',
    );
  });

  it('speaks the callable protocol with the verified uid', async () => {
    const r = await handler(event());
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ result: { data: { x: 1 }, uid: 'alice' } });
    expect(r.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('answers CORS preflight only for allowed origins', async () => {
    const ok = await handler(event({ httpMethod: 'OPTIONS', body: null }));
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-headers']).toContain('authorization');
    const bad = await handler(event({ httpMethod: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
    expect(bad.statusCode).toBe(403);
  });

  it('rejects invalid tokens and maps HttpsError / unknown errors', async () => {
    expect((await handler(event({ headers: { origin: ORIGIN, authorization: 'Bearer bad' } }))).statusCode).toBe(401);
    const denied = await handler(event({ path: '/api/fails' }));
    expect(denied.statusCode).toBe(403);
    expect(JSON.parse(denied.body).error.status).toBe('PERMISSION_DENIED');
    const crash = await handler(event({ path: '/api/crashes' }));
    expect(crash.statusCode).toBe(500);
    expect(crash.body).not.toContain('secret detail');
    expect((await handler(event({ path: '/api/nope' }))).statusCode).toBe(404);
  });

  it('runs onRequest handlers (OAuth callback redirect)', async () => {
    const r = await handler(
      event({ httpMethod: 'GET', path: '/api/oauth/callback', queryStringParameters: { state: 'abc' }, body: null }),
    );
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('https://app.example/#abc');
  });
});
