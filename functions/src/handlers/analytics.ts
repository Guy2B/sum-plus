/**
 * Anonymous product analytics, computed on the free Netlify tier:
 *  - every 3 hours: the last 3 days of opt-in counters → analytics_daily/{day};
 *  - every morning: install-week retention → analytics_cohorts/{week}, purge of
 *    expired counters (13 months) and pulse answers (24 months), and a short
 *    digest pushed to the admin's phone (ntfy topic in NTFY_TOPIC);
 *  - /api/visit: cookie-less landing counter (no IP, nothing stored on the device).
 * Only aggregates leave this module; nothing here can identify a person.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp, callableDefaults, db, logger, requireAdmin } from '../lib/runtime';

const DAY = 86_400_000;
export const RETENTION_AGES = [1, 3, 7, 14, 30] as const;
const ENGINE_KEYS = ['p', 'a', 's', 'c', 'd', 'r', 'w', 'ov', 'lr'] as const;
const VISIT_KEYS = new Set(['landing', 'cta_demo', 'cta_mine']);
const LANGS = new Set(['fr', 'en', 'de', 'es']);

export interface TelemetryRow {
  e: string;
  day: string;
  cohort: string;
  age: number;
  lang?: string;
  src?: string;
  ai?: string;
  pf?: string;
  [k: string]: unknown;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const inc = (o: Record<string, number>, k: string, n = 1) => {
  o[k] = (o[k] ?? 0) + n;
};
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** One day of counters → its aggregate document (pure, tested). */
export function buildDaily(rows: TelemetryRow[]) {
  const events: Record<string, number> = {};
  const byLang: Record<string, Record<string, number>> = {};
  const bySrc: Record<string, Record<string, number>> = {};
  const ai: Record<string, number> = {};
  const pf: Record<string, number> = {};
  const engine: Record<string, number> = {};
  for (const r of rows) {
    inc(events, r.e);
    if (r.lang) inc((byLang[r.lang] ??= {}), r.e);
    inc((bySrc[r.src ?? 'direct'] ??= {}), r.e);
    if (r.e === 'app_open') {
      if (r.ai) inc(ai, r.ai);
      if (r.pf) inc(pf, r.pf);
    }
    if (r.e === 'daily_summary') {
      inc(engine, 'n');
      for (const k of ENGINE_KEYS) inc(engine, k, num(r[k]));
      if (num(r.ob) >= 5) inc(engine, 'ob5');
      if (num(r.ob) >= 20) inc(engine, 'ob20');
      if (typeof r.eb === 'number' && typeof r.ea === 'number') {
        inc(engine, 'ebSum', r.eb);
        inc(engine, 'eaSum', r.ea);
        inc(engine, 'ebN');
      }
      // Does Σ get better with use? First week vs. after a month.
      if (r.age <= 7) {
        inc(engine, 'earlyP', num(r.p));
        inc(engine, 'earlyA', num(r.a));
      } else if (r.age >= 30) {
        inc(engine, 'lateP', num(r.p));
        inc(engine, 'lateA', num(r.a));
      }
    }
  }
  return { events, byLang, bySrc, ai, pf, engine };
}

/** Installs per install week, and how many opened the app on day 1/3/7/14/30 (pure, tested). */
export function buildCohorts(installs: TelemetryRow[], opens: TelemetryRow[]) {
  const out: Record<string, Record<string, number>> = {};
  for (const r of installs) inc((out[r.cohort] ??= { installs: 0 }), 'installs');
  for (const r of opens)
    if ((RETENTION_AGES as readonly number[]).includes(r.age)) inc((out[r.cohort] ??= { installs: 0 }), `d${r.age}`);
  return out;
}

async function rowsSince(since: string, e?: string): Promise<TelemetryRow[]> {
  let q = db.collection('telemetry').where('day', '>=', since);
  if (e) q = db.collection('telemetry').where('e', '==', e).where('day', '>=', since);
  const snap = await q.get();
  return snap.docs.map((d) => d.data() as TelemetryRow);
}

