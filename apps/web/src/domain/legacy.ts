/**
 * One-way importer for data saved by the legacy V1–V8 app in
 * localStorage["sum-algbr-state-v1"]. It maps each legacy record onto the
 * canonical model so existing users keep their workspace on upgrade.
 */
import type {
  CalendarEvent,
  EditionKey,
  FinanceEntry,
  Goal,
  Habit,
  HabitLog,
  HealthMetric,
  JournalEntry,
  Project,
  Settings,
  Skill,
  Snapshot,
  Task,
  TaskCategory,
} from './types';
import { normalizeEdition } from './editions';
import { normalizeSettings } from './defaults';
import { newId } from './ids';

export const LEGACY_STORAGE_KEY = 'sum-algbr-state-v1';

type AnyRec = Record<string, unknown>;
const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : v == null ? fallback : String(v);
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
};
const arr = (v: unknown): AnyRec[] =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as AnyRec[]) : [];
const stamp = (r: AnyRec, now: string) => {
  const created = str(r.createdAt) || now;
  return { id: str(r.id) || newId(), createdAt: created, updatedAt: now, deletedAt: null };
};
const CATEGORIES: TaskCategory[] = ['work', 'home', 'health', 'projects', 'admin', 'learning', 'family'];
/** Legacy 1–10 self-ratings → 1–5. */
const scale5 = (v: unknown) => {
  const n = num(v);
  return n == null ? null : Math.max(1, Math.min(5, Math.round(n > 5 ? n / 2 : n)));
};

export interface LegacyImport {
  snapshot: Partial<Snapshot>;
  settings: Settings;
  counts: Record<string, number>;
}

