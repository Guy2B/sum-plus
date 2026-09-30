/**
 * One-way conversion of the former School / Career / Skills modules into
 * missions. Idempotent and deterministic: converted sources are tombstoned and
 * mission ids derive from the source ids, so two devices converting the same
 * data produce the same missions instead of duplicates.
 */
import type { Locale, Mission, MissionTopic, PipelineItem, Snapshot } from './types';
import { isoDay, toDate } from './dates';

export interface Conversion {
  create: Omit<Mission, 'createdAt' | 'updatedAt' | 'deletedAt'>[];
  update: { id: string; pipeline: PipelineItem[] }[];
  remove: { collection: 'skills' | 'applications' | 'schoolItems'; id: string }[];
}

export const JOBSEARCH_ID = 'mig_jobsearch';
const JOBSEARCH_TITLE: Record<Locale, string> = {
  fr: 'Trouver un emploi',
  en: 'Find a job',
  de: 'Einen Job finden',
  es: 'Encontrar empleo',
};

const alive = <T extends { deletedAt?: string | null }>(rows: T[] | undefined): T[] =>
  (rows ?? []).filter((r) => !r.deletedAt);

export function convertModules(snap: Snapshot, locale: Locale, now: Date = new Date()): Conversion {
  const out: Conversion = { create: [], update: [], remove: [] };
  const existing = new Map(alive(snap.missions).map((m) => [m.id, m]));
  const today = isoDay(now);

  // Skills → "learn" missions (spaced review on the skill's resources or the skill itself).
  for (const sk of alive(snap.skills)) {
    const id = `mig_skill_${sk.id}`;
    out.remove.push({ collection: 'skills', id: sk.id });
    if (existing.has(id)) continue;
    const baseMastery = Math.min(5, Math.max(1, 1 + Math.round((sk.progress ?? 0) / 25)));
    const topics: MissionTopic[] = sk.resources.length
      ? sk.resources.map((r) => ({
          id: r.id,
          title: r.title,
          mastery: r.status === 'done' ? 4 : r.status === 'doing' ? 3 : 2,
        }))
      : [{ id: 't1', title: sk.name, mastery: baseMastery }];
    const practiced = toDate(sk.lastPracticedAt);
    out.create.push({
      id,
      kind: 'language',
      title: sk.target ? `${sk.name} (${sk.target})` : sk.name,
      status: 'active',
      minutesPerDay: 20,
      daysPerWeek: 5,
      topics,
      log: practiced ? [{ date: isoDay(practiced), minutes: 20, rating: 'good' }] : [],
    });
  }

  // Applications → a single job-search mission holding the pipeline.
  const apps = alive(snap.applications);
  if (apps.length) {
    const pipeline: PipelineItem[] = apps.map((a) => ({
      id: a.id,
      company: a.company,
      role: a.role,
      stage: a.stage,
      appliedAt: a.appliedAt ?? null,
      url: a.url,
    }));
    const current = existing.get(JOBSEARCH_ID);
    if (current) {
      const known = new Set((current.pipeline ?? []).map((p) => p.id));
      const added = pipeline.filter((p) => !known.has(p.id));
      if (added.length)
        out.update.push({ id: JOBSEARCH_ID, pipeline: [...(current.pipeline ?? []), ...added] });
    } else {
      out.create.push({
        id: JOBSEARCH_ID,
        kind: 'jobsearch',
        title: JOBSEARCH_TITLE[locale],
        status: 'active',
        minutesPerDay: 30,
        daysPerWeek: 3,
        topics: [],
        pipeline,
        log: [],
      });
    }
    for (const a of apps) out.remove.push({ collection: 'applications', id: a.id });
  }

  // Upcoming school tests → exam missions for the child.
  const members = new Map(alive(snap.household).map((h) => [h.id, h.name]));
  for (const it of alive(snap.schoolItems)) {
    if (it.kind !== 'exam' || it.done || !it.dueDate || it.dueDate < today) continue;
    const id = `mig_school_${it.id}`;
    out.remove.push({ collection: 'schoolItems', id: it.id });
    if (existing.has(id)) continue;
    const who = members.get(it.memberId) ?? null;
    out.create.push({
      id,
      kind: 'exam',
      title: it.title,
      forName: who,
      targetDate: it.dueDate,
      status: 'active',
      minutesPerDay: 20,
      daysPerWeek: 5,
      topics: [{ id: 't1', title: it.title, mastery: 2 }],
      log: [],
    });
  }
  return out;
}
