/**
 * Counterfactual explanations: why Σ picked A rather than B. Built only from
 * the facts both decisions already carry, so every sentence is checkable.
 */
import type { Decision, RejectionReason } from './decision';

export interface WhyNot {
  decision: Decision;
  key: string;
  params: Record<string, string | number>;
  /** ISO date to format in the UI ("can wait until …"). */
  until?: string | null;
}

export function whyNot(chosen: Decision, alt: Decision, arbitration?: RejectionReason): WhyNot {
  const base = { decision: alt, params: {} as Record<string, string | number> };
  if (arbitration === 'merged') return { ...base, key: 'whynot.merged' };
  if (arbitration === 'capacity')
    return { ...base, key: 'whynot.capacity', params: { minutes: alt.facts.effortMinutes } };
  if (arbitration === 'source-limit') return { ...base, key: 'whynot.sourceLimit' };
  const a = chosen.facts;
  const b = alt.facts;
  if (b.hoursToDue !== null && (a.hoursToDue === null || b.hoursToDue > a.hoursToDue + 12))
    return { ...base, key: 'whynot.canWait', until: alt.signal.dueAt ?? null };
  if (b.hoursToDue === null && a.hoursToDue !== null) return { ...base, key: 'whynot.noDeadline' };
  if (chosen.signal.unblocks && !alt.signal.unblocks)
    return { ...base, key: 'whynot.unblocks', params: { count: chosen.signal.unblocks } };
  if (chosen.signal.chain?.length && !alt.signal.chain?.length)
    return { ...base, key: 'whynot.goal', params: { goal: chosen.signal.chain[0]! } };
  if (b.effortMinutes >= a.effortMinutes * 2 && b.effortMinutes >= 30)
    return { ...base, key: 'whynot.longer', params: { minutes: b.effortMinutes } };
  if (b.importance < a.importance - 10) return { ...base, key: 'whynot.lessImportant' };
  return { ...base, key: 'whynot.lowerPriority' };
}
