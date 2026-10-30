/**
 * Cortex: pure logic (no I/O) for days, time blocks, notes and the weekly
 * review. Everything here is computed from the shared NEXT snapshot so both
 * apps read the same tasks, projects, habits and calendar.
 */
import type {
  BlockCategory,
  CalendarEvent,
  DayPlan,
  ISODate,
  Note,
  Snapshot,
  Task,
  TimeBlock,
} from '../domain/types';
import type { PlanBlock } from '../domain/planning';
import { addDays, isoDay, startOfWeek, toDate } from '../domain/dates';
import { habitsOnDay, indexLogs } from '../domain/habits';

export const SNAP = 15;
export const DEFAULT_DAY = { start: 7 * 60, end: 22 * 60 };

export const CATEGORIES: BlockCategory[] = [
  'focus',
  'meeting',
  'admin',
  'writing',
  'personal',
  'sport',
  'break',
];
/** Categories that count as deep work in the stats. */
export const DEEP: ReadonlySet<BlockCategory> = new Set(['focus', 'writing']);

export const alive = <T extends { deletedAt?: string | null }>(rows: T[]): T[] =>
  rows.filter((r) => !r.deletedAt);

/* --------------------------------- dates ---------------------------------- */

export const parseDay = (k: ISODate): Date => new Date(`${k}T12:00:00`);
export const shiftDay = (k: ISODate, n: number): ISODate => isoDay(addDays(parseDay(k), n));
export const minutesOfDay = (d: Date): number => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
export const snapTo = (m: number): number => Math.round(m / SNAP) * SNAP;
export const floorTo = (m: number): number => Math.floor(m / SNAP) * SNAP;
export const ceilTo = (m: number): number => Math.ceil(m / SNAP) * SNAP;

