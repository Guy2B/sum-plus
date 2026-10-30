import { describe, expect, it } from 'vitest';
import {
  bestStreak,
  doneOn,
  habitDays,
  habitsOnDay,
  indexLogs,
  isHabitDue,
  perfectDays,
  streak,
  successRate,
  valueOn,
} from '../src/domain/habits';
import { habitStreak } from '../src/domain/wellbeing';
import {
  backlinks,
  blocksFromPlan,
  currentBlock,
  dayStats,
  eventBlocks,
  freeSlot,
  hhmm,
  isForDay,
  lanes,
  linksIn,
  noteByTitle,
  parseHHMM,
  parseTags,
  viewRange,
  weekReview,
} from '../src/cortex/model';
import type { DayPlan, Habit, HabitLog, Note, Task, TimeBlock } from '../src/domain/types';
import { doc, NOW, snapshot } from './fixtures';

// NOW = Wed 30 Sep 2026, 08:00 (Europe/Paris).
const created = new Date('2026-09-01T09:00:00');
const habit = (f: Partial<Habit> = {}) =>
  doc({ name: 'Walk', cadence: 'daily', domain: 'health', ...f } as Habit, created) as Habit;
const log = (h: Habit, date: string, f: Partial<HabitLog> = {}) =>
  doc({ habitId: h.id, date, ...f } as HabitLog, new Date(`${date}T20:00:00`)) as HabitLog;

describe('habits (shared by NEXT and Cortex)', () => {
  it('derives scheduled days from cadence or explicit days', () => {
    expect(habitDays(habit())).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(habitDays(habit({ cadence: 'weekdays' }))).toEqual([0, 1, 2, 3, 4]);
    expect(habitDays(habit({ days: [5, 6, 6] }))).toEqual([5, 6]);
    expect(isHabitDue(habit({ days: [5, 6] }), NOW)).toBe(false); // Wednesday
    expect(isHabitDue(habit({ days: [2] }), NOW)).toBe(true);
  });

  it('counts a quantity habit as done only once the target is reached', () => {
    const h = habit({ target: 8 });
    const idx = indexLogs([log(h, '2026-09-29', { value: 5 }), log(h, '2026-09-28', { value: 8 })]);
    expect(valueOn(idx, h, '2026-09-29')).toBe(5);
    expect(doneOn(idx, h, '2026-09-29')).toBe(false);
    expect(doneOn(idx, h, '2026-09-28')).toBe(true);
  });

  it('keeps old logs meaning "done" and NEXT streaks unchanged', () => {
    const h = habit();
    const logs = ['2026-09-27', '2026-09-28', '2026-09-29'].map((d) => log(h, d));
    expect(habitStreak(h, logs, NOW)).toBe(3);
  });

  it('a passed day neither counts nor breaks the streak; an open today does not break it', () => {
    const h = habit();
    const idx = indexLogs([
      log(h, '2026-09-26'),
      log(h, '2026-09-27'),
      log(h, '2026-09-28', { skipped: true, value: 0 }),
      log(h, '2026-09-29'),
    ]);
    expect(streak(h, idx, NOW)).toBe(3);
    expect(bestStreak(h, idx, NOW)).toBe(3);
  });

  it('skips rest days in streaks and rates', () => {
    const h = habit({ days: [0, 2, 4] }); // Mon, Wed, Fri
    const idx = indexLogs([log(h, '2026-09-25'), log(h, '2026-09-28')]); // Fri, Mon
    expect(streak(h, idx, NOW)).toBe(2);
    expect(successRate(h, idx, NOW, 7)).toBe(100); // today open is ignored
  });

  it('summarises a day and perfect days', () => {
    const a = habit();
    const b = habit({ target: 2 });
    const idx = indexLogs([log(a, '2026-09-29'), log(b, '2026-09-29', { value: 2 }), log(a, '2026-09-30')]);
    expect(habitsOnDay([a, b], idx, NOW)).toEqual({ due: 2, done: 1 });
    expect(perfectDays([a, b], idx, NOW)).toBe(1);
  });

  it('a deleted log no longer counts', () => {
    const h = habit();
    const l = { ...log(h, '2026-09-29'), deletedAt: '2026-09-29T21:00:00Z' };
    expect(doneOn(indexLogs([l]), h, '2026-09-29')).toBe(false);
  });
});

const block = (id: string, start: number, end: number, f: Partial<TimeBlock> = {}): TimeBlock => ({
  id,
  title: id,
  start,
  end,
  category: 'focus',
  done: false,
  ...f,
});

