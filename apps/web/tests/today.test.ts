import { describe, expect, it } from 'vitest';
import type { Signal } from '../src/domain/signals';
import type { CalendarEvent } from '../src/domain/types';
import { rankSignals } from '../src/domain/decision';
import { freeSlot, pickToday } from '../src/domain/today';
import { NOW, doc, hoursFrom } from './fixtures';

const ctx = { workStart: '09:00', workEnd: '18:00' };
const at = (h: number, m = 0) => {
  const d = new Date(NOW);
  d.setHours(h, m, 0, 0);
  return d;
};
const event = (start: Date, minutes: number): CalendarEvent =>
  doc({
    title: 'Meeting',
    start: start.toISOString(),
    end: new Date(start.getTime() + minutes * 60_000).toISOString(),
  });

const task = (id: string, over: Partial<Signal> = {}): Signal => ({
  id: `tasks:${id}`,
  sourceType: 'task',
  domain: 'core',
  ref: { collection: 'tasks', id },
  title: id,
  createdAt: hoursFrom(NOW, -2),
  userCreated: true,
  ...over,
});

describe('free slot', () => {
  it('finds the first free window of the requested length after now, around meetings', () => {
    const now = at(9, 5);
    const events = [event(at(9, 30), 60), event(at(11), 30)];
    const slot = freeSlot(events, ctx, now, 45)!;
    // 09:15–09:30 is too short, 10:30–11:00 too, first fit is 11:30.
    expect(slot.start.getHours()).toBe(11);
    expect(slot.start.getMinutes()).toBe(30);
    expect((slot.end.getTime() - slot.start.getTime()) / 60_000).toBe(45);
  });

  it('falls back to tomorrow morning when today is full', () => {
    const slot = freeSlot([], ctx, at(17, 50), 60)!;
    expect(slot.start.toDateString()).toBe(new Date(NOW.getTime() + 86_400_000).toDateString());
    expect(slot.start.getHours()).toBe(9);
  });
});

describe('three cards', () => {
  it('gives each card a distinct job: do now, watch, protect a slot for deep work', () => {
    const signals = [
      task('urgent', { dueAt: hoursFrom(NOW, 3), urgent: true, important: true, estimateMinutes: 10 }),
      task('deep', { dueAt: hoursFrom(NOW, 30), important: true, estimateMinutes: 90 }),
      task('week', { dueAt: hoursFrom(NOW, 72), estimateMinutes: 15 }),
      task('later', { estimateMinutes: 10 }),
    ];
    const ranked = rankSignals(signals, { edition: 'solo' }, NOW);
    const pick = pickToday(ranked, [], ctx, at(9));
    expect(pick.now?.signal.title).toBe('urgent');
    expect(pick.protect?.decision.signal.title).toBe('deep');
    expect(pick.protect?.slot).not.toBeNull();
    expect(pick.watch?.signal.title).toBe('week');
    const titles = [pick.now, pick.watch, pick.protect?.decision].map((d) => d?.signal.title);
    expect(new Set(titles).size).toBe(3);
  });
});
