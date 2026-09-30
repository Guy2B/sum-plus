/**
 * Opt-in, privacy-safe product measurement. Off by default; when on, Σ sends
 * a handful of anonymous counters — never content, never an identifier:
 *   { e: event, day, cohort: install week, age: days since install, ed, lang, v, src? }
 * Retention is read from `age` (how many installs opened the app on day N),
 * so no user can be followed across events.
 */
import { APP_VERSION, cloudConfigured } from '../config';
import { settings, updateSettings } from '../data/store';
import { isoDay } from '../domain/dates';
import { cloud } from './firebase';

export const EVENTS = [
  'app_open',
  'onboarding_started',
  'onboarding_complete',
  'first_plan',
  'decision_started',
  'decision_completed',
  'coach_used',
  'day_replanned',
] as const;
export type TelemetryEvent = (typeof EVENTS)[number];

/** Events counted once per install; app_open once per day; the rest every time. */
const ONCE = new Set<TelemetryEvent>(['onboarding_started', 'onboarding_complete', 'first_plan']);

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

/** The anonymous record for one event (exported for tests). */
export function telemetryRecord(
  e: TelemetryEvent,
  installedAt: string,
  now: Date,
  ctx: { edition: string; locale: string; version: string; src?: string | null },
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
  };
}

/** Records the install date once (kept locally; only its week is ever sent). */
export async function ensureInstalled(now = new Date()): Promise<void> {
  if (!settings.value.usage.installedAt)
    await updateSettings((cur) => ({ ...cur, usage: { ...cur.usage, installedAt: isoDay(now) } }));
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
        ...(ONCE.has(e) ? { sentEvents: [...sent, e] } : {}),
        ...(e === 'app_open' ? { pingedOn: today } : {}),
      },
    }));
    const record = telemetryRecord(e, s.usage.installedAt ?? today, now, {
      edition: s.edition,
      locale: s.locale,
      version: APP_VERSION,
      src: e === 'onboarding_started' ? s.usage.startedFrom : null,
    });
    const [{ db }, fs] = await Promise.all([cloud(), import('firebase/firestore')]);
    // Deleted automatically after 13 months (Firestore TTL on expireAt).
    await fs.addDoc(fs.collection(db, 'telemetry'), {
      ...record,
      expireAt: fs.Timestamp.fromMillis(now.getTime() + 395 * DAY),
    });
  } catch {
    /* measurement is best-effort and never gets in the way */
  }
}

/** Admin: aggregates the last `days` of events into a funnel and day-N retention. */
export async function funnel(days = 30, now = new Date()) {
  const [{ db }, fs] = await Promise.all([cloud(), import('firebase/firestore')]);
  const since = isoDay(new Date(now.getTime() - days * DAY));
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'telemetry'), fs.where('day', '>=', since)));
  const counts: Record<string, number> = {};
  const openByAge = new Map<number, number>();
  const sources: Record<string, number> = {};
  for (const d of snap.docs) {
    const r = d.data() as { e: string; age: number; src?: string };
    counts[r.e] = (counts[r.e] ?? 0) + 1;
    if (r.e === 'app_open') openByAge.set(r.age, (openByAge.get(r.age) ?? 0) + 1);
    if (r.e === 'onboarding_started') sources[r.src ?? 'direct'] = (sources[r.src ?? 'direct'] ?? 0) + 1;
  }
  const base = counts.onboarding_complete ?? 0;
  const retention = (n: number) => (base ? Math.round(((openByAge.get(n) ?? 0) / base) * 100) : 0);
  return {
    counts,
    sources,
    retention: { d1: retention(1), d7: retention(7), d30: retention(30) },
    total: snap.size,
  };
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