describe('Cortex day planning', () => {
  it('formats and parses times', () => {
    expect(hhmm(9 * 60 + 5)).toBe('09:05');
    expect(parseHHMM('14:30')).toBe(870);
    expect(parseHHMM('nope')).toBeNull();
  });

  it('finds the first free slot around busy blocks, snapped to 15 minutes', () => {
    const busy = [block('a', 540, 600), block('b', 630, 700)];
    expect(freeSlot(busy, 30, 530, 1200)).toBe(600);
    expect(freeSlot(busy, 45, 530, 1200)).toBe(705);
    expect(freeSlot(busy, 600, 530, 1200)).toBeNull();
  });

  it('puts overlapping blocks side by side', () => {
    const l = lanes([block('a', 540, 600), block('b', 570, 630), block('c', 700, 760)]);
    expect(l.a).toEqual({ i: 0, n: 2 });
    expect(l.b).toEqual({ i: 1, n: 2 });
    expect(l.c).toEqual({ i: 0, n: 1 });
  });

  it('widens the visible window to what is planned', () => {
    expect(viewRange([block('a', 6 * 60 + 30, 7 * 60)], { start: 480, end: 1260 })).toEqual([360, 1260]);
  });

  it('computes stats and the current block', () => {
    const day = {
      blocks: [block('a', 480, 600, { done: true }), block('b', 600, 660, { category: 'meeting' })],
    } as DayPlan;
    const s = dayStats(day);
    expect(s).toMatchObject({ planned: 180, deep: 120, deepDone: 120, done: 1, count: 2 });
    expect(currentBlock(day, 610)?.id).toBe('b');
  });

  it("turns Σ's plan into blocks without overlapping or duplicating", () => {
    const at = (h: number, m = 0) => new Date(2026, 8, 30, h, m).toISOString();
    const plan = [
      {
        start: at(9),
        end: at(10),
        kind: 'focus' as const,
        title: 'Report',
        ref: { collection: 'tasks', id: 't1' },
      },
      { start: at(10), end: at(10, 30), kind: 'focus' as const, title: 'Clash' },
      { start: at(11), end: at(12), kind: 'event' as const, title: 'Meeting' },
      { start: at(12), end: at(12, 15), kind: 'break' as const },
    ];
    let n = 0;
    const out = blocksFromPlan(
      plan,
      [block('x', 615, 645)],
      (b) => b.title ?? 'Pause',
      () => `n${++n}`,
    );
    expect(out.map((b) => [b.title, b.start, b.category, b.taskId])).toEqual([
      ['Report', 540, 'focus', 't1'],
      ['Pause', 720, 'break', null],
    ]);
  });

  it('reads calendar events of the day as read-only blocks', () => {
    const ev = doc({
      title: 'Call',
      start: new Date(2026, 8, 30, 14).toISOString(),
      end: new Date(2026, 8, 30, 15).toISOString(),
    });
    expect(eventBlocks([ev] as never, '2026-09-30')).toEqual([
      { id: ev.id, title: 'Call', start: 840, end: 900 },
    ]);
    expect(eventBlocks([ev] as never, '2026-10-01')).toEqual([]);
  });

  it('matches NEXT on what belongs to today', () => {
    const t = (f: Partial<Task>) =>
      doc({ title: 'x', category: 'work', status: 'todo', priority: 'medium', ...f } as Task) as Task;
    expect(isForDay(t({ scheduledFor: 'today' }), '2026-09-30', '2026-09-30')).toBe(true);
    expect(isForDay(t({ dueDate: '2026-09-28' }), '2026-09-30', '2026-09-30')).toBe(true);
    expect(isForDay(t({ dueDate: '2026-10-02' }), '2026-10-02', '2026-09-30')).toBe(true);
    expect(isForDay(t({ dueDate: '2026-10-02' }), '2026-09-30', '2026-09-30')).toBe(false);
    expect(isForDay(t({ status: 'done', scheduledFor: 'today' }), '2026-09-30', '2026-09-30')).toBe(false);
  });
});

