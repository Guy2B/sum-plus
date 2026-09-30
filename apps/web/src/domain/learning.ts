import type { Project, Skill, Task } from './types';
import { addDays, isoDay } from './dates';

/**
 * Spaced review: a successful review multiplies the interval (max 60 days); a
 * difficult one resets it to one day. Progress moves with evidence of practice.
 */
export function scheduleReview(
  skill: Skill,
  outcome: 'easy' | 'good' | 'hard',
  now: Date,
): Pick<Skill, 'reviewIntervalDays' | 'nextReviewAt' | 'lastPracticedAt' | 'progress'> {
  const current = skill.reviewIntervalDays ?? 1;
  const interval =
    outcome === 'hard' ? 1 : Math.min(60, Math.max(1, Math.round(current * (outcome === 'easy' ? 2.5 : 2))));
  const delta = outcome === 'hard' ? 1 : outcome === 'good' ? 4 : 6;
  return {
    reviewIntervalDays: interval,
    nextReviewAt: isoDay(addDays(now, interval)),
    lastPracticedAt: now.toISOString(),
    progress: Math.min(100, Math.max(0, Math.round((skill.progress ?? 0) + delta))),
  };
}

export function resourceProgress(skill: Skill): number {
  if (!skill.resources.length) return 0;
  const score = skill.resources.reduce(
    (s, r) => s + (r.status === 'done' ? 1 : r.status === 'doing' ? 0.5 : 0),
    0,
  );
  return Math.round((score / skill.resources.length) * 100);
}

export function projectProgress(p: Project, tasks: Task[] = []): number {
  const linked = tasks.filter((t) => !t.deletedAt && t.projectId === p.id);
  const units = p.milestones.length + linked.length;
  if (!units) return p.status === 'done' ? 100 : 0;
  const done = p.milestones.filter((m) => m.done).length + linked.filter((t) => t.status === 'done').length;
  return Math.round((done / units) * 100);
}

export function projectNextStep(p: Project, tasks: Task[] = []): string | null {
  const open = tasks.filter((t) => !t.deletedAt && t.projectId === p.id && t.status !== 'done');
  if (open[0]) return open[0].title;
  return p.milestones.find((m) => !m.done)?.title ?? null;
}

/** Active project with no open step at all: it needs a next action to move. */
export function isStalled(p: Project, tasks: Task[] = []): boolean {
  return p.status === 'active' && projectNextStep(p, tasks) === null;
}
