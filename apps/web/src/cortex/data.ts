/**
 * Cortex writes. Everything goes through the shared NEXT store (IndexedDB +
 * sync outbox), so a task ticked here is ticked in NEXT and on every device.
 */
import { computed, signal } from '@preact/signals';
import type { DayPlan, Habit, ISODate, Note, Task, TimeBlock } from '../domain/types';
import { create, settings, snapshot, update, clock } from '../data/store';
import { newId } from '../domain/ids';
import { isoDay } from '../domain/dates';
import { parseCapture } from '../domain/capture';
import { habitTarget, indexLogs, logOn } from '../domain/habits';
import { dayOf, emptyDay } from './model';

/* --------------------------------- reads ---------------------------------- */

export const today = computed(() => isoDay(clock.value));
export const habitIndex = computed(() => indexLogs(snapshot.value.habitLogs));
export const liveHabits = computed(() =>
  snapshot.value.habits
    .filter((h) => !h.deletedAt && !h.archived)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt)),
);
export const liveTasks = computed(() => snapshot.value.tasks.filter((t) => !t.deletedAt));
export const liveProjects = computed(() => snapshot.value.projects.filter((p) => !p.deletedAt));
export const liveNotes = computed(() => snapshot.value.notes.filter((n) => !n.deletedAt));

/** The day window from the user's NEXT context (work hours), widened for a personal day. */
export const dayWindow = computed(() => {
  const ctx = settings.value.context;
  const toMin = (s: string | undefined, d: number) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(s ?? '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : d;
  };
  const start = Math.min(toMin(ctx.workStart, 9 * 60) - 60, 8 * 60);
  const end = Math.max(toMin(ctx.workEnd, 18 * 60) + 3 * 60, 21 * 60);
  return {
    start: Math.max(0, Math.floor(start / 60) * 60),
    end: Math.min(24 * 60, Math.ceil(end / 60) * 60),
  };
});

/* ---------------------------------- days ---------------------------------- */

/** Pending day writes, so fast typing never loses a keystroke to a stale snapshot. */
const pending = new Map<ISODate, DayPlan>();
const timers = new Map<ISODate, ReturnType<typeof setTimeout>>();

export function getDay(date: ISODate): DayPlan {
  return (
    pending.get(date) ??
    dayOf(snapshot.value, date) ?? {
      id: date,
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
      ...emptyDay(date),
    }
  );
}

/** Bumped on optimistic local edits so views re-read `getDay`. */
export const dayVersion = signal(0);

async function writeDay(d: DayPlan): Promise<void> {
  const exists = snapshot.value.days.some((x) => x.id === d.id);
  const { id, createdAt: _c, updatedAt: _u, deletedAt: _d, ...fields } = d;
  if (exists) await update('days', id, { ...fields, deletedAt: null });
  else await create('days', { ...fields, id });
}

/**
 * Applies `fn` to a copy of the day. `debounce` (ms) batches typing; structural
 * edits (blocks, ticks) are written at once.
 */
export async function editDay(date: ISODate, fn: (d: DayPlan) => void, debounce = 0): Promise<void> {
  const next: DayPlan = structuredClone(getDay(date));
  fn(next);
  pending.set(date, next);
  dayVersion.value++;
  clearTimeout(timers.get(date));
  if (debounce) {
    timers.set(
      date,
      setTimeout(() => void flushDay(date), debounce),
    );
    return;
  }
  await flushDay(date);
}

async function flushDay(date: ISODate): Promise<void> {
  const d = pending.get(date);
  if (!d) return;
  timers.delete(date);
  await writeDay(d);
  if (pending.get(date) === d) pending.delete(date);
}

export const newBlockId = (): string => newId('b');

export async function addBlock(date: ISODate, b: Omit<TimeBlock, 'id' | 'done'> & { done?: boolean }) {
  await editDay(date, (d) => {
    d.blocks.push({ id: newBlockId(), done: false, ...b });
  });
}

/** Ticks a block; a block linked to a task ticks the task too (and NEXT sees it). */
export async function setBlockDone(date: ISODate, blockId: string, done: boolean): Promise<void> {
  const taskId = getDay(date).blocks.find((x) => x.id === blockId)?.taskId;
  const t = taskId ? snapshot.value.tasks.find((x) => x.id === taskId) : undefined;
  // Both writes start together so closing the tab right after a tick loses neither.
  await Promise.all([
    editDay(date, (d) => {
      const b = d.blocks.find((x) => x.id === blockId);
      if (b) b.done = done;
    }),
    t && (t.status === 'done') !== done ? setTaskDone(t, done, { fromBlock: true }) : Promise.resolve(),
  ]);
}

/* ---------------------------------- tasks --------------------------------- */