export function hhmm(m: number): string {
  const r = Math.round(m);
  return `${String(Math.floor(r / 60) % 24).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
}

export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 24 * 60 ? v : null;
}

/* ---------------------------------- days ---------------------------------- */

export function emptyDay(date: ISODate): Omit<DayPlan, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> {
  return {
    date,
    intention: '',
    priorities: [
      { title: '', done: false },
      { title: '', done: false },
      { title: '', done: false },
    ],
    blocks: [],
    review: { energy: null, wins: '', next: '' },
  };
}

export function dayOf(snap: Snapshot, date: ISODate): DayPlan | undefined {
  return snap.days.find((d) => d.id === date && !d.deletedAt);
}

export const sortBlocks = (blocks: TimeBlock[]): TimeBlock[] =>
  [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);

/** Calendar events of that day as read-only blocks (minutes from midnight). */
export interface EventBlock {
  id: string;
  title: string;
  start: number;
  end: number;
}

export function eventBlocks(events: CalendarEvent[], date: ISODate): EventBlock[] {
  const out: EventBlock[] = [];
  for (const e of alive(events)) {
    if (e.allDay) continue;
    const s = toDate(e.start);
    const en = toDate(e.end) ?? s;
    if (!s || !en || isoDay(s) !== date) continue;
    const start = minutesOfDay(s);
    const end = isoDay(en) === date ? minutesOfDay(en) : 24 * 60;
    if (end > start) out.push({ id: e.id, title: e.title, start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Visible window: the configured day, widened to whatever is planned outside it. */
export function viewRange(
  blocks: { start: number; end: number }[],
  base: { start: number; end: number } = DEFAULT_DAY,
): [number, number] {
  let s = base.start;
  let e = base.end;
  for (const b of blocks) {
    s = Math.min(s, Math.floor(b.start / 60) * 60);
    e = Math.max(e, Math.ceil(b.end / 60) * 60);
  }
  return [Math.max(0, s), Math.min(24 * 60, e)];
}

/**
 * First free slot of `len` minutes at or after `from`, inside [dayStart, dayEnd],
 * avoiding every busy interval. Null when nothing fits.
 */
export function freeSlot(
  busy: { start: number; end: number }[],
  len: number,
  from: number,
  dayEnd: number,
): number | null {
  let t = ceilTo(from);
  for (const b of [...busy].sort((a, c) => a.start - c.start)) {
    if (b.end <= t) continue;
    if (b.start - t >= len) return t;
    t = Math.max(t, ceilTo(b.end));
  }
  return t + len <= dayEnd ? t : null;
}

/** Side-by-side columns for overlapping blocks. */
export function lanes(
  items: { id: string; start: number; end: number }[],
): Record<string, { i: number; n: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Record<string, { i: number; n: number }> = {};
  let cluster: typeof sorted = [];
  let clusterEnd = -1;
  const flush = () => {
    const lane: number[] = [];
    for (const b of cluster) {
      let i = 0;
      while (lane[i] != null && lane[i]! > b.start) i++;
      lane[i] = b.end;
      out[b.id] = { i, n: 0 };
    }
    for (const b of cluster) out[b.id]!.n = lane.length;
    cluster = [];
  };
  for (const b of sorted) {
    if (b.start >= clusterEnd && cluster.length) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  if (cluster.length) flush();
  return out;
}

export function currentBlock(day: DayPlan | undefined, nowMin: number): TimeBlock | null {
  if (!day) return null;
  const live = sortBlocks(day.blocks).filter((b) => b.start <= nowMin && nowMin < b.end);
  return live.find((b) => !b.done) ?? live[0] ?? null;
}

export function nextBlock(day: DayPlan | undefined, nowMin: number): TimeBlock | null {
  if (!day) return null;
  return sortBlocks(day.blocks).find((b) => b.start > nowMin && !b.done) ?? null;
}

export interface DayStats {
  planned: number;
  deep: number;
  deepDone: number;
  done: number;
  count: number;
  byCategory: Partial<Record<BlockCategory, number>>;
}

export function dayStats(day: DayPlan | undefined): DayStats {
  const s: DayStats = { planned: 0, deep: 0, deepDone: 0, done: 0, count: 0, byCategory: {} };
  for (const b of day?.blocks ?? []) {
    const m = Math.max(0, b.end - b.start);
    s.planned += m;
    s.count += 1;
    s.byCategory[b.category] = (s.byCategory[b.category] ?? 0) + m;
    if (b.done) s.done += 1;
    if (DEEP.has(b.category)) {
      s.deep += m;
      if (b.done) s.deepDone += m;
    }
  }
  return s;
}

/**
 * Turns Σ's suggested plan (decisions and today's tasks laid into the work
 * window) into editable blocks, keeping only what fits around existing blocks.
 */
export function blocksFromPlan(
  plan: PlanBlock[],
  existing: TimeBlock[],
  label: (b: PlanBlock) => string,
  newId: () => string,
): TimeBlock[] {
  const busy = existing.map((b) => ({ start: b.start, end: b.end }));
  const out: TimeBlock[] = [];
  for (const p of plan) {
    if (p.kind === 'event') continue;
    const s = toDate(p.start);
    const e = toDate(p.end);
    if (!s || !e) continue;
    const start = Math.round(minutesOfDay(s));
    const end = Math.round(minutesOfDay(e));
    if (end <= start || busy.some((b) => b.start < end && start < b.end)) continue;
    const taskId = p.ref?.collection === 'tasks' ? p.ref.id : null;
    if (taskId && existing.some((b) => b.taskId === taskId)) continue;
    const block: TimeBlock = {
      id: newId(),
      title: label(p),
      start,
      end,
      category: p.kind === 'break' ? 'break' : 'focus',
      done: false,
      taskId,
    };
    out.push(block);
    busy.push({ start, end });
  }
  return out;
}

/* ---------------------------------- tasks --------------------------------- */

export const isOpen = (t: Task): boolean => !t.deletedAt && t.status !== 'done';
const dueDay = (t: Task): ISODate | null => (t.dueDate ? String(t.dueDate).slice(0, 10) : null);

/**
 * Tasks belonging to a day. Today follows NEXT exactly (essential, starred,
 * in progress, or due today or earlier); other days show what is due that day.
 */
export function isForDay(t: Task, date: ISODate, today: ISODate): boolean {
  if (!isOpen(t)) return false;
  const due = dueDay(t);
  if (date === today)
    return Boolean(
      t.essential || t.scheduledFor === 'today' || t.status === 'doing' || (due && due <= today),
    );
  return due === date;
}

export function isLate(t: Task, today: ISODate): boolean {
  const due = dueDay(t);
  return isOpen(t) && Boolean(due && due < today);
}

export function sortTasks(a: Task, b: Task): number {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const da = dueDay(a) ?? '9999';
  const db = dueDay(b) ?? '9999';
  return (
    Number(a.status === 'done') - Number(b.status === 'done') ||
    rank[a.priority] - rank[b.priority] ||
    da.localeCompare(db) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

export const completedOn = (t: Task, date: ISODate): boolean =>
  t.status === 'done' && Boolean(t.completedAt) && isoDay(new Date(t.completedAt as string)) === date;

/* ---------------------------------- notes --------------------------------- */

const LINK = /\[\[([^\]\n]{1,80})\]\]/g;

export function linksIn(body: string): string[] {
  return [...new Set([...body.matchAll(LINK)].map((m) => m[1]!.trim()).filter(Boolean))];
}

const norm = (s: string) => s.trim().toLocaleLowerCase();

export function noteByTitle(notes: Note[], title: string): Note | undefined {
  const t = norm(title);
  return alive(notes).find((n) => norm(n.title) === t);
}

export function backlinks(notes: Note[], note: Note): Note[] {
  const t = norm(note.title);
  if (!t) return [];
  return alive(notes).filter((n) => n.id !== note.id && linksIn(n.body).some((l) => norm(l) === t));
}

export const wordCount = (s: string): number => (s.trim().match(/\S+/g) ?? []).length;

export function parseTags(s: string): string[] {
  return [
    ...new Set(
      s
        .split(/[\s,]+/)
        .map((t) => t.replace(/^#/, '').trim())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

/* --------------------------------- review --------------------------------- */

export interface ReviewDay {
  date: ISODate;
  future: boolean;
  habitsPct: number | null;
  deepDone: number;
  tasksDone: number;
  energy: number | null;
  wins: string;
}

export interface WeekReview {
  start: ISODate;
  days: ReviewDay[];
  habitsAvg: number | null;
  deepDone: number;
  tasksDone: number;
  energyAvg: number | null;
  /** Projects with completed tasks this week, most active first. */
  projects: { id: string; count: number }[];
}

export function weekReview(snap: Snapshot, anyDayOfWeek: Date, now: Date): WeekReview {
  const monday = startOfWeek(anyDayOfWeek);
  const today = isoDay(now);
  const idx = indexLogs(snap.habitLogs);
  const habits = alive(snap.habits);
  const tasks = alive(snap.tasks);
  const days: ReviewDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const k = isoDay(d);
    const future = k > today;
    const h = habitsOnDay(habits, idx, d);
    const plan = dayOf(snap, k);
    days.push({
      date: k,
      future,
      habitsPct: !future && h.due ? Math.round((h.done / h.due) * 100) : null,
      deepDone: dayStats(plan).deepDone,
      tasksDone: tasks.filter((t) => completedOn(t, k)).length,
      energy: plan?.review.energy ?? null,
      wins: plan?.review.wins.trim() ?? '',
    });
  }
  const past = days.filter((d) => !d.future);
  const hp = past.filter((d) => d.habitsPct != null);
  const en = past.filter((d) => d.energy);
  const start = isoDay(monday);
  const end = isoDay(addDays(monday, 6));
  const byProject = new Map<string, number>();
  for (const t of tasks) {
    if (t.status !== 'done' || !t.completedAt || !t.projectId) continue;
    const k = isoDay(new Date(t.completedAt));
    if (k >= start && k <= end) byProject.set(t.projectId, (byProject.get(t.projectId) ?? 0) + 1);
  }
  return {
    start,
    days,
    habitsAvg: hp.length ? Math.round(hp.reduce((a, d) => a + (d.habitsPct ?? 0), 0) / hp.length) : null,
    deepDone: past.reduce((a, d) => a + d.deepDone, 0),
    tasksDone: past.reduce((a, d) => a + d.tasksDone, 0),
    energyAvg: en.length ? en.reduce((a, d) => a + (d.energy ?? 0), 0) / en.length : null,
    projects: [...byProject.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count),
  };
}
