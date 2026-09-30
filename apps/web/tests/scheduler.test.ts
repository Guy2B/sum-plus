import { describe, expect, it } from 'vitest';
import type { Signal } from '../src/domain/signals';
import type { CalendarEvent } from '../src/domain/types';
import { rankSignals } from '../src/domain/decision';
import { comparePlans, overloadAvoided, scheduleDay } from '../src/domain/scheduler';
import { NOW, doc, hoursFrom } from './fixtures';

const ctx = { workStart: '09:00', workEnd: '18:00', energyPeak: 'morning' as const };
const at = (h: number, m = 0) => {
  const d = new Date(NOW);
  d.setHours(h, m, 0, 0);
  return d;
};
const event = (id: string, start: Date, minutes: number): CalendarEvent => ({
  ...doc({
    title: id,
    start: start.toISOString(),
    end: new Date(start.getTime() + minutes * 60_000).toISOString(),
  }),
  id,
});
const task = (id: string, minutes: number, over: Partial<Signal> = {}): Signal => ({
  id: `tasks:${id}`,
  sourceType: 'task',
  domain: 'core',
  ref: { collection: 'tasks', id },
  title: id,
  createdAt: hoursFrom(NOW, -2),
  userCreated: true,
  estimateMinutes: minutes,
  ...over,
});
const titles = (xs: { decision: { signal: { title?: string } } }[]) => xs.map((x) => x.decision.signal.title);

describe('day planner', () => {
  const signals = [
    task('urgent', 30, { dueAt: hoursFrom(NOW, 5), important: true }),
    task('deep', 90, { important: true }),
    task('mail', 10),
    task('admin', 20),
  ];
  const ranked = rankSignals(signals, { edition: 'solo' }, NOW);
  const events = [event('standup', at(9, 30), 30), event('lunch', at(12), 60), event('client', at(14), 120)];

  it('fits everything around meetings, must-do first, deep work in the morning peak', () => {
    const plan = scheduleDay(ranked, events, ctx, at(9));
    expect(plan.left).toHaveLength(0);
    const first = plan.blocks.find((b) => b.decision.signal.title === 'urgent')!;
    const deep = plan.blocks.filter((b) => b.decision.signal.title === 'deep');
    expect(first.start.getHours()).toBe(9);
    expect(deep[0]!.start.getHours()).toBeLessThan(12);
    // No block overlaps a meeting.
    for (const b of plan.blocks)
      for (const e of plan.events)
        expect(b.end <= new Date(e.start) || b.start >= new Date(e.end)).toBe(true);
  });

  it('what if I only have 1 hour: keeps the urgent item and says what is dropped', () => {
    const base = scheduleDay(ranked, events, ctx, at(9));
    const short = scheduleDay(ranked, events, ctx, at(9), { maxMinutes: 60 });
    expect(titles(short.blocks)).toContain('urgent');
    expect(short.usedMinutes).toBeLessThanOrEqual(60);
    expect(titles(short.left)).toContain('deep');
    expect(short.left.find((l) => l.decision.signal.title === 'deep')?.reason).toBe('budget');
    expect(comparePlans(base, short).dropped.map((d) => d.signal.title)).toContain('deep');
    expect(comparePlans(base, short).dropped.map((d) => d.signal.title)).not.toContain('urgent');
  });

  it('counts as overload avoided only pressing work that does not fit, never someday items', () => {
    expect(overloadAvoided(scheduleDay(ranked, events, ctx, at(9)))).toBe(0);
    const pressing = [...signals, task('report', 120, { dueAt: hoursFrom(NOW, 30) }), task('someday', 240)];
    const plan = scheduleDay(rankSignals(pressing, { edition: 'solo' }, NOW), events, ctx, at(9), {
      maxMinutes: 60,
    });
    const avoided = overloadAvoided(plan);
    // Only work due within three days counts; the 240-minute "someday" item never does.
    expect(avoided).toBeGreaterThanOrEqual(120);
    expect(avoided).toBeLessThan(120 + 90 + 20 + 10 + 240);
  });

  it("what if I'm tired: no long deep work, short things first", () => {
    const plan = scheduleDay(ranked, events, ctx, at(9), { tired: true });
    expect(plan.left.find((l) => l.decision.signal.title === 'deep')?.reason).toBe('tired');
    expect(titles(plan.blocks)).toEqual(expect.arrayContaining(['urgent', 'mail', 'admin']));
  });

  it('what if a meeting is cancelled or I stop at 16:00', () => {
    const late = scheduleDay(ranked, events, ctx, at(15));
    const freed = scheduleDay(ranked, events, ctx, at(15), { skipEvents: ['client'] });
    expect(freed.freeMinutes).toBeGreaterThan(late.freeMinutes);
    const early = scheduleDay(ranked, events, ctx, at(9), { endAt: '11:00' });
    expect(early.blocks.every((b) => b.end <= at(11))).toBe(true);
    expect(early.left.length).toBeGreaterThan(0);
  });

  it('splits long work across the remaining windows when no single window fits', () => {
    const busy = [event('a', at(9, 45), 60), event('b', at(11, 30), 60)];
    // Only two 45-minute windows before 12:30: the 90 minutes must be split.
    const plan = scheduleDay(rankSignals([task('report', 90)], { edition: 'solo' }, NOW), busy, ctx, at(9), {
      endAt: '12:30',
    });
    const parts = plan.blocks.filter((b) => b.decision.signal.title === 'report');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.reduce((a, b) => a + (b.end.getTime() - b.start.getTime()) / 60_000, 0)).toBe(90);
  });

  it('prepares a meeting before it starts, never after', () => {
    const meeting = event('demo', at(10), 60);
    const prep: Signal = {
      id: 'events:demo',
      sourceType: 'event',
      domain: 'calendar',
      ref: { collection: 'events', id: 'demo' },
      title: 'Demo',
      dueAt: at(10).toISOString(),
      estimateMinutes: 20,
      createdAt: hoursFrom(NOW, -5),
    };
    const plan = scheduleDay(rankSignals([prep], { edition: 'solo' }, NOW), [meeting], ctx, at(9));
    const block = plan.blocks.find((b) => b.decision.signal.id === 'events:demo')!;
    expect(block.end <= at(10)).toBe(true);
  });
});
