import { describe, expect, it } from 'vitest';
import { diffDay } from '../src/services/autosync';
import { morningTime } from '../src/services/native-notify';
import { NeedsUserError, isSilent, silently } from '../src/services/connectors/mode';
import type { CalendarEvent } from '../src/domain/types';
import { NOW, doc } from './fixtures';

const at = (h: number, m = 0) => {
  const d = new Date(NOW);
  d.setHours(h, m, 0, 0);
  return d;
};
const ev = (id: string, h: number, minutes: number): CalendarEvent => ({
  ...doc({
    title: id,
    start: at(h).toISOString(),
    end: new Date(at(h).getTime() + minutes * 60_000).toISOString(),
  }),
  id,
});

describe('automatic sources', () => {
  it('speaks up only when a new event today pushes planned work out', () => {
    const before = [ev('standup', 9, 30)];
    const after = [...before, ev('Client call', 14, 60)];
    const change = diffDay(before, after, ['Devis', 'Homepage'], ['Devis'], at(8));
    expect(change?.events).toEqual([{ title: 'Client call', start: at(14).toISOString(), minutes: 60 }]);
    expect(change?.dropped).toEqual(['Homepage']);
    // A new event that breaks nothing, or nothing new: stay quiet.
    expect(diffDay(before, after, ['Devis'], ['Devis'], at(8))).toBeNull();
    expect(diffDay(after, after, ['Devis', 'Homepage'], ['Devis'], at(8))).toBeNull();
    // Events already over do not count.
    expect(diffDay(before, after, ['Devis', 'Homepage'], ['Devis'], at(16))).toBeNull();
  });

  it('runs connectors in silent mode only inside an automatic sync', async () => {
    expect(isSilent()).toBe(false);
    await silently(async () => {
      expect(isSilent()).toBe(true);
    });
    expect(isSilent()).toBe(false);
    expect(new NeedsUserError('google').source).toBe('google');
  });

  it('wakes the phone 15 minutes before the work day', () => {
    expect(morningTime('09:00')).toEqual({ hour: 8, minute: 45 });
    expect(morningTime('08:10')).toEqual({ hour: 7, minute: 55 });
    expect(morningTime(undefined)).toEqual({ hour: 8, minute: 45 });
  });
});
