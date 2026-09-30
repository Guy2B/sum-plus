/**
 * Σ day planner. Where the decision engine ranks items one by one, the planner
 * reasons about the whole day: it lays the ranked work into the real free
 * windows between meetings, keeps must-do items first, puts deep work in the
 * energy peak, splits long work across windows and says precisely what does
 * not fit and why. What-if constraints ("only 2 hours", "stop at 16:00",
 * "I'm tired", "that meeting is cancelled") re-run the same reasoning.
 */
import type { Decision } from './decision';
import type { CalendarEvent, ContextProfile } from './types';
import { addDays, atTime } from './dates';
import { eventsOn } from './planning';

export interface WhatIf {
  /** Stop working at HH:MM. */
  endAt?: string | null;
  /** Only this many minutes of work today. */
  maxMinutes?: number | null;
  /** Low energy: short and urgent things first, no long deep work. */
  tired?: boolean;
  /** Events considered cancelled / moved. */
  skipEvents?: string[];
}

export interface Block {
  decision: Decision;
  start: Date;
  end: Date;
  /** Part n of a split item (1-based), total parts. */
  part?: [number, number];
}

export type LeftReason = 'noTime' | 'budget' | 'tired';

export interface Left {
  decision: Decision;
  reason: LeftReason;
  /** Due within 24 h: leaving it out has a real cost. */
  atRisk: boolean;
}

export interface DayPlan {
  blocks: Block[];
  left: Left[];
  events: CalendarEvent[];
  windowStart: Date;
  windowEnd: Date;
  freeMinutes: number;
  usedMinutes: number;
  /** The working day is over: this is tomorrow's plan. */
  tomorrow: boolean;
}

const MIN = 60_000;
const QUARTER = 15 * MIN;
const roundUp = (d: Date) => new Date(Math.ceil(d.getTime() / QUARTER) * QUARTER);
const PEAK: Record<ContextProfile['energyPeak'], [string, string]> = {
  morning: ['08:00', '12:00'],
  afternoon: ['13:00', '17:00'],
  evening: ['17:00', '21:00'],
};

interface Gap {
  start: number;
  end: number;
}

export const isMustToday = (d: Decision) =>
  Boolean(d.signal.essential) || (d.facts.hoursToDue !== null && d.facts.hoursToDue <= 24);

export function effortOf(d: Decision): number {
  return Math.max(5, Math.round(d.facts.effortMinutes / 5) * 5);
}

function freeGaps(events: CalendarEvent[], from: Date, to: Date): Gap[] {
  const busy = events
    .map((e) => ({ s: new Date(e.start).getTime(), e: new Date(e.end || e.start).getTime() }))
    .filter((b) => b.e > from.getTime() && b.s < to.getTime())
    .sort((a, b) => a.s - b.s);
  const gaps: Gap[] = [];
  let cursor = from.getTime();
  for (const b of busy) {
    if (b.s > cursor) gaps.push({ start: cursor, end: b.s });
    cursor = Math.max(cursor, roundUp(new Date(b.e)).getTime());
  }
  if (to.getTime() > cursor) gaps.push({ start: cursor, end: to.getTime() });
  return gaps.filter((g) => g.end - g.start >= 5 * MIN);
}

function take(gaps: Gap[], gap: Gap, minutes: number): { start: Date; end: Date } {
  const start = new Date(gap.start);
  const end = new Date(gap.start + minutes * MIN);
  gap.start = end.getTime();
  if (gap.end - gap.start < 5 * MIN) gaps.splice(gaps.indexOf(gap), 1);
  return { start, end };
}

