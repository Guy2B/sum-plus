/**
 * Estimates get better with use: the focus timer records the real time spent,
 * and Σ learns per category how far off the estimates usually are.
 */
import type { Decision } from './decision';
import type { DecisionFeedback } from './types';

export const MIN_SAMPLES = 3;

export type Factors = Record<string, number>;

const keyOf = (category?: string | null, source?: string | null) => category || source || 'other';

export function calibration(
  feedback: Pick<DecisionFeedback, 'action' | 'category' | 'sourceType' | 'minutes' | 'estimate'>[],
): Factors {
  const groups = new Map<string, number[]>();
  for (const f of feedback) {
    if (f.action !== 'completed' || !f.minutes || !f.estimate) continue;
    const k = keyOf(f.category, f.sourceType);
    groups.set(k, [...(groups.get(k) ?? []), f.minutes / f.estimate]);
  }
  const out: Factors = {};
  groups.forEach((ratios, k) => {
    if (ratios.length < MIN_SAMPLES) return;
    const sorted = [...ratios].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    out[k] = Math.min(3, Math.max(0.5, Math.round(median * 10) / 10));
  });
  return out;
}

/** Calibrated duration of a decision, in minutes (rounded to 5). */
export function calibratedMinutes(d: Decision, factors: Factors = {}): number {
  const f = factors[keyOf(d.signal.category, d.signal.sourceType)] ?? 1;
  return Math.max(5, Math.round((d.facts.effortMinutes * f) / 5) * 5);
}

export function factorFor(d: Decision, factors: Factors = {}): number {
  return factors[keyOf(d.signal.category, d.signal.sourceType)] ?? 1;
}
