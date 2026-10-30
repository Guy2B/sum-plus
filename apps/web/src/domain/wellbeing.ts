import type { Habit, HabitLog, HealthMetric } from './types';
import { addDays, isoDay } from './dates';
import { indexLogs, isHabitDue, streak } from './habits';

const alive = <T extends { deletedAt?: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);

export interface HealthTrend {
  days: number;
  avgSleep: number | null;
  avgEnergy: number | null;
  avgSteps: number | null;
  sleepTrend: 'up' | 'down' | 'flat' | null;
  /** Organisational readiness (0-100), explicitly not a medical score. Null without data. */
  readiness: number | null;
  series: { date: string; sleepHours: number | null; energy: number | null; steps: number | null }[];
}

const avg = (xs: number[]) =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

export function healthTrend(metrics: HealthMetric[], now: Date, days = 14): HealthTrend {
  const floor = isoDay(addDays(now, -(days - 1)));
  const today = isoDay(now);
  const byDay = new Map<string, { sleepHours: number | null; energy: number | null; steps: number | null }>();
  for (const m of alive(metrics)) {
    if (m.date < floor || m.date > today) continue;
    const prev = byDay.get(m.date) ?? { sleepHours: null, energy: null, steps: null };
    byDay.set(m.date, {
      sleepHours: m.sleepHours ?? prev.sleepHours,
      energy: m.energy ?? prev.energy,
      steps: m.steps ?? prev.steps,
    });
  }
  const series: HealthTrend['series'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = isoDay(addDays(now, -i));
    const m = byDay.get(key);
    series.push({
      date: key,
      sleepHours: m?.sleepHours ?? null,
      energy: m?.energy ?? null,
      steps: m?.steps ?? null,
    });
  }
  const pick = (k: 'sleepHours' | 'energy' | 'steps', rows = series) =>
    rows.map((s) => s[k]).filter((x): x is number => x != null);
  const sleeps = pick('sleepHours');
  let sleepTrend: HealthTrend['sleepTrend'] = null;
  if (sleeps.length >= 4) {
    const half = Math.floor(sleeps.length / 2);
    const a = avg(sleeps.slice(0, half)) ?? 0;
    const b = avg(sleeps.slice(half)) ?? 0;
    sleepTrend = b - a > 0.3 ? 'up' : a - b > 0.3 ? 'down' : 'flat';
  }
  const recent = series.slice(-3);
  const rs = pick('sleepHours', recent);
  const re = pick('energy', recent);
  let readiness: number | null = null;
  const parts: number[] = [];
  if (rs.length) parts.push(Math.min(1, (avg(rs) ?? 0) / 8));
  if (re.length) parts.push(((avg(re) ?? 1) - 1) / 4);
  if (parts.length) readiness = Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
  return {
    days,
    avgSleep: avg(sleeps),
    avgEnergy: avg(pick('energy')),
    avgSteps: avg(pick('steps')),
    sleepTrend,
    readiness,
    series,
  };
}

export function habitDueOn(h: Habit, day: Date): boolean {
  return isHabitDue(h, day);
}

/** Consecutive completed periods counting back from today; an open today does not break it. */
export function habitStreak(h: Habit, logs: HabitLog[], now: Date): number {
  return streak(h, indexLogs(logs), now);
}