export function importLegacyState(raw: unknown, now: string = new Date().toISOString()): LegacyImport | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as AnyRec;

  const tasks: Task[] = arr(s.tasks).map((t) => ({
    ...stamp(t, now),
    title: str(t.title, '—').slice(0, 500),
    category: CATEGORIES.includes(t.category as TaskCategory) ? (t.category as TaskCategory) : 'work',
    status: t.done ? 'done' : t.inbox || t.status === 'inbox' ? 'inbox' : 'todo',
    priority: t.priority === 'high' || t.priority === 'low' ? t.priority : 'medium',
    urgent: Boolean(t.urgent),
    important: Boolean(t.important),
    essential: Boolean(t.essential),
    dueDate: str(t.dueDate) || null,
    estimateMinutes: num(t.estimate) ?? undefined,
    completedAt: t.done ? str(t.completedAt) || now : null,
  }));

  const projects: Project[] = arr(s.projects).map((p) => ({
    ...stamp(p, now),
    name: str(p.name, '—'),
    description: str(p.description),
    status: p.done ? 'done' : 'active',
    milestones: arr(p.steps).map((m) => ({
      id: str(m.id) || newId(),
      title: str(m.text ?? m.title, '—'),
      done: Boolean(m.done),
    })),
  }));

  const finance: FinanceEntry[] = arr(s.finance).map((f) => ({
    ...stamp(f, now),
    date: str(f.date).slice(0, 10) || now.slice(0, 10),
    kind: f.type === 'income' ? 'income' : 'expense',
    amount: Math.round(Math.abs(Number(f.amount) || 0) * 100),
    currency: (str((s.settings as AnyRec | undefined)?.currency) || 'EUR') as FinanceEntry['currency'],
    category: str(f.category) || 'other',
    label: str(f.description ?? f.label, '—'),
    status: f.status === 'pending' || f.status === 'overdue' ? f.status : 'paid',
    taxRelevant: Boolean(f.professional),
  }));

  const health: HealthMetric[] = arr(s.health).map((h) => ({
    ...stamp(h, now),
    date: str(h.date).slice(0, 10) || now.slice(0, 10),
    sleepHours: num(h.sleep),
    energy: scale5(h.energy),
    stress: scale5(h.stress),
    steps: num(h.steps),
    activeMinutes: num(h.activeMinutes),
    restingHeartRate: num(h.restingHR),
    source: 'import',
  }));

  const journal: JournalEntry[] = arr(s.journal).map((j) => ({
    ...stamp(j, now),
    date: str(j.date).slice(0, 10) || now.slice(0, 10),
    kind: 'reflection',
    text: [str(j.text), str(j.gratitude)].filter(Boolean).join('\n\n'),
    mood: scale5(j.mood),
    tags: [],
  }));

  const resources = arr(s.learningResources);
  const skills: Skill[] = arr(s.learning).map((l) => ({
    ...stamp(l, now),
    name: str(l.name, '—'),
    target: str(l.target),
    progress: Math.max(0, Math.min(100, Number(l.progress) || 0)),
    resources: resources
      .filter((r) => !r.skillId || r.skillId === l.id)
      .map((r) => ({
        id: str(r.id) || newId(),
        title: str(r.title, '—'),
        type: (['book', 'course', 'video', 'podcast', 'article'].includes(str(r.type))
          ? r.type
          : 'article') as Skill['resources'][number]['type'],
        url: str(r.url) || undefined,
        status: r.done ? 'done' : 'todo',
      })),
  }));

  const events: CalendarEvent[] = arr(s.events).flatMap((e) => {
    const date = str(e.date);
    if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return [];
    const time = str(e.time);
    const allDay = !/^\d{2}:\d{2}/.test(time);
    const start = allDay
      ? new Date(`${date.slice(0, 10)}T00:00:00`)
      : new Date(`${date.slice(0, 10)}T${time.slice(0, 5)}:00`);
    const end = new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000));
    return [
      {
        ...stamp(e, now),
        title: str(e.title, '—'),
        start: start.toISOString(),
        end: end.toISOString(),
        allDay,
        source: { provider: 'local' },
      },
    ];
  });

  const habits: Habit[] = arr(s.habits).map((h) => ({
    ...stamp(h, now),
    name: str(h.name, '—'),
    cadence: Number(h.targetDays) > 0 && Number(h.targetDays) < 5 ? 'weekly' : 'daily',
    domain:
      h.category === 'health'
        ? 'health'
        : h.category === 'learning'
          ? 'learning'
          : h.category === 'focus'
            ? 'work'
            : 'personal',
  }));

  const habitLogs: HabitLog[] = arr(s.habitLogs)
    .filter((l) => l.done !== false && l.habitId)
    .map((l) => ({ ...stamp(l, now), habitId: str(l.habitId), date: str(l.date).slice(0, 10) }));

  const goals: Goal[] = arr(s.goals).map((g) => ({
    ...stamp(g, now),
    title: str(g.title, '—'),
    horizon: (['week', 'month', 'quarter', 'year'].includes(str(g.period))
      ? g.period
      : 'month') as Goal['horizon'],
    currentValue: num(g.progress),
    targetValue: 100,
    status: g.done ? 'achieved' : 'active',
  }));

  const legacySettings = (s.settings ?? {}) as AnyRec;
  const ctx = (s.contextProfile ?? {}) as AnyRec;
  const settings = normalizeSettings({
    name: str(legacySettings.name),
    edition: normalizeEdition(legacySettings.profile) as EditionKey,
    currency: (str(legacySettings.currency) || 'EUR') as Settings['currency'],
    onboardingComplete: Boolean(legacySettings.onboardingComplete),
    context: {
      primaryGoal: str(ctx.primaryGoal),
      secondaryGoal: str(ctx.secondaryGoal),
      successDefinition: str(ctx.successDefinition),
      weeklyHours: Number(ctx.weeklyHours) || 35,
      focusHours: Number(ctx.focusHours) || 4,
      energyPeak: (['morning', 'afternoon', 'evening'].includes(str(ctx.energyPeak))
        ? ctx.energyPeak
        : 'morning') as Settings['context']['energyPeak'],
      fixedCommitments: str(ctx.fixedCommitments),
      constraints: str(ctx.constraints),
      allowCrossAnalysis: ctx.allowCrossAnalysis !== false,
    },
  });

  const snapshot: Partial<Snapshot> = {
    tasks,
    projects,
    finance,
    health,
    journal,
    skills,
    events,
    habits,
    habitLogs,
    goals,
  };
  const counts = Object.fromEntries(Object.entries(snapshot).map(([k, v]) => [k, (v as unknown[]).length]));
  return { snapshot, settings, counts };
}
