#!/usr/bin/env node
/**
 * Σ Local AI gateway — optional, self-hosted rephrasing via Ollama.
 *
 * POST /v1/rewrite { text, locale, tone } → { text }
 * GET  /health                          → { ok, model }
 *
 * Privacy: binds to 127.0.0.1 by default, forwards only to the local Ollama
 * daemon, keeps no logs of content, and rejects any output that drops or
 * changes a number from the input (the app applies the same check).
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT ?? 8790);
const HOST = process.env.HOST ?? '127.0.0.1';
const OLLAMA_URL = (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_BODY = 20_000;
const RATE = { capacity: 30, refillPerSec: 0.5 };
const LANGS = { fr: 'French', en: 'English', de: 'German', es: 'Spanish' };

export const numbersIn = (t) => (t.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));
export function preservesFacts(source, candidate) {
  if (!candidate.trim() || candidate.length > source.length * 2.5 + 200) return false;
  const have = new Set(numbersIn(candidate));
  return numbersIn(source).every((n) => have.has(n));
}

const buckets = new Map();
export function allow(ip, now = Date.now()) {
  const b = buckets.get(ip) ?? { tokens: RATE.capacity, at: now };
  b.tokens = Math.min(RATE.capacity, b.tokens + ((now - b.at) / 1000) * RATE.refillPerSec);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
}

function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin && ALLOWED.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  res.writeHead(status, headers);
  res.end(body === null ? '' : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function rewrite({ text, locale, tone }) {
  const prompt = `Rewrite the following coaching note in ${LANGS[locale] ?? 'French'} with a ${tone} tone. Keep every fact, name, date and number exactly. Do not add advice, facts or numbers. Output only the rewritten note.\n\n---\n${text}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const r = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt, stream: false, options: { temperature: 0.2 } }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw Object.assign(new Error('ollama error'), { status: 502 });
    const data = await r.json();
    return String(data.response ?? '').trim();
  } finally {
    clearTimeout(timer);
  }
}

export const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED.includes(origin)) return send(res, 403, { error: 'origin not allowed' });
  if (req.method === 'OPTIONS') return send(res, 204, null, origin);
  if (req.method === 'GET' && req.url === '/health')
    return send(res, 200, { ok: true, model: MODEL }, origin);
  if (req.method !== 'POST' || req.url !== '/v1/rewrite')
    return send(res, 404, { error: 'not found' }, origin);
  if (!allow(req.socket.remoteAddress ?? 'unknown')) return send(res, 429, { error: 'rate limited' }, origin);
  try {
    const body = await readJson(req);
    if (typeof body.text !== 'string' || !body.text.trim())
      return send(res, 400, { error: 'text required' }, origin);
    const locale = ['fr', 'en', 'de', 'es'].includes(body.locale) ? body.locale : 'fr';
    const tone = ['direct', 'balanced', 'gentle'].includes(body.tone) ? body.tone : 'balanced';
    const out = await rewrite({ text: body.text.slice(0, 8000), locale, tone });
    if (!preservesFacts(body.text, out)) return send(res, 422, { error: 'rewrite changed facts' }, origin);
    return send(res, 200, { text: out }, origin);
  } catch (err) {
    return send(res, err.status ?? 500, { error: err.status ? err.message : 'internal error' }, origin);
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, HOST, () =>
    console.log(`Σ local AI gateway on http://${HOST}:${PORT} → ${OLLAMA_URL} (${MODEL})`),
  );
}
