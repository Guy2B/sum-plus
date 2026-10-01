/**
 * Opt-in, privacy-safe product measurement. Off by default; when on, Σ sends
 * a handful of anonymous counters — never content, never an identifier:
 *   { e: event, day, cohort: install week, age: days since install, ed, lang, v, src, ai, pf }
 * plus, once a day, a summary made of numbers only (how many cards were shown,
 * started, completed…). Retention is read from `age` (how many installs opened
 * the app on day N), so no user can be followed across events.
 * The admin dashboard reads daily aggregates computed by the Netlify job.
 */
import { APP_VERSION, cloudConfigured } from '../config';
import { settings, snapshot, updateSettings } from '../data/store';
import { addDays, isoDay } from '../domain/dates';
import { learnTimeRules } from '../domain/decision';
import { estimateAccuracy } from '../domain/quality';
import type { DecisionFeedback, DecisionRecord, Settings } from '../domain/types';
import { aiMode } from './llm';
import { call, cloud } from './firebase';

export const EVENTS = [
  'app_open',
  'onboarding_started',
  'onboarding_complete',
  'first_plan',
  'first_decision',
  'first_completed',
  'decision_started',
  'decision_completed',
  'coach_used',
  'coach_plan_applied',
  'day_replanned',
  'daily_summary',
] as const;
export type TelemetryEvent = (typeof EVENTS)[number];

/** Events counted once per install; app_open once per day; the rest every time. */
const ONCE = new Set<TelemetryEvent>([
  'onboarding_started',
  'onboarding_complete',
  'first_plan',
  'first_decision',
  'first_completed',
]);

const DAY = 86_400_000;

/** ISO week of a date, e.g. "2026-W40". */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function platform(): 'app' | 'pwa' | 'web' {
  if (typeof window === 'undefined') return 'web';
  if ((window as { Capacitor?: unknown }).Capacitor) return 'app';
  return window.matchMedia?.('(display-mode: standalone)').matches ? 'pwa' : 'web';
}

/** The anonymous record for one event (exported for tests). */
export function telemetryRecord(
  e: TelemetryEvent,
  installedAt: string,
  now: Date,
  ctx: {
    edition: string;
    locale: string;
    version: string;
    src?: string | null;
    ai?: string | null;
    pf?: string | null;
  },
) {
  const installed = new Date(`${installedAt}T00:00:00`);
  const age = Math.min(
    90,
    Math.max(0, Math.floor((new Date(`${isoDay(now)}T00:00:00`).getTime() - installed.getTime()) / DAY)),
  );
  return {
    e,
    day: isoDay(now),
    cohort: isoWeek(installed),
    age,
    ed: ctx.edition.slice(0, 16),
    lang: ctx.locale.slice(0, 2),
    v: ctx.version.slice(0, 16),
    ...(ctx.src ? { src: ctx.src.slice(0, 8) } : {}),
    ...(ctx.ai ? { ai: ctx.ai.slice(0, 8) } : {}),
    ...(ctx.pf ? { pf: ctx.pf.slice(0, 8) } : {}),
  };
}

/**
 * One day of engine quality, as numbers only: cards shown (p), acted on (a),
 * started (s), completed (c), deferred (d), rejected (r), wrong time (w),
 * overload avoided in minutes (ov), observations (ob), learned time rules (lr),
 * estimate error before/after calibration in % (eb/ea).
 */
export function dailySummary(
  records: DecisionRecord[],
  feedback: DecisionFeedback[],
  usage: Pick<Settings['usage'], 'avoided'>,
  day: string,
): Record<string, number> | null {
  const rows = records.filter((r) => !r.deletedAt && r.date === day);
  if (!rows.length) return null;
  const fb = feedback.filter((f) => !f.deletedAt);
  const acc = estimateAccuracy(fb);
  const count = (pred: (r: DecisionRecord) => boolean) => rows.filter(pred).length;
  return {
    p: rows.length,
    a: count((r) => ['accepted', 'started', 'completed'].includes(r.outcome)),
    s: count((r) => Boolean(r.startedAt)),
    c: count((r) => r.outcome === 'completed'),
    d: count((r) => r.outcome === 'deferred'),
    r: count((r) => r.outcome === 'rejected'),
    w: count((r) => r.outcome === 'wrongTime'),
    ov: usage.avoided?.date === day ? Math.min(1440, usage.avoided.minutes) : 0,
    ob: Math.min(10_000, fb.length),
    lr: Math.min(100, learnTimeRules(fb).length),
    ...(acc.samples >= 3 && acc.raw !== null && acc.calibrated !== null
      ? { eb: Math.min(1000, acc.raw), ea: Math.min(1000, acc.calibrated) }
      : {}),
  };
}

/** Records the install date once (kept locally; only its week is ever sent). */
export async function ensureInstalled(now = new Date()): Promise<void> {
  if (!settings.value.usage.installedAt)
    await updateSettings((cur) => ({ ...cur, usage: { ...cur.usage, installedAt: isoDay(now) } }));
}

async function send(record: Record<string, unknown>, now: Date) {
  const [{ db }, fs] = await Promise.all([cloud(), import('firebase/firestore')]);
  // Kept 13 months at most: the daily Netlify job deletes expired counters.
  await fs.addDoc(fs.collection(db, 'telemetry'), {
    ...record,
    expireAt: fs.Timestamp.fromMillis(now.getTime() + 395 * DAY),
  });
}

