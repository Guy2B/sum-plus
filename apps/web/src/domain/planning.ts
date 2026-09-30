import type { CalendarEvent, ContextProfile, HealthMetric, Snapshot, Task } from './types';
import type { Decision } from './decision';
import { addDays, atTime, isoDay, minutesBetween, toDate, WEEKDAY_KEYS } from './dates';
import { domainEnabled } from './signals';

export interface Capacity {
  isWorkDay: boolean;
  focusMinutes: number;
  meetingMinutes: number;
  availableMinutes: number;
  energyFactor: number;
  /** True only when the factor is derived from a real health/energy record. */
  energyMeasured: boolean;
  capacityMinutes: number;
  plannedMinutes: number;
  loadPct: number;
  status: 'light' | 'balanced' | 'overloaded';
}

const alive = <T extends { deletedAt?: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);

export function eventsOn(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const key = isoDay(day);
  return alive(events)
    .filter((e) => {
      const s = toDate(e.start);
      const en = toDate(e.end) ?? s;
      if (!s || !en) return false;
      return isoDay(s) <= key && isoDay(en) >= key;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

export function latestHealth(health: HealthMetric[], now: Date): HealthMetric | undefined {
  const floor = isoDay(addDays(now, -1));
  return alive(health)
    .filter((h) => h.date >= floor && h.date <= isoDay(now))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function isTodayTask(t: Task, now: Date): boolean {
  if (t.deletedAt || t.status === 'done') return false;
  if (t.essential || t.scheduledFor === 'today' || t.status === 'doing') return true;
  const due = toDate(t.dueDate);
  return Boolean(due && isoDay(due) <= isoDay(now));
}

export function computeCapacity(snap: Snapshot, ctx: ContextProfile, now: Date = new Date()): Capacity {
  const weekday = WEEKDAY_KEYS[now.getDay()] as ContextProfile['workDays'][number];
  const isWorkDay = ctx.workDays.includes(weekday);
  const dayStart = atTime(now, ctx.workStart || '09:00');
  const dayEnd = atTime(now, ctx.workEnd || '18:00');
  const windowMinutes = Math.max(0, minutesBetween(dayStart, dayEnd));

  let meetingMinutes = 0;
  if (domainEnabled(ctx, 'calendar')) {
    for (const e of eventsOn(snap.events, now)) {
      if (e.allDay) continue;
      const s = toDate(e.start) as Date;
      const en = toDate(e.end) ?? s;
      const from = Math.max(s.getTime(), dayStart.getTime());
      const to = Math.min(en.getTime(), dayEnd.getTime());
      if (to > from) meetingMinutes += Math.round((to - from) / 60_000);
    }
  }

  const focusMinutes = Math.round((isWorkDay ? ctx.focusHours || 4 : Math.min(ctx.focusHours || 4, 2)) * 60);
  const availableMinutes = Math.max(0, windowMinutes - meetingMinutes);

  let energyFactor = 1;
  let energyMeasured = false;
  if (domainEnabled(ctx, 'health')) {
    const h = latestHealth(snap.health, now);
    if (h && (h.energy != null || h.sleepHours != null)) {
      energyMeasured = true;
      if (h.energy != null) energyFactor = h.energy <= 2 ? 0.7 : h.energy === 3 ? 0.9 : 1;
      if (h.sleepHours != null && h.sleepHours < 6) energyFactor *= 0.85;
    }
  }

  const capacityMinutes = Math.round(Math.min(focusMinutes, availableMinutes) * energyFactor);
  const plannedMinutes = alive(snap.tasks)
    .filter((t) => isTodayTask(t, now))
    .reduce((sum, t) => sum + (t.estimateMinutes || 30), 0);
  const loadPct =
    capacityMinutes > 0 ? Math.round((plannedMinutes / capacityMinutes) * 100) : plannedMinutes > 0 ? 999 : 0;
  const status: Capacity['status'] = loadPct > 110 ? 'overloaded' : loadPct < 60 ? 'light' : 'balanced';
  return {
    isWorkDay,
    focusMinutes,
    meetingMinutes,
    availableMinutes,
    energyFactor: Math.round(energyFactor * 100) / 100,
    energyMeasured,
    capacityMinutes,
    plannedMinutes,
    loadPct,
    status,
  };
}

export interface PlanBlock {
  start: string;
  end: string;
  kind: 'event' | 'focus' | 'break';
  title?: string;
  titleKey?: string;
  titleParams?: Record<string, string | number>;
  ref?: { collection: string; id: string };
}

/**
 * Lays the selected decisions and today's tasks into free slots of the work
 * window, putting demanding work into the declared energy peak.
 */
export function buildDayBlocks(
  snap: Snapshot,
  ctx: ContextProfile,
  outcomes: Decision[],
  now: Date = new Date(),
): PlanBlock[] {
  const dayStart = atTime(now, ctx.workStart || '09:00');
  const dayEnd = atTime(now, ctx.workEnd || '18:00');
  const cursorStart = new Date(Math.max(dayStart.getTime(), roundUpQuarter(now).getTime()));
  const events = domainEnabled(ctx, 'calendar') ? eventsOn(snap.events, now).filter((e) => !e.allDay) : [];

  const busy = events
    .map((e) => ({ s: toDate(e.start) as Date, e: (toDate(e.end) ?? toDate(e.start)) as Date, ev: e }))
    .filter((b) => b.e > cursorStart && b.s < dayEnd);

  // Candidate work items: selected outcomes first, then remaining today tasks.
  type Item = {
    title?: string;
    titleKey?: string;
    titleParams?: Record<string, string | number>;
    minutes: number;
    demanding: boolean;
    ref?: PlanBlock['ref'];
  };
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const d of outcomes) {
    seen.add(d.signal.id);
    items.push({
      title: d.signal.title,
      titleKey: d.signal.titleKey,
      titleParams: d.signal.titleParams,
      minutes: Math.max(15, d.facts.effortMinutes),
      demanding: d.facts.effortMinutes >= 45 || d.facts.importance >= 70,
      ref: d.signal.ref,
    });
  }
  for (const t of alive(snap.tasks).filter((t) => isTodayTask(t, now))) {
    if (seen.has(`tasks:${t.id}`)) continue;
    items.push({
      title: t.title,
      minutes: t.estimateMinutes || 30,
      demanding: (t.estimateMinutes || 30) >= 45 || t.priority === 'high',
      ref: { collection: 'tasks', id: t.id },
    });
  }

  // Peak-first ordering: demanding work goes where the user said energy is highest.
  const peakFirst = ctx.energyPeak === 'morning';
  items.sort((a, b) =>
    peakFirst ? Number(b.demanding) - Number(a.demanding) : Number(a.demanding) - Number(b.demanding),
  );

  const blocks: PlanBlock[] = busy.map((b) => ({
    start: b.s.toISOString(),
    end: b.e.toISOString(),
    kind: 'event',
    title: b.ev.title,
    ref: { collection: 'events', id: b.ev.id },
  }));
  let cursor = cursorStart;
  let sinceBreak = 0;
  for (const item of items) {
    let placed = false;
    while (!placed && cursor < dayEnd) {
      const clash = busy.find(
        (b) => b.s < new Date(cursor.getTime() + item.minutes * 60_000) && b.e > cursor,
      );
      if (clash) {
        cursor = new Date(clash.e);
        continue;
      }
      const end = new Date(cursor.getTime() + item.minutes * 60_000);
      if (end > dayEnd) break;
      blocks.push({
        start: cursor.toISOString(),
        end: end.toISOString(),
        kind: 'focus',
        title: item.title,
        titleKey: item.titleKey,
        titleParams: item.titleParams,
        ref: item.ref,
      });
      sinceBreak += item.minutes;
      cursor = end;
      if (sinceBreak >= 90) {
        const bEnd = new Date(cursor.getTime() + 15 * 60_000);
        blocks.push({
          start: cursor.toISOString(),
          end: bEnd.toISOString(),
          kind: 'break',
          titleKey: 'plan.break',
        });
        cursor = bEnd;
        sinceBreak = 0;
      }
      placed = true;
    }
    if (!placed) break;
  }
  return blocks.sort((a, b) => a.start.localeCompare(b.start));
}

function roundUpQuarter(d: Date): Date {
  const r = new Date(d);
  r.setSeconds(0, 0);
  const m = r.getMinutes();
  r.setMinutes(Math.ceil(m / 15) * 15);
  return r;
}

/* ------------------------------ attention -------------------------------- */

export type AttentionGroup = 'reply' | 'opportunity' | 'admin' | 'execution' | 'capacity';

export function attentionGroup(d: Decision): AttentionGroup {
  if (d.signal.sourceType === 'health') return 'capacity';
  if (d.signal.needsReply) return 'reply';
  if (d.facts.intent === 'opportunity') return 'opportunity';
  if (
    d.facts.intent === 'transactional' ||
    d.tags.includes('administration') ||
    d.signal.sourceType === 'finance'
  )
    return 'admin';
  return 'execution';
}

export function groupAttention(decisions: Decision[]): Record<AttentionGroup, Decision[]> {
  const groups: Record<AttentionGroup, Decision[]> = {
    reply: [],
    opportunity: [],
    admin: [],
    execution: [],
    capacity: [],
  };
  for (const d of decisions) {
    if (d.action === 'ignore') continue;
    groups[attentionGroup(d)].push(d);
  }
  return groups;
}

/** Overlapping timed events on the same day. */
export function findConflicts(events: CalendarEvent[]): [CalendarEvent, CalendarEvent][] {
  const timed = alive(events)
    .filter((e) => !e.allDay)
    .sort((a, b) => a.start.localeCompare(b.start));
  const out: [CalendarEvent, CalendarEvent][] = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i] as CalendarEvent;
      const b = timed[j] as CalendarEvent;
      if (b.start >= a.end) break;
      out.push([a, b]);
    }
  }
  return out;
}
