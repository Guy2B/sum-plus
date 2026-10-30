/**
 * Habits, shared by NEXT and Cortex.
 *
 * A habit is due on some weekdays (explicit `days`, or derived from `cadence`),
 * is either yes/no or a quantity (`target`), and each day carries at most one
 * log. A log can be partial (value < target) or a deliberate pass (`skipped`),
 * which neither counts nor breaks a streak. Old records (no days, no target,
 * no value) keep their original meaning: any log means done.
 */
import type { Habit, HabitLog, ISODate } from './types';
import { addDays, isoDay } from './dates';

/** Weekday index used by Cortex: 0 = Monday … 6 = Sunday. */
export const weekdayIndex = (d: Date): number => (d.getDay() + 6) % 7;

export function habitDays(h: Habit): number[] {
  if (h.days?.length) return [...new Set(h.days.filter((d) => d >= 0 && d <= 6))].sort();
  if (h.cadence === 'weekdays') return [0, 1, 2, 3, 4];
  return [0, 1, 2, 3, 4, 5, 6];
}

export const habitTarget = (h: Habit): number => Math.max(1, Math.round(h.target ?? 1));

/** Due that day (weekly habits are due any day of the week until done). */
export function isHabitDue(h: Habit, day: Date): boolean {
  if (h.archived || h.deletedAt) return false;
  if (h.cadence === 'weekly' && !h.days?.length) return true;
  return habitDays(h).includes(weekdayIndex(day));
}

export type HabitLogIndex = Map<string, HabitLog>;

/** Latest live log per habit and day, keyed `${habitId}|${date}`. */
export function indexLogs(logs: HabitLog[]): HabitLogIndex {
  const out: HabitLogIndex = new Map();
  for (const l of logs) {
    if (l.deletedAt) continue;
    const k = `${l.habitId}|${l.date}`;
    const prev = out.get(k);
    if (!prev || prev.updatedAt < l.updatedAt) out.set(k, l);
  }
  return out;
}

export const logOn = (idx: HabitLogIndex, h: Habit, date: ISODate): HabitLog | undefined =>
  idx.get(`${h.id}|${date}`);

export function valueOn(idx: HabitLogIndex, h: Habit, date: ISODate): number {
  const l = logOn(idx, h, date);
  if (!l || l.skipped) return 0;
  return l.value ?? 1;
}

export const skippedOn = (idx: HabitLogIndex, h: Habit, date: ISODate): boolean =>
  Boolean(logOn(idx, h, date)?.skipped);

export const doneOn = (idx: HabitLogIndex, h: Habit, date: ISODate): boolean =>
  valueOn(idx, h, date) >= habitTarget(h);

/** First day the habit exists, as an ISO date. */
const since = (h: Habit): ISODate => h.createdAt.slice(0, 10);

/** Does this day count towards the habit (scheduled, not passed, not before it existed)? */
function counts(idx: HabitLogIndex, h: Habit, day: Date): boolean {
  const k = isoDay(day);
  if (skippedOn(idx, h, k)) return false;
  if (k < since(h) && valueOn(idx, h, k) === 0) return false;
  return h.cadence === 'weekly' && !h.days?.length ? true : habitDays(h).includes(weekdayIndex(day));
}

/** Consecutive completed scheduled days ending today; an open today does not break it. */
export function streak(h: Habit, idx: HabitLogIndex, now: Date): number {
  if (h.cadence === 'weekly' && !h.days?.length) return weeklyStreak(h, idx, now);
  const today = isoDay(now);
  let n = 0;
  for (let i = 0; i < 1000; i++) {
    const day = addDays(now, -i);
    const k = isoDay(day);
    if (k < since(h) && valueOn(idx, h, k) === 0) break;
    if (!counts(idx, h, day)) continue;
    if (doneOn(idx, h, k)) n += 1;
    else if (k !== today) break;
  }
  return n;
}

function weeklyStreak(h: Habit, idx: HabitLogIndex, now: Date): number {
  let n = 0;
  for (let w = 0; w < 104; w++) {
    const monday = addDays(now, -weekdayIndex(now) - w * 7);
    const hit = [0, 1, 2, 3, 4, 5, 6].some((d) => doneOn(idx, h, isoDay(addDays(monday, d))));
    if (hit) n += 1;
    else if (w > 0) break;
  }
  return n;
}

export function bestStreak(h: Habit, idx: HabitLogIndex, now: Date): number {
  const end = isoDay(now);
  let day = new Date(`${since(h)}T12:00:00`);
  let cur = 0;
  let best = 0;
  for (let i = 0; i < 5000 && isoDay(day) <= end; i++) {
    const k = isoDay(day);
    if (counts(idx, h, day)) {
      if (doneOn(idx, h, k)) best = Math.max(best, ++cur);
      else if (k !== end) cur = 0;
    }
    day = addDays(day, 1);
  }
  return best;
}

/** Share of scheduled days completed over the last `days` days (today only if done). Null without data. */
export function successRate(h: Habit, idx: HabitLogIndex, now: Date, days = 30): number | null {
  const today = isoDay(now);
  let due = 0;
  let ok = 0;
  for (let i = 0; i < days; i++) {
    const day = addDays(now, -i);
    const k = isoDay(day);
    if (k < since(h) && valueOn(idx, h, k) === 0) break;
    if (!counts(idx, h, day)) continue;
    const done = doneOn(idx, h, k);
    if (k === today && !done) continue;
    due += 1;
    if (done) ok += 1;
  }
  return due ? Math.round((ok / due) * 100) : null;
}

export interface DayHabits {
  due: number;
  done: number;
}

/** Habits due and completed on a day, across all live habits. */
export function habitsOnDay(habits: Habit[], idx: HabitLogIndex, day: Date): DayHabits {
  const k = isoDay(day);
  let due = 0;
  let done = 0;
  for (const h of habits) {
    if (h.archived || h.deletedAt || !counts(idx, h, day) || !isHabitDue(h, day)) continue;
    if (k < since(h) && valueOn(idx, h, k) === 0) continue;
    due += 1;
    if (doneOn(idx, h, k)) done += 1;
  }
  return { due, done };
}

/** Consecutive days where every due habit was completed (today counts once complete). */
export function perfectDays(habits: Habit[], idx: HabitLogIndex, now: Date): number {
  const live = habits.filter((h) => !h.archived && !h.deletedAt);
  if (!live.length) return 0;
  const first = live.reduce((m, h) => (since(h) < m ? since(h) : m), isoDay(now));
  const today = isoDay(now);
  let n = 0;
  for (let i = 0; i < 1000; i++) {
    const day = addDays(now, -i);
    const k = isoDay(day);
    if (k < first) break;
    const r = habitsOnDay(live, idx, day);
    if (!r.due) continue;
    if (r.done === r.due) n += 1;
    else if (k !== today) break;
  }
  return n;
}
