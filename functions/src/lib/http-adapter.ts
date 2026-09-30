/**
 * Runs the Cloud Functions handlers on a plain HTTP host (Netlify Functions,
 * AWS-Lambda-style events) so the connector API can live on a free tier.
 *
 * - Callables keep the Firebase callable protocol ({ data } → { result } or
 *   { error: { status, message } }), so the web SDK's httpsCallable works
 *   unchanged against a custom domain.
 * - The Firebase ID token is verified here and exposed as `req.auth`.
 * - CORS is restricted to the configured app origins.
 */
import { HttpsError } from 'firebase-functions/v2/https';

export interface LambdaEvent {
  httpMethod: string;
  path: string;
  rawUrl?: string;
  headers: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined> | null;
  body: string | null;
  isBase64Encoded?: boolean;
}

export interface LambdaResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface VerifiedToken {
  uid: string;
  [claim: string]: unknown;
}

interface CallableInput {
  data: unknown;
  auth?: { uid: string; token: VerifiedToken; rawToken: string };
  rawRequest: unknown;
  acceptsStreaming: boolean;
}

/** Method syntax on purpose: firebase-functions' CallableRequest is a subtype of CallableInput. */
export interface Callable {
  run(req: CallableInput): unknown;
}

// Express-like surface used by the onRequest handlers.
interface ShimRes {
  status(code: number): ShimRes;
  set(key: string, value: string): ShimRes;
  setHeader(key: string, value: string): ShimRes;
  send(body?: unknown): void;
  end(body?: unknown): void;
  redirect(codeOrUrl: number | string, url?: string): void;
  on(event: string, cb: () => void): void;
}
/** Express-typed onRequest handlers are accepted; they receive the shims below. */
export type RequestHandler = (req: never, res: never) => unknown;
type ShimHandler = (req: unknown, res: ShimRes) => unknown;

export interface AdapterOptions {
  callables: Record<string, Callable>;
  requests?: Record<string, RequestHandler>;
  verifyIdToken(token: string): Promise<VerifiedToken>;
  allowedOrigins(): string[];
  log?(message: string, detail?: Record<string, unknown>): void;
}

const CORS_HEADERS =
  'authorization, content-type, x-firebase-appcheck, firebase-instance-id-token, x-firebase-gmpid, x-firebase-client, x-client-version';

/** Route name after /api/ (or the direct /.netlify/functions/api/ path). */
export function routeName(event: LambdaEvent): string {
  const path = event.rawUrl ? new URL(event.rawUrl).pathname : event.path;
  const m = /\/(?:\.netlify\/functions\/)?api\/(.+?)\/?$/.exec(path);
  return m?.[1] ?? '';
}

function header(event: LambdaEvent, name: string): string {
  const key = Object.keys(event.headers).find((k) => k.toLowerCase() === name);
  return (key && event.headers[key]) || '';
}

function json(statusCode: number, body: unknown, headers: Record<string, string>): LambdaResult {
  return { statusCode, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function runRequest(handler: RequestHandler, event: LambdaEvent): Promise<LambdaResult> {
  return new Promise((resolve) => {
    let statusCode = 200;
    const headers: Record<string, string> = { 'cache-control': 'no-store' };
    const finish = (body?: unknown) =>
      resolve({ statusCode, headers, body: body === undefined || body === null ? '' : String(body) });
    const res: ShimRes = {
      status(code) {
        statusCode = code;
        return res;
      },
      set(k, v) {
        headers[k.toLowerCase()] = v;
        return res;
      },
      setHeader(k, v) {
        return res.set(k, v);
      },
      send: finish,
      end: finish,
      redirect(codeOrUrl, url) {
        statusCode = typeof codeOrUrl === 'number' ? codeOrUrl : 302;
        headers.location = typeof codeOrUrl === 'number' ? (url ?? '/') : codeOrUrl;
        finish();
      },
      on() {
        /* no streaming events on this host */
      },
    };
    const query = Object.fromEntries(
      Object.entries(event.queryStringParameters ?? {}).filter((e): e is [string, string] => e[1] !== undefined),
    );
    const req = {
      method: event.httpMethod,
      query,
      headers: Object.fromEntries(Object.entries(event.headers).map(([k, v]) => [k.toLowerCase(), v])),
      body: event.body,
      url: event.path,
      header: (name: string) => header(event, name.toLowerCase()),
      get: (name: string) => header(event, name.toLowerCase()),
    };
    Promise.resolve((handler as ShimHandler)(req, res)).catch(() => {
      statusCode = 500;
      finish('Internal error');
    });
  });
}

export function createHandler(opts: AdapterOptions) {
  return async (event: LambdaEvent): Promise<LambdaResult> => {
    const name = routeName(event);
    if (name === 'health') return json(200, { ok: true }, {});

    const request = opts.requests?.[name];
    if (request) return runRequest(request, event);

    const origin = header(event, 'origin');
    const cors: Record<string, string> = { vary: 'Origin' };
    if (origin && opts.allowedOrigins().includes(origin)) {
      cors['access-control-allow-origin'] = origin;
      cors['access-control-allow-headers'] = CORS_HEADERS;
      cors['access-control-allow-methods'] = 'POST, OPTIONS';
      cors['access-control-max-age'] = '3600';
    } else if (origin) {
      return json(403, { error: { status: 'PERMISSION_DENIED', message: 'Origin not allowed' } }, cors);
    }

    const callable = opts.callables[name];
    if (!callable) return json(404, { error: { status: 'NOT_FOUND', message: 'Unknown function' } }, cors);
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
    if (event.httpMethod !== 'POST')
      return json(405, { error: { status: 'INVALID_ARGUMENT', message: 'POST required' } }, cors);

    let data: unknown = null;
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body;
      data = raw ? (JSON.parse(raw) as { data?: unknown }).data ?? null : null;
    } catch {
      return json(400, { error: { status: 'INVALID_ARGUMENT', message: 'Malformed JSON' } }, cors);
    }

    let auth: { uid: string; token: VerifiedToken; rawToken: string } | undefined;
    const bearer = /^Bearer\s+(.+)$/i.exec(header(event, 'authorization'));
    const rawToken = bearer?.[1];
    if (rawToken) {
      try {
        const token = await opts.verifyIdToken(rawToken);
        auth = { uid: token.uid, token, rawToken };
      } catch {
        return json(401, { error: { status: 'UNAUTHENTICATED', message: 'Invalid ID token' } }, cors);
      }
    }

    try {
      const result = await callable.run({ data, auth, rawRequest: { headers: event.headers }, acceptsStreaming: false });
      return json(200, { result: result ?? null }, cors);
    } catch (err) {
      if (err instanceof HttpsError) return json(err.httpErrorCode.status, { error: err.toJSON() }, cors);
      opts.log?.('callable failed', { name, error: (err as Error).message });
      return json(500, { error: { status: 'INTERNAL', message: 'INTERNAL' } }, cors);
    }
  };
}