/** Recomputes the last `back` days from the raw counters (idempotent; keeps visit counters). */
export async function aggregateDays(now = new Date(), back = 3): Promise<number> {
  const since = isoDay(new Date(now.getTime() - (back - 1) * DAY));
  const rows = await rowsSince(since);
  const byDay = new Map<string, TelemetryRow[]>();
  for (let i = 0; i < back; i++) byDay.set(isoDay(new Date(now.getTime() - i * DAY)), []);
  for (const r of rows) byDay.get(r.day)?.push(r);
  const batch = db.batch();
  for (const [day, list] of byDay)
    batch.set(
      db.collection('analytics_daily').doc(day),
      { day, ...buildDaily(list), updatedAt: FieldValue.serverTimestamp() },
      // Replace the computed maps entirely, but never touch visits/visitsLang.
      { mergeFields: ['day', 'events', 'byLang', 'bySrc', 'ai', 'pf', 'engine', 'updatedAt'] },
    );
  await batch.commit();
  return byDay.size;
}

/** Install-week retention over the last 120 days. */
export async function aggregateCohorts(now = new Date()): Promise<number> {
  const since = isoDay(new Date(now.getTime() - 120 * DAY));
  const [installs, opens] = await Promise.all([rowsSince(since, 'onboarding_complete'), rowsSince(since, 'app_open')]);
  const cohorts = buildCohorts(installs, opens);
  const batch = db.batch();
  for (const [cohort, c] of Object.entries(cohorts))
    batch.set(db.collection('analytics_cohorts').doc(cohort), { cohort, ...c, updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return Object.keys(cohorts).length;
}

/** Deletes counters past their 13-month expiry and pulse answers past 24 months. */
export async function purgeExpired(now = new Date()): Promise<number> {
  let purged = 0;
  for (const col of ['telemetry', 'testimonials']) {
    const snap = await db.collection(col).where('expireAt', '<', Timestamp.fromDate(now)).limit(450).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    purged += snap.size;
  }
  return purged;
}

/* --------------------------------- digest --------------------------------- */

/** Monday of an ISO week ("2026-W40"), UTC. */
export function weekStart(cohort: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(cohort);
  if (!m) return null;
  const jan4 = Date.UTC(Number(m[1]), 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7;
  return new Date(jan4 - dow * DAY + (Number(m[2]) - 1) * 7 * DAY);
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)} %` : '—');

/** The morning text: four numbers and the biggest leak of the last 7 days (pure, tested). */
export function digestText(
  daily: { events?: Record<string, number>; engine?: Record<string, number>; visits?: Record<string, number> }[],
  cohorts: Record<string, number>[],
): string {
  const e: Record<string, number> = {};
  const g: Record<string, number> = {};
  const v: Record<string, number> = {};
  for (const d of daily) {
    for (const [k, n] of Object.entries(d.events ?? {})) inc(e, k, n);
    for (const [k, n] of Object.entries(d.engine ?? {})) inc(g, k, n);
    for (const [k, n] of Object.entries(d.visits ?? {})) inc(v, k, n);
  }
  let installs = 0;
  let back = 0;
  for (const c of cohorts) {
    installs += num(c.installs);
    back += num(c.d7);
  }
  const steps = ['onboarding_started', 'onboarding_complete', 'first_plan', 'first_decision', 'first_completed'];
  const names: Record<string, string> = {
    onboarding_started: 'onboarding commencé',
    onboarding_complete: 'onboarding terminé',
    first_plan: '1er plan',
    first_decision: '1re décision',
    first_completed: '1re terminée',
  };
  let leak = '';
  let worst = 101;
  for (let i = 1; i < steps.length; i++) {
    const before = e[steps[i - 1]!] ?? 0;
    if (before < 3) continue;
    const rate = ((e[steps[i]!] ?? 0) / before) * 100;
    if (rate < worst) {
      worst = rate;
      leak = `${names[steps[i - 1]!]} → ${names[steps[i]!]} : −${Math.round(100 - rate)} %`;
    }
  }
  return [
    `Activation ${pct(e.first_decision ?? 0, e.onboarding_complete ?? 0)} · J7 ${pct(back, installs)} · Acceptation ${pct(g.a ?? 0, g.p ?? 0)}`,
    `Onboardings ${e.onboarding_complete ?? 0} · 1res décisions ${e.first_decision ?? 0} · ouvertures ${e.app_open ?? 0}`,
    `Page d'accueil : ${v.landing ?? 0} vues, ${(v.cta_demo ?? 0) + (v.cta_mine ?? 0)} clics`,
    leak ? `Plus grosse fuite : ${leak}` : 'Pas encore assez de données pour repérer une fuite.',
  ].join('\n');
}