export function scheduleDay(
  ranked: Decision[],
  allEvents: CalendarEvent[],
  ctx: Pick<ContextProfile, 'workStart' | 'workEnd' | 'energyPeak'>,
  now: Date,
  whatIf: WhatIf = {},
): DayPlan {
  // Less than 30 minutes of working time left: plan tomorrow instead.
  const todayEnd = atTime(now, ctx.workEnd || '18:00');
  const tomorrow = now.getTime() > todayEnd.getTime() - 30 * MIN;
  if (tomorrow) now = atTime(addDays(now, 1), ctx.workStart || '09:00');
  const dayStart = atTime(now, ctx.workStart || '09:00');
  let dayEnd = atTime(now, ctx.workEnd || '18:00');
  if (whatIf.endAt) dayEnd = new Date(Math.min(dayEnd.getTime(), atTime(now, whatIf.endAt).getTime()));
  const windowStart = roundUp(new Date(Math.max(dayStart.getTime(), now.getTime())));
  const skipped = new Set(whatIf.skipEvents ?? []);
  const events = eventsOn(allEvents, now).filter((e) => !e.allDay && !e.deletedAt && !skipped.has(e.id));
  const gaps = windowStart < dayEnd ? freeGaps(events, windowStart, dayEnd) : [];
  const freeMinutes = gaps.reduce((a, g) => a + (g.end - g.start) / MIN, 0);
  let budget = Math.min(whatIf.maxMinutes ?? Infinity, whatIf.tired ? freeMinutes * 0.6 : Infinity);

  const [peakFrom, peakTo] = PEAK[ctx.energyPeak ?? 'morning'];
  const peak = { start: atTime(now, peakFrom).getTime(), end: atTime(now, peakTo).getTime() };

  const pool = ranked.filter((d) => d.action !== 'ignore');
  const must = pool.filter(isMustToday);
  const rest = pool.filter((d) => !isMustToday(d));
  // Tired: among the optional work, short things first.
  if (whatIf.tired) rest.sort((a, b) => effortOf(a) - effortOf(b) || b.score - a.score);

  const blocks: Block[] = [];
  const left: Left[] = [];
  for (const d of [...must, ...rest]) {
    const minutes = effortOf(d);
    const leave = (reason: LeftReason) =>
      left.push({ decision: d, reason, atRisk: d.facts.hoursToDue !== null && d.facts.hoursToDue <= 24 });
    if (whatIf.tired && minutes > 45 && !isMustToday(d)) {
      leave('tired');
      continue;
    }
    if (minutes > budget) {
      leave('budget');
      continue;
    }
    const deep = minutes >= 25;
    // Anything with a time (a meeting to prepare, a deadline today) must be done before it.
    const due = d.signal.dueAt ? new Date(d.signal.dueAt).getTime() : Infinity;
    const limit = due > windowStart.getTime() && due < dayEnd.getTime() ? due : Infinity;
    const fits = gaps.filter((g) => Math.min(g.end, limit) - g.start >= minutes * MIN);
    const inPeak = deep ? fits.find((g) => g.start < peak.end && g.end > peak.start) : undefined;
    const gap = inPeak ?? fits[0];
    if (gap) {
      if (inPeak && gap.start < peak.start && gap.end - peak.start >= minutes * MIN) gap.start = peak.start;
      blocks.push({ decision: d, ...take(gaps, gap, minutes) });
      budget -= minutes;
      continue;
    }
    // Long work: split into ≥ 25-minute chunks across the remaining windows.
    const room = gaps
      .filter((g) => g.end - g.start >= 25 * MIN)
      .reduce((a, g) => a + (g.end - g.start) / MIN, 0);
    if (minutes >= 50 && room >= minutes) {
      let remaining = minutes;
      const parts: { start: Date; end: Date }[] = [];
      for (const g of [...gaps].filter((x) => x.end - x.start >= 25 * MIN)) {
        if (remaining <= 0) break;
        const chunk = Math.min(remaining, Math.floor((g.end - g.start) / MIN / 5) * 5);
        parts.push(take(gaps, g, chunk));
        remaining -= chunk;
      }
      parts.forEach((p, i) => blocks.push({ decision: d, ...p, part: [i + 1, parts.length] }));
      budget -= minutes;
      continue;
    }
    leave('noTime');
  }
  blocks.sort((a, b) => a.start.getTime() - b.start.getTime());
  return {
    blocks,
    left,
    events,
    windowStart,
    tomorrow,
    windowEnd: dayEnd,
    freeMinutes: Math.round(freeMinutes),
    usedMinutes: blocks.reduce((a, b) => a + (b.end.getTime() - b.start.getTime()) / MIN, 0),
  };
}

/** Items that moved between two plans (for "what if?" feedback). */
export function comparePlans(before: DayPlan, after: DayPlan) {
  const placed = (p: DayPlan) => new Set(p.blocks.map((b) => b.decision.signal.id));
  const a = placed(before);
  const b = placed(after);
  return {
    dropped: before.blocks
      .filter(
        (x, i, all) => !b.has(x.decision.signal.id) && all.findIndex((y) => y.decision === x.decision) === i,
      )
      .map((x) => x.decision),
    added: after.blocks
      .filter(
        (x, i, all) => !a.has(x.decision.signal.id) && all.findIndex((y) => y.decision === x.decision) === i,
      )
      .map((x) => x.decision),
  };
}
