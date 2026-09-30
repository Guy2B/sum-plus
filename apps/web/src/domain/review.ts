/**
 * Evening check-in and weekly review, computed from what actually happened
 * (feedback on decisions, missions, projects) — no questionnaire.
 */
import type { DecisionFeedback, Snapshot } from './types';
import { periodOf, type DayPeriod } from './decision';
import { addDays, isoDay } from './dates';
import { isStalled } from './learning';
import { planMission } from './missions';

export interface DaySummary {
  done: number;
  deferred: number;
  dismissed: number;
}

export interface Insight {
  key: string;
  params?: Record<string, string | number>;
}

export interface WeekReview extends DaySummary {
  proposed: number;
  wrongTime: number;
  completionPct: number;
  bestPeriod: DayPeriod | null;
  mostDeferred: string | null;
  insights: Insight[];
}

const alive = <T extends { deletedAt?: string | null }>(rows: T[] | undefined): T[] =>
  (rows ?? []).filter((r) => !r.deletedAt);

function count(rows: DecisionFeedback[]): DaySummary {
  return {
    done: rows.filter((r) => r.action === 'completed').length,
    deferred: rows.filter((r) => r.action === 'deferred' || r.action === 'wrongTime').length,
    dismissed: rows.filter((r) => r.action === 'rejected').length,
  };
}

export function daySummary(snap: Snapshot, now: Date): DaySummary {
  const day = isoDay(now);
  return count(
    alive(snap.feedback).filter(
      (f) => f.createdAt.slice(0, 10) === day || isoDay(new Date(f.createdAt)) === day,
    ),
  );
}

export function weeklyReview(snap: Snapshot, now: Date): WeekReview {
  const since = addDays(now, -7).toISOString();
  const rows = alive(snap.feedback).filter((f) => f.createdAt >= since);
  const base = count(rows);
  const proposed = new Set(rows.map((r) => r.signalId)).size;

  const byPeriod = new Map<DayPeriod, number>();
  for (const r of rows.filter((x) => x.action === 'completed' || x.action === 'accepted'))
    byPeriod.set(periodOf(r.hour), (byPeriod.get(periodOf(r.hour)) ?? 0) + 1);
  const bestPeriod = [...byPeriod.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const deferredBy = new Map<string, number>();
  for (const r of rows.filter((x) => (x.action === 'deferred' || x.action === 'wrongTime') && x.category))
    deferredBy.set(r.category!, (deferredBy.get(r.category!) ?? 0) + 1);
  const topDeferred = [...deferredBy.entries()].sort((a, b) => b[1] - a[1])[0];
  const mostDeferred = topDeferred && topDeferred[1] >= 2 ? topDeferred[0] : null;

  const completionPct = proposed ? Math.round((base.done / proposed) * 100) : 0;
  const insights: Insight[] = [];
  if (proposed)
    insights.push({
      key: 'review.insight.completion',
      params: { done: base.done, proposed, pct: completionPct },
    });
  if (bestPeriod) insights.push({ key: 'review.insight.bestPeriod', params: { period: bestPeriod } });
  if (mostDeferred) insights.push({ key: 'review.insight.mostDeferred', params: { category: mostDeferred } });
  for (const p of alive(snap.projects)
    .filter((x) => isStalled(x, snap.tasks))
    .slice(0, 2))
    insights.push({ key: 'review.insight.stalled', params: { project: p.name } });
  for (const m of alive(snap.missions).filter((x) => x.status === 'active')) {
    const f = planMission(m, now).forecast;
    if (!f.onTrack) insights.push({ key: 'review.insight.behind', params: { mission: m.title } });
  }
  const overdue = alive(snap.tasks).filter(
    (t) => t.status !== 'done' && t.dueDate && t.dueDate < isoDay(now),
  ).length;
  if (overdue >= 3) insights.push({ key: 'review.insight.overdue', params: { count: overdue } });
  return {
    ...base,
    proposed,
    wrongTime: rows.filter((r) => r.action === 'wrongTime').length,
    completionPct,
    bestPeriod,
    mostDeferred,
    insights,
  };
}
