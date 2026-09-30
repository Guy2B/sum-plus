import { describe, expect, it } from 'vitest';
import { interpret } from '../src/domain/command';
import { NOW } from './fixtures';

describe('one bar: capture, plan, ask', () => {
  it('reads a clock time as an event, not as 13 hours of work', () => {
    const r = interpret('déjeuner vendredi 13h avec Marc', NOW);
    expect(r.kind).toBe('event');
    if (r.kind !== 'event') return;
    expect(r.title).toBe('déjeuner avec Marc');
    expect(r.start.getDay()).toBe(5);
    expect(r.start.getHours()).toBe(13);
    expect((r.end.getTime() - r.start.getTime()) / 60_000).toBe(60);
  });

  it('keeps durations as durations and plain captures as tasks', () => {
    const r = interpret('rappeler assurance mardi 20min', NOW);
    expect(r.kind).toBe('task');
    if (r.kind === 'task') {
      expect(r.captured.estimateMinutes).toBe(20);
      expect(r.captured.dueDate).toBe('2026-10-06');
    }
    expect(interpret('préparer le devis 2h', NOW).kind).toBe('task');
  });

  it('understands today’s constraints', () => {
    expect(interpret('je suis épuisé aujourd’hui', NOW)).toEqual({ kind: 'day', energy: 'low' });
    expect(interpret('il me reste 2h', NOW)).toEqual({ kind: 'day', minutesLeft: 120 });
    expect(interpret('je dois partir à 15h aujourd’hui', NOW)).toMatchObject({ kind: 'day', endAt: '15:00' });
    expect(interpret('I’m full of energy', NOW)).toMatchObject({ kind: 'day', energy: 'high' });
  });

  it('sends questions to the coach and preparations to missions', () => {
    expect(interpret('que dois-je abandonner cette semaine ?', NOW).kind).toBe('ask');
    expect(interpret('What can wait', NOW).kind).toBe('ask');
    expect(interpret('contrôle de maths jeudi', NOW)).toMatchObject({ kind: 'mission', mission: 'exam' });
    expect(interpret('call with Anna at 9', NOW).kind).toBe('event');
  });
});