export async function track(e: TelemetryEvent, now = new Date()): Promise<void> {
  const s = settings.value;
  if (!s.usage.telemetry || !cloudConfigured()) return;
  const sent = s.usage.sentEvents ?? [];
  const today = isoDay(now);
  if (ONCE.has(e) && sent.includes(e)) return;
  if (e === 'app_open' && s.usage.pingedOn === today) return;
  try {
    await updateSettings((cur) => ({
      ...cur,
      usage: {
        ...cur.usage,
        ...(ONCE.has(e) ? { sentEvents: [...(cur.usage.sentEvents ?? []), e] } : {}),
        ...(e === 'app_open' ? { pingedOn: today } : {}),
      },
    }));
    const record = telemetryRecord(e, s.usage.installedAt ?? today, now, {
      edition: s.edition,
      locale: s.locale,
      version: APP_VERSION,
      src: s.usage.startedFrom ?? 'direct',
      ai: aiMode(s.ai),
      pf: platform(),
    });
    await send(record, now);
    if (e === 'app_open') await sendSummary(now);
  } catch {
    /* measurement is best-effort and never gets in the way */
  }
}

/** Yesterday's engine summary, sent once with the first app opening of the day. */
async function sendSummary(now: Date) {
  const s = settings.value;
  const yesterday = isoDay(addDays(now, -1));
  if (s.usage.summaryFor === yesterday) return;
  await updateSettings((cur) => ({ ...cur, usage: { ...cur.usage, summaryFor: yesterday } }));
  const numbers = dailySummary(snapshot.value.decisionLog, snapshot.value.feedback, s.usage, yesterday);
  if (!numbers) return;
  const base = telemetryRecord('daily_summary', s.usage.installedAt ?? yesterday, addDays(now, -1), {
    edition: s.edition,
    locale: s.locale,
    version: APP_VERSION,
    src: s.usage.startedFrom ?? 'direct',
    ai: aiMode(s.ai),
    pf: platform(),
  });
  await send({ ...base, ...numbers }, now);
}

/** Turns measurement on or off; on consent, reports the steps already reached. */
export async function setTelemetry(on: boolean): Promise<void> {
  await updateSettings((cur) => ({ ...cur, usage: { ...cur.usage, telemetry: on } }));
  if (!on) return;
  await ensureInstalled();
  await track('app_open');
  await track('onboarding_started');
  if (settings.value.onboardingComplete) await track('onboarding_complete');
}

/* ------------------------------ feedback pulse ------------------------------ */

export interface Testimonial {
  vote: 'up' | 'down';
  text: string;
  sig: string;
  publish: boolean;
}

/** Sends a weekly pulse answer. Only what the person typed, plus language/edition/age. */
export async function sendTestimonial(t: Testimonial, now = new Date()): Promise<void> {
  const s = settings.value;
  const installed = s.usage.installedAt ?? isoDay(now);
  const age = Math.max(0, Math.floor((now.getTime() - new Date(`${installed}T00:00:00`).getTime()) / DAY));
  const [{ db }, fs] = await Promise.all([cloud(), import('firebase/firestore')]);
  await fs.addDoc(fs.collection(db, 'testimonials'), {
    vote: t.vote,
    text: t.text.trim().slice(0, 500),
    sig: t.sig.trim().slice(0, 60),
    publish: t.vote === 'up' && t.publish && Boolean(t.text.trim()),
    day: isoDay(now),
    lang: s.locale.slice(0, 2),
    ed: s.edition.slice(0, 16),
    age: Math.min(3650, age),
    // Kept 24 months at most (purged by the daily Netlify job).
    expireAt: fs.Timestamp.fromMillis(now.getTime() + 730 * DAY),
  });
}

/* --------------------------------- admin --------------------------------- */

export interface DailyAggregate {
  day: string;
  events?: Record<string, number>;
  byLang?: Record<string, Record<string, number>>;
  bySrc?: Record<string, Record<string, number>>;
  ai?: Record<string, number>;
  pf?: Record<string, number>;
  engine?: Record<string, number>;
  visits?: Record<string, number>;
  visitsLang?: Record<string, number>;
}

export interface CohortAggregate {
  cohort: string;
  installs: number;
  d1?: number;
  d3?: number;
  d7?: number;
  d14?: number;
  d30?: number;
}

export interface TestimonialRow extends Testimonial {
  id: string;
  day: string;
  lang: string;
  ed: string;
  age: number;
}

/** Reads the aggregates of the last `days` (plus the period before, for trends). */
export async function loadAnalytics(days: number, now = new Date()) {
  const [{ db }, fs] = await Promise.all([cloud(), import('firebase/firestore')]);
  const since = isoDay(addDays(now, -(days * 2 - 1)));
  const [daily, cohorts, pulse] = await Promise.all([
    fs.getDocs(fs.query(fs.collection(db, 'analytics_daily'), fs.where('day', '>=', since))),
    fs.getDocs(fs.query(fs.collection(db, 'analytics_cohorts'), fs.orderBy('cohort', 'desc'), fs.limit(12))),
    fs.getDocs(fs.query(fs.collection(db, 'testimonials'), fs.orderBy('day', 'desc'), fs.limit(50))),
  ]);
  return {
    daily: daily.docs.map((d) => d.data() as DailyAggregate),
    cohorts: cohorts.docs.map((d) => d.data() as CohortAggregate),
    testimonials: pulse.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TestimonialRow, 'id'>) })),
  };
}

/** Asks the Netlify job to recompute the aggregates now (admin only). */
export function recomputeAnalytics() {
  return call<Record<string, never>, { days: number; cohorts: number; purged: number }>(
    'adminRecomputeAnalytics',
    {},
  );
}
