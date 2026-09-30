/**
 * Decision quality, measured on what really happened — not on a made-up score.
 * Funnel: proposed → accepted/started → completed (same day) / deferred /
 * rejected / wrong time; plus how accurate the time estimates are and whether
 * calibration actually improves them.
 */
import type { DecisionFeedback, DecisionRecord } from './types';
import { addDays, isoDay } from './dates';
import { learnProfile } from './decision';
import { MIN_SAMPLES } from './calibration';

export interface Quality {
  proposed: number;
  acted: number;
  started: number;
  completed: number;
  completedSameDay: number;
  deferred: number;
  rejected: number;
  wrongTime: number;
  /** Rates in % (0 when nothing was proposed). */
  acceptance: number;
  topOneAcceptance: number;
  completion: number;
  wrongTimeRate: number;
  /** Mean absolute error of raw estimates vs. calibrated ones, in % (null = not enough timed work). */
  estimateError: number | null;
  calibratedError: number | null;
  timedSamples: number;
  learnedPreferences: number;
  observations: number;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const alive = <T extends { deletedAt?: string | null }>(rows: T[] | undefined): T[] =>
  (rows ?? []).filter((r) => !r.deletedAt);

/** Raw vs. calibrated estimate error, each sample judged with a factor learned only from earlier samples. */
export function estimateAccuracy(feedback: DecisionFeedback[]) {
  const timed = alive(feedback)
    .filter((f) => f.action === 'completed' && f.minutes && f.estimate)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const history = new Map<string, number[]>();
  let raw = 0;
  let cal = 0;
  for (const f of timed) {
    const key = f.category || f.sourceType || 'other';
    const past = history.get(key) ?? [];
    const sorted = [...past].sort((a, b) => a - b);
    const factor = past.length >= MIN_SAMPLES ? sorted[Math.floor(sorted.length / 2)]! : 1;
    raw += Math.abs(f.minutes! - f.estimate!) / f.minutes!;
    cal += Math.abs(f.minutes! - f.estimate! * factor) / f.minutes!;
    history.set(key, [...past, f.minutes! / f.estimate!]);
  }
  return timed.length
    ? {
        raw: Math.round((raw / timed.length) * 100),
        calibrated: Math.round((cal / timed.length) * 100),
        samples: timed.length,
      }
    : { raw: null, calibrated: null, samples: 0 };
}

export function decisionQuality(
  records: DecisionRecord[],
  feedback: DecisionFeedback[],
  now: Date,
  days = 30,
): Quality {
  const since = isoDay(addDays(now, -days));
  const rows = alive(records).filter((r) => r.date >= since);
  const acted = rows.filter((r) => ['accepted', 'started', 'completed'].includes(r.outcome));
  const top = rows.filter((r) => r.role === 'now');
  const completed = rows.filter((r) => r.outcome === 'completed');
  const acc = estimateAccuracy(feedback);
  const profile = learnProfile(alive(feedback));
  return {
    proposed: rows.length,
    acted: acted.length,
    started: rows.filter((r) => r.startedAt).length,
    completed: completed.length,
    completedSameDay: completed.filter((r) => r.completedAt && isoDay(new Date(r.completedAt)) === r.date)
      .length,
    deferred: rows.filter((r) => r.outcome === 'deferred').length,
    rejected: rows.filter((r) => r.outcome === 'rejected').length,
    wrongTime: rows.filter((r) => r.outcome === 'wrongTime').length,
    acceptance: pct(acted.length, rows.length),
    topOneAcceptance: pct(
      top.filter((r) => ['accepted', 'started', 'completed'].includes(r.outcome)).length,
      top.length,
    ),
    completion: pct(completed.length, rows.length),
    wrongTimeRate: pct(rows.filter((r) => r.outcome === 'wrongTime').length, rows.length),
    estimateError: acc.raw,
    calibratedError: acc.calibrated,
    timedSamples: acc.samples,
    learnedPreferences:
      profile.timeRules.length +
      profile.patterns.filter((p) => Math.abs(p.acceptance - p.rejection) >= 0.3).length,
    observations: alive(feedback).length,
  };
}
