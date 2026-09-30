/**
 * "Today" = three cards, each with a distinct job:
 *  - now:     the single most valuable thing to do next;
 *  - watch:   what will bite soon if nobody looks (deadline this week, mission
 *             falling behind, someone waiting for a reply);
 *  - protect: a real free slot in the agenda for the most demanding piece of
 *             work, so deep work is planned instead of hoped for.
 */
import type { Decision } from './decision';
import type { CalendarEvent, ContextProfile } from './types';
import { addDays, atTime } from './dates';
import { eventsOn } from './planning';

export interface Slot {
  start: Date;
  end: Date;
}

export interface TodayPick {
  now: Decision | null;
  watch: Decision | null;
  protect: { decision: Decision; slot: Slot | null } | null;
}

const QUARTER = 15 * 60_000;
const roundUp = (d: Date) => new Date(Math.ceil(d.getTime() / QUARTER) * QUARTER);

/** First free window of `minutes` in the working hours, today after `now`, else tomorrow. */
export function freeSlot(
  events: CalendarEvent[],
  ctx: Pick<ContextProfile, 'workStart' | 'workEnd'>,
  now: Date,
  minutes: number,
): Slot | null {
  const need = minutes * 60_000;
  for (let offset = 0; offset < 2; offset++) {
    const day = addDays(now, offset);
    const dayStart = atTime(day, ctx.workStart || '09:00');
    const dayEnd = atTime(day, ctx.workEnd || '18:00');
    let cursor = roundUp(new Date(Math.max(dayStart.getTime(), offset === 0 ? now.getTime() : 0)));
    const busy = eventsOn(events, day)
      .filter((e) => !e.allDay && !e.deletedAt)
      .map((e) => ({ s: new Date(e.start), e: new Date(e.end || e.start) }))
      .sort((a, b) => a.s.getTime() - b.s.getTime());
    for (const b of busy) {
      if (b.e <= cursor) continue;
      if (b.s.getTime() - cursor.getTime() >= need)
        return { start: cursor, end: new Date(cursor.getTime() + need) };
      if (b.e > cursor) cursor = roundUp(b.e);
    }
    if (dayEnd.getTime() - cursor.getTime() >= need)
      return { start: cursor, end: new Date(cursor.getTime() + need) };
  }
  return null;
}

/** Work that deserves a protected block: long enough and not a quick reply. */
export const isDeepWork = (d: Decision) =>
  d.facts.effortMinutes >= 25 && d.action !== 'reply' && d.action !== 'ignore';

function watchPriority(d: Decision): number {
  const h = d.facts.hoursToDue;
  if (d.signal.sourceType === 'mission' && d.signal.essential) return 3; // mission falling behind
  if (h !== null && h > 24 && h <= 24 * 7) return 2; // deadline this week, not today
  if (d.action === 'reply' || d.facts.intent === 'opportunity') return 1; // someone is waiting
  return 0;
}

export function blockMinutes(d: Decision): number {
  return Math.min(120, Math.max(30, Math.round(d.facts.effortMinutes / 15) * 15));
}

/** Picks the three cards from decisions already ranked best-first. */
export function pickToday(
  ranked: Decision[],
  events: CalendarEvent[],
  ctx: Pick<ContextProfile, 'workStart' | 'workEnd'>,
  now: Date,
): TodayPick {
  const pool = ranked.filter((d) => d.action !== 'ignore');
  const first = pool[0] ?? null;
  const rest = pool.slice(1);
  const protectD = rest.find(isDeepWork) ?? rest[rest.length > 1 ? 1 : 0] ?? null;
  const others = rest.filter((d) => d !== protectD);
  const watch =
    [...others].sort((a, b) => watchPriority(b) - watchPriority(a) || b.score - a.score)[0] ?? null;
  return {
    now: first,
    watch,
    protect: protectD
      ? { decision: protectD, slot: freeSlot(events, ctx, now, blockMinutes(protectD)) }
      : null,
  };
}
