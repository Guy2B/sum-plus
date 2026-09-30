/**
 * What is no longer moving — more useful than "overdue": a task deferred again
 * and again, a project with no activity or no next step, a mission nobody
 * works on. Each comes with the facts that make it stagnant.
 */
import type { Snapshot } from './types';
import { isStalled } from './learning';

export interface Stagnant {
  kind: 'task' | 'project' | 'mission';
  id: string;
  title: string;
  /** Days since the last sign of activity. */
  days: number;
  deferrals: number;
  noNextStep: boolean;
}

const DAY = 86_400_000;
const alive = <T extends { deletedAt?: string | null }>(rows: T[] | undefined): T[] =>
  (rows ?? []).filter((r) => !r.deletedAt);
const since = (iso: string | null | undefined, now: Date) =>
  iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY)) : 0;

export function detectStagnation(snap: Snapshot, now: Date): Stagnant[] {
  const feedback = alive(snap.feedback);
  const deferrals = (signalPrefix: string) =>
    feedback.filter(
      (f) => f.signalId.startsWith(signalPrefix) && (f.action === 'deferred' || f.action === 'wrongTime'),
    ).length;
  const out: Stagnant[] = [];

  for (const t of alive(snap.tasks)) {
    if (t.status === 'done') continue;
    const d = deferrals(`tasks:${t.id}`);
    const days = since(t.updatedAt, now);
    if (d >= 3 || days >= 14)
      out.push({ kind: 'task', id: t.id, title: t.title, days, deferrals: d, noNextStep: false });
  }

  for (const p of alive(snap.projects)) {
    if (p.status !== 'active') continue;
    const tasks = alive(snap.tasks).filter((t) => t.projectId === p.id);
    const last = [p.updatedAt, ...tasks.map((t) => t.completedAt ?? t.updatedAt)]
      .filter((x): x is string => Boolean(x))
      .sort()
      .pop();
    const days = since(last, now);
    const noNext = isStalled(p, snap.tasks);
    if (days >= 11 || noNext)
      out.push({ kind: 'project', id: p.id, title: p.name, days, deferrals: 0, noNextStep: noNext });
  }

  for (const m of alive(snap.missions)) {
    if (m.status !== 'active') continue;
    const last = [...(m.log ?? []).map((l) => `${l.date}T12:00:00`), m.createdAt].sort().pop();
    const days = since(last, now);
    if (days >= 7)
      out.push({
        kind: 'mission',
        id: m.id,
        title: m.title,
        days,
        deferrals: deferrals(`missions:${m.id}`),
        noNextStep: false,
      });
  }

  return out.sort((a, b) => b.days + b.deferrals * 3 - (a.days + a.deferrals * 3)).slice(0, 6);
}