export async function setTaskDone(t: Task, done: boolean, opts: { fromBlock?: boolean } = {}): Promise<void> {
  await update('tasks', t.id, {
    status: done ? 'done' : 'todo',
    completedAt: done ? new Date().toISOString() : null,
    essential: done ? false : t.essential,
  });
  if (opts.fromBlock) return;
  // Keep linked blocks (any day) in step.
  for (const d of snapshot.value.days) {
    if (d.deletedAt || !d.blocks.some((b) => b.taskId === t.id && b.done !== done)) continue;
    await editDay(d.id, (x) => {
      for (const b of x.blocks) if (b.taskId === t.id) b.done = done;
    });
  }
  // And the day's priorities.
  for (const d of snapshot.value.days) {
    if (d.deletedAt || !d.priorities.some((p) => p.taskId === t.id && p.done !== done)) continue;
    await editDay(d.id, (x) => {
      for (const p of x.priorities) if (p.taskId === t.id) p.done = done;
    });
  }
}

export interface NewTask {
  text: string;
  projectId?: string | null;
  today?: boolean;
  due?: ISODate | null;
  estimate?: number | null;
  inbox?: boolean;
}

/** Natural-language capture shared with NEXT ("Appeler Marc demain 30min !"). */
export async function captureTask(o: NewTask): Promise<Task> {
  const c = parseCapture(o.text);
  const dueDate = c.dueDate ?? o.due ?? null;
  const scheduledFor = c.scheduledFor ?? (o.today ? 'today' : null);
  const filed = Boolean(o.projectId || dueDate || scheduledFor) || o.inbox === false;
  return create('tasks', {
    title: c.title.slice(0, 300),
    category: c.category ?? (o.projectId ? 'projects' : 'work'),
    status: filed ? 'todo' : 'inbox',
    priority: c.promisedTo ? 'high' : c.priority,
    promisedTo: c.promisedTo,
    dueDate,
    scheduledFor,
    estimateMinutes: c.estimateMinutes ?? o.estimate ?? undefined,
    projectId: o.projectId ?? null,
  });
}

/* --------------------------------- habits --------------------------------- */

/**
 * One tap: a yes/no habit toggles; a quantity habit adds one (delta -1 removes
 * one). A passed day is un-passed by a tap.
 */
export async function logHabit(h: Habit, date: ISODate, delta?: number): Promise<{ completed: boolean }> {
  const log = logOn(habitIndex.value, h, date);
  const target = habitTarget(h);
  const current = log && !log.skipped ? (log.value ?? 1) : 0;
  let next: number;
  if (log?.skipped && delta == null) next = 0;
  else if (target === 1 && delta == null) next = current >= 1 ? 0 : 1;
  else next = Math.max(0, Math.min(999, current + (delta ?? 1)));
  if (log)
    await update('habitLogs', log.id, {
      value: next,
      skipped: false,
      deletedAt: next ? null : new Date().toISOString(),
    });
  else if (next) await create('habitLogs', { habitId: h.id, date, value: next });
  return { completed: current < target && next >= target };
}

export async function setHabitSkipped(h: Habit, date: ISODate, skipped: boolean): Promise<void> {
  const log = logOn(habitIndex.value, h, date);
  if (log)
    await update('habitLogs', log.id, {
      skipped,
      value: 0,
      deletedAt: skipped ? null : new Date().toISOString(),
    });
  else if (skipped) await create('habitLogs', { habitId: h.id, date, value: 0, skipped: true });
}

/** Cadence kept in step with `days` so NEXT's own screens read the habit correctly. */
export function cadenceFor(days: number[]): Habit['cadence'] {
  const s = [...days].sort().join(',');
  return s === '0,1,2,3,4' ? 'weekdays' : 'daily';
}

/* ---------------------------------- notes --------------------------------- */

export async function createNote(fields: Partial<Note> = {}): Promise<Note> {
  return create('notes', {
    title: fields.title ?? '',
    body: fields.body ?? '',
    kind: fields.kind ?? 'note',
    projectId: fields.projectId ?? null,
    pinned: false,
    tags: fields.tags ?? [],
    inbox: fields.inbox ?? false,
  });
}

const noteTimers = new Map<string, ReturnType<typeof setTimeout>>();
const notePending = new Map<string, Partial<Note>>();

/** Debounced note edits (typing). */
export function editNote(id: string, patch: Partial<Note>, debounce = 500): void {
  notePending.set(id, { ...notePending.get(id), ...patch });
  clearTimeout(noteTimers.get(id));
  noteTimers.set(
    id,
    setTimeout(() => {
      const p = notePending.get(id);
      notePending.delete(id);
      noteTimers.delete(id);
      if (p) void update('notes', id, p);
    }, debounce),
  );
}

export function flushNotes(): void {
  for (const [id, p] of notePending) {
    clearTimeout(noteTimers.get(id));
    void update('notes', id, p);
  }
  notePending.clear();
  noteTimers.clear();
}

/** Today's date as the day key used across Cortex. */
export const todayKey = (): ISODate => isoDay(new Date());