export async function sendDigest(now = new Date()): Promise<boolean> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return false;
  const since = isoDay(new Date(now.getTime() - 6 * DAY));
  const [daily, cohorts] = await Promise.all([
    db.collection('analytics_daily').where('day', '>=', since).get(),
    db.collection('analytics_cohorts').orderBy('cohort', 'desc').limit(8).get(),
  ]);
  // Only install weeks old enough to have a day-7 value.
  const old = cohorts.docs
    .map((d) => d.data() as Record<string, number> & { cohort: string })
    .filter((c) => {
      const start = weekStart(c.cohort);
      return start !== null && start.getTime() + 13 * DAY <= now.getTime();
    });
  const text = digestText(
    daily.docs.map((d) => d.data()),
    old,
  );
  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: 'POST',
    body: text,
    headers: { Title: 'Sigma - 7 derniers jours', Tags: 'bar_chart' },
  });
  return res.ok;
}

/** Daily job: retention, purge, digest. */
export async function dailyJob(now = new Date()) {
  const cohorts = await aggregateCohorts(now);
  const purged = await purgeExpired(now);
  const digest = await sendDigest(now).catch((err: unknown) => {
    logger.warn('analytics digest failed', { err: String(err) });
    return false;
  });
  return { cohorts, purged, digest };
}

/* ------------------------------- endpoints -------------------------------- */

/** Admin: recompute everything now (the dashboard's "Recompute" button). */
export const adminRecomputeAnalytics = onCall(callableDefaults, async (req) => {
  requireAdmin(req);
  try {
    const days = await aggregateDays(new Date(), 7);
    const cohorts = await aggregateCohorts();
    const purged = await purgeExpired();
    return { days, cohorts, purged };
  } catch (err) {
    logger.error('analytics recompute failed', { err: String(err) });
    throw new HttpsError('internal', 'recompute-failed');
  }
});

interface VisitReq {
  method: string;
  body: string | null;
  headers: Record<string, string | undefined>;
}
interface VisitRes {
  status(code: number): VisitRes;
  set(k: string, v: string): VisitRes;
  send(body?: unknown): void;
}

/** Parses a beacon body "k=landing&lang=fr" into an allowed counter (pure, tested). */
export function parseVisit(body: string | null): { k: string; lang: string | null } | null {
  if (!body || body.length > 200) return null;
  const params = new URLSearchParams(body);
  const k = params.get('k') ?? '';
  const lang = params.get('lang');
  if (!VISIT_KEYS.has(k)) return null;
  return { k, lang: lang && LANGS.has(lang) ? lang : null };
}

/** Cookie-less landing counter: increments today's totals. No IP or identifier is stored. */
export async function recordVisit(req: VisitReq, res: VisitRes) {
  res.set('access-control-allow-origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('');
  const ua = (req.headers['user-agent'] ?? '').toLowerCase();
  const visit = parseVisit(req.body);
  if (!visit || /bot|crawl|spider|preview|headless/.test(ua)) return res.status(204).send('');
  const day = isoDay(new Date());
  await db
    .collection('analytics_daily')
    .doc(day)
    .set(
      {
        day,
        visits: { [visit.k]: FieldValue.increment(1) },
        ...(visit.lang && visit.k === 'landing' ? { visitsLang: { [visit.lang]: FieldValue.increment(1) } } : {}),
      },
      { merge: true },
    );
  return res.status(204).send('');
}
