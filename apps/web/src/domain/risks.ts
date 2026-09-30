/**
 * "What could slip through the cracks": the few things your brain should keep
 * in the background — promises, deadlines, people waiting, stalled work —
 * ranked by how costly forgetting them would be. Not a second to-do list.
 */
import type { Decision } from './decision';
import type { Snapshot } from './types';
import { detectStagnation } from './stagnation';

export type RiskLevel = 'high' | 'medium' | 'low';
export type RiskKind = 'commitment' | 'deadline' | 'waiting' | 'stalled' | 'mission';

export interface Risk {
  id: string;
  level: RiskLevel;
  kind: RiskKind;
  title: string;
  /** i18n key + params explaining the risk. */
  detail: { key: string; params: Record<string, string | number> };
  /** Record to open. */
  ref: { collection: 'tasks' | 'projects' | 'missions' | string; id: string };
  decision?: Decision;
  /** For sorting: hours until it matters (Infinity when undated). */
  hours: number;
}

const HOUR = 3_600_000;
const RANK: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

const hoursUntil = (iso: string | null | undefined, now: Date) =>
  iso ? (new Date(iso.length === 10 ? `${iso}T18:00:00` : iso).getTime() - now.getTime()) / HOUR : Infinity;

export function detectRisks(decisions: Decision[], snap: Snapshot, now: Date, limit = 8): Risk[] {
  const out: Risk[] = [];
  const seen = new Set<string>();
  const add = (r: Risk) => {
    const key = `${r.ref.collection}:${r.ref.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };

  // 1. Promises made to someone — read from tasks so a snoozed card cannot hide them.
  for (const task of snap.tasks) {
    if (task.deletedAt || task.status === 'done' || !task.promisedTo) continue;
    const h = hoursUntil(task.dueDate, now);
    add({
      id: `commitment:${task.id}`,
      level: h <= 24 ? 'high' : h <= 72 ? 'medium' : 'low',
      kind: 'commitment',
      title: task.title,
      detail: {
        key:
          h < 0
            ? 'risk.commitmentLate'
            : h <= 48
              ? 'risk.commitmentHours'
              : Number.isFinite(h)
                ? 'risk.commitmentDays'
                : 'risk.commitment',
        params: {
          to: task.promisedTo,
          hours: Math.max(0, Math.round(h)),
          days: Math.max(1, Math.round(h / 24)),
        },
      },
      ref: { collection: 'tasks', id: task.id },
      hours: h,
    });
  }

  for (const d of decisions) {
    if (d.action === 'ignore') continue;
    const ref = d.signal.ref;
    const title = d.signal.title ?? '';
    // 2. Someone is waiting for an answer.
    if (d.action === 'reply') {
      const since = d.signal.receivedAt ?? d.signal.createdAt;
      const days = since ? Math.floor((now.getTime() - new Date(since).getTime()) / (24 * HOUR)) : 0;
      if (days >= 1)
        add({
          id: `waiting:${d.signal.id}`,
          level: days >= 3 ? 'medium' : 'low',
          kind: 'waiting',
          title,
          detail: d.signal.sender
            ? { key: 'risk.waiting', params: { who: d.signal.sender, days } }
            : { key: 'risk.waitingAnon', params: { days } },
          ref,
          decision: d,
          hours: -days * 24,
        });
      continue;
    }
    // 3. A mission falling behind its forecast.
    if (d.signal.sourceType === 'mission' && d.signal.essential) {
      add({
        id: `mission:${d.signal.id}`,
        level: 'medium',
        kind: 'mission',
        title,
        detail: { key: 'risk.mission', params: {} },
        ref,
        decision: d,
        hours: d.facts.hoursToDue ?? Infinity,
      });
      continue;
    }
    // 4. Deadlines within three days.
    const h = d.facts.hoursToDue;
    if (h !== null && h <= 72)
      add({
        id: `deadline:${d.signal.id}`,
        level: h <= 24 ? 'high' : h <= 48 ? 'medium' : 'low',
        kind: 'deadline',
        title,
        detail: {
          key: h < 0 ? 'risk.overdue' : h <= 36 ? 'risk.deadline' : 'risk.deadlineDays',
          params: { hours: Math.max(0, Math.round(h)), days: Math.max(1, Math.round(h / 24)) },
        },
        ref,
        decision: d,
        hours: h,
      });
  }

  // 5. Work that stopped moving.
  for (const s of detectStagnation(snap, now))
    add({
      id: `stalled:${s.kind}:${s.id}`,
      level: s.deferrals >= 3 || s.noNextStep ? 'medium' : 'low',
      kind: 'stalled',
      title: s.title,
      detail: s.deferrals
        ? { key: 'risk.deferred', params: { count: s.deferrals, days: s.days } }
        : s.noNextStep
          ? { key: 'risk.noNext', params: {} }
          : { key: 'risk.idle', params: { days: s.days } },
      ref: { collection: `${s.kind}s`, id: s.id },
      hours: Infinity,
    });

  return out
    .filter((r) => r.title || r.decision)
    .sort((a, b) => RANK[a.level] - RANK[b.level] || a.hours - b.hours)
    .slice(0, limit);
}