describe('Cortex notes', () => {
  const note = (title: string, body = '') =>
    doc({ title, body, kind: 'note', tags: [] } as unknown as Note) as Note;

  it('extracts [[links]], finds targets case-insensitively and backlinks', () => {
    const a = note('Plan', 'See [[Characters]] and [[characters]] and [[Plan B]]');
    const b = note('characters', 'Back to [[plan]]');
    expect(linksIn(a.body)).toEqual(['Characters', 'characters', 'Plan B']);
    expect(noteByTitle([a, b], 'CHARACTERS')?.id).toBe(b.id);
    expect(backlinks([a, b], a).map((n) => n.id)).toEqual([b.id]);
  });

  it('parses tags', () => {
    expect(parseTags('#roman, idée #roman  port')).toEqual(['roman', 'idée', 'port']);
  });
});

describe('Cortex weekly review', () => {
  it('aggregates habits, focus, tasks, energy and projects', () => {
    const h = habit();
    const day = doc({
      date: '2026-09-29',
      intention: '',
      priorities: [],
      blocks: [
        block('a', 540, 630, { done: true }),
        block('b', 630, 700, { category: 'writing', done: true }),
      ],
      review: { energy: 4, wins: 'Shipped it', next: '' },
    }) as DayPlan;
    day.id = '2026-09-29';
    const task = doc({
      title: 't',
      category: 'work',
      status: 'done',
      priority: 'medium',
      projectId: 'p1',
      completedAt: new Date(2026, 8, 29, 18).toISOString(),
    }) as Task;
    const r = weekReview(
      snapshot({ habits: [h], habitLogs: [log(h, '2026-09-29')], days: [day], tasks: [task] }),
      NOW,
      NOW,
    );
    expect(r.start).toBe('2026-09-28');
    const tue = r.days[1]!;
    expect(tue).toMatchObject({ habitsPct: 100, deepDone: 160, tasksDone: 1, energy: 4, wins: 'Shipped it' });
    expect(r.days[3]!.future).toBe(true);
    expect(r.projects).toEqual([{ id: 'p1', count: 1 }]);
    expect(r.energyAvg).toBe(4);
  });
});

describe('review fixes: weekly habits, back-filled days, one log per day', () => {
  it('keeps weekly habits out of the per-day counts and perfect days', () => {
    const daily = habit();
    const weekly = habit({ cadence: 'weekly' });
    const logs: HabitLog[] = [];
    for (let i = 1; i <= 29; i++) logs.push(log(daily, `2026-09-${String(i).padStart(2, '0')}`));
    logs.push(log(weekly, '2026-09-29'));
    const idx = indexLogs(logs);
    expect(habitsOnDay([daily, weekly], idx, new Date('2026-10-01T09:00:00'))).toEqual({ due: 1, done: 0 });
    expect(perfectDays([daily, weekly], idx, NOW)).toBe(29);
    expect(isHabitDue(weekly, NOW)).toBe(false); // Wednesday: NEXT shows weekly habits on Mondays
    expect(streak(weekly, idx, NOW)).toBe(1);
  });

  it('counts back-filled days before creation in the best streak', () => {
    const h = habit();
    (h as { createdAt: string }).createdAt = new Date('2026-09-28T09:00:00').toISOString();
    const logs = Array.from({ length: 15 }, (_, i) => log(h, `2026-09-${String(15 + i).padStart(2, '0')}`));
    const idx = indexLogs(logs);
    expect(streak(h, idx, NOW)).toBe(15);
    expect(bestStreak(h, idx, NOW)).toBe(15);
  });
});

describe('habit writes (shared by NEXT and Cortex)', () => {
  it('folds duplicate logs into one, so an undo never resurrects an older log', async () => {
    const { initStore, create, snapshot } = await import('../src/data/store');
    const { writeHabitDay } = await import('../src/data/habits');
    await initStore();
    const h = await create('habits', { name: 'Water', cadence: 'daily', domain: 'health', target: 8 });
    await create('habitLogs', { habitId: h.id, date: '2026-09-30', value: 3 });
    await new Promise((r) => setTimeout(r, 5));
    await create('habitLogs', { habitId: h.id, date: '2026-09-30', value: 8 });
    const live = () => snapshot.value.habitLogs.filter((l) => !l.deletedAt && l.habitId === h.id);
    await writeHabitDay(h, '2026-09-30', { value: 0 });
    expect(live()).toEqual([]);
    await writeHabitDay(h, '2026-09-30', { value: 2 });
    expect(live().map((l) => l.value)).toEqual([2]);
    await writeHabitDay(h, '2026-09-30', { value: 0, skipped: true });
    expect(live()).toHaveLength(1);
    expect(live()[0]).toMatchObject({ skipped: true, value: 0 });
  });
});
