/**
 * Automatic sources: Σ syncs every connected source when it opens, then every
 * 15 minutes while it stays open (and when it comes back to the foreground),
 * without ever popping a window — sources that need a click are reported as
 * "reconnect". After each run, the day plan is compared before / after: when
 * new events break it, Today explains what changed instead of reshuffling silently.
 */
import { signal } from '@preact/signals';
import { entitlement, settings, snapshot, updateSettings } from '../data/store';
import { can } from '../domain/entitlements';
import { visibleDecisions } from '../data/actions';
import { scheduleDay } from '../domain/scheduler';
import { eventsOn } from '../domain/planning';
import type { CalendarEvent, MailAccount } from '../domain/types';
import { NeedsUserError, silently } from './connectors/mode';
import { isNative } from '../config';
import { scheduleNativeNotifications } from './native-notify';

const EVERY = 15 * 60_000;

export type SourceKey = `mail:${string}` | 'calendar:google' | 'calendar:microsoft';
export interface SourceState {
  label: string;
  state: 'ok' | 'needs-user' | 'error';
  at: string;
  kind: 'mail' | 'calendar';
  provider: string;
}

/** Last outcome per source, for the freshness line and the reconnect links. */
export const sourceStates = signal<Record<string, SourceState>>({});
/** What changed in today's plan after the last automatic sync (null = nothing worth saying). */
export const dayChange = signal<{
  events: { title: string; start: string; minutes: number }[];
  dropped: string[];
} | null>(null);
export const syncing = signal(false);

let lastRun = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** Calendars the person connected (recorded on manual sync, or inferred from synced events). */
export function connectedCalendars(): ('google' | 'microsoft')[] {
  const known = new Set(settings.value.usage.calendars ?? []);
  for (const e of snapshot.value.events) {
    const p = e.source?.provider;
    if (!e.deletedAt && (p === 'google' || p === 'microsoft')) known.add(p);
  }
  return [...known];
}

export async function rememberCalendar(provider: 'google' | 'microsoft') {
  const cur = settings.value.usage.calendars ?? [];
  if (!cur.includes(provider))
    await updateSettings((s) => ({ ...s, usage: { ...s.usage, calendars: [...cur, provider] } }));
}

const todayKey = (e: CalendarEvent) => `${e.id}:${e.start}`;

/** Plan comparison: new timed events today and items that no longer fit. */
export function diffDay(
  beforeEvents: CalendarEvent[],
  afterEvents: CalendarEvent[],
  beforeFit: string[],
  afterFit: string[],
  now: Date,
) {
  const seen = new Set(beforeEvents.map(todayKey));
  const events = eventsOn(afterEvents, now)
    .filter((e) => !e.deletedAt && !e.allDay && new Date(e.end || e.start) > now && !seen.has(todayKey(e)))
    .map((e) => ({
      title: e.title,
      start: e.start,
      minutes: Math.round((new Date(e.end || e.start).getTime() - new Date(e.start).getTime()) / 60_000),
    }));
  const dropped = beforeFit.filter((t) => !afterFit.includes(t));
  return events.length && dropped.length ? { events, dropped } : null;
}

function fitTitles(now: Date): string[] {
  const plan = scheduleDay(
    visibleDecisions.value,
    snapshot.value.events.filter((e) => !e.deletedAt),
    settings.value.context,
    now,
  );
  return [...new Set(plan.blocks.map((b) => b.decision.signal.title ?? b.decision.signal.id))];
}

async function syncMail(a: MailAccount) {
  if (a.provider === 'gmail') return (await import('./connectors/google')).syncGmail(a);
  if (a.provider === 'outlook') return (await import('./connectors/microsoft')).syncOutlook(a);
  return (await import('./connectors/remote')).syncImap(a);
}

async function syncCalendar(p: 'google' | 'microsoft') {
  return p === 'google'
    ? (await import('./connectors/google')).syncGoogleCalendar()
    : (await import('./connectors/microsoft')).syncOutlookCalendar();
}

/** One automatic pass over every connected source. Never shows a window. */
export async function runAutoSync(force = false): Promise<void> {
  if (syncing.value || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  if (!force && Date.now() - lastRun < EVERY - 5_000) return;
  const accounts = snapshot.value.mailAccounts.filter(
    (a) => !a.deletedAt && (a.status === 'connected' || a.status === 'needs-auth'),
  );
  const calendars = can('calendarSync', entitlement.value) ? connectedCalendars() : [];
  if (!accounts.length && !calendars.length) return;

  syncing.value = true;
  lastRun = Date.now();
  const now = new Date();
  const beforeEvents = snapshot.value.events.filter((e) => !e.deletedAt);
  const beforeFit = fitTitles(now);
  const states = { ...sourceStates.value };
  const record = (key: string, s: Omit<SourceState, 'at'>) => {
    states[key] = { ...s, at: new Date().toISOString() };
    sourceStates.value = { ...states };
  };

  await silently(async () => {
    for (const p of calendars) {
      try {
        await syncCalendar(p);
        record(`calendar:${p}`, { label: p, state: 'ok', kind: 'calendar', provider: p });
      } catch (err) {
        record(`calendar:${p}`, {
          label: p,
          state: err instanceof NeedsUserError ? 'needs-user' : 'error',
          kind: 'calendar',
          provider: p,
        });
      }
    }
    for (const a of accounts) {
      try {
        await syncMail(a);
        record(`mail:${a.id}`, { label: a.email, state: 'ok', kind: 'mail', provider: a.provider });
      } catch (err) {
        record(`mail:${a.id}`, {
          label: a.email,
          state: err instanceof NeedsUserError ? 'needs-user' : 'error',
          kind: 'mail',
          provider: a.provider,
        });
      }
    }
  });

  const afterEvents = snapshot.value.events.filter((e) => !e.deletedAt);
  const change = diffDay(beforeEvents, afterEvents, beforeFit, fitTitles(new Date()), new Date());
  if (change) dayChange.value = change;
  syncing.value = false;
  if (isNative()) void scheduleNativeNotifications();
}

/** A click on "reconnect": the same source, this time allowed to show its sign-in screen. */
export async function reconnect(key: string): Promise<void> {
  const s = sourceStates.value[key];
  if (!s) return;
  try {
    if (s.kind === 'calendar') await syncCalendar(s.provider as 'google' | 'microsoft');
    else {
      const a = snapshot.value.mailAccounts.find((m) => `mail:${m.id}` === key);
      if (a) await syncMail(a);
    }
    sourceStates.value = {
      ...sourceStates.value,
      [key]: { ...s, state: 'ok', at: new Date().toISOString() },
    };
  } catch {
    sourceStates.value = {
      ...sourceStates.value,
      [key]: { ...s, state: 'error', at: new Date().toISOString() },
    };
  }
}

/** Starts the automatic syncs: now, every 15 minutes, and when Σ comes back to the foreground. */
export function startAutoSync(): void {
  if (timer) return;
  void runAutoSync(true);
  timer = setInterval(() => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') void runAutoSync();
  }, EVERY);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runAutoSync();
  });
}
