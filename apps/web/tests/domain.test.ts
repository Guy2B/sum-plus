import { describe, expect, it } from 'vitest';
import { computeCapacity, buildDayBlocks, findConflicts, groupAttention } from '../src/domain/planning';
import { answer, detectIntent } from '../src/domain/coach';
import { arbitrate, rankSignals } from '../src/domain/decision';
import { buildSignals } from '../src/domain/signals';
import { defaultSettings, DEFAULT_CONTEXT } from '../src/domain/defaults';
import { parseAmount, summarizeMonth } from '../src/domain/finance';
import { habitStreak, healthTrend } from '../src/domain/wellbeing';
import { scheduleReview } from '../src/domain/learning';
import { parseIcs, toIcs } from '../src/domain/ics';
import { createBackup, parseBackup, mergeRecords, BackupError } from '../src/domain/backup';
import { importLegacyState } from '../src/domain/legacy';
import { can, isPro, withinLimit } from '../src/domain/entitlements';
import { search } from '../src/domain/search';
import { getEdition, normalizeEdition } from '../src/domain/editions';
import { NOW, doc, hoursFrom, snapshot, emptySnapshot } from './fixtures';
import type { Settings } from '../src/domain/types';

const settings = (): Settings => ({ ...defaultSettings('fr'), onboardingComplete: true });

function coachInput(snap = emptySnapshot(), s = settings()) {
  const decisions = rankSignals(buildSignals(snap, s.context, NOW), { edition: s.edition }, NOW);
  const capacity = computeCapacity(snap, s.context, NOW);
  return {
    snap,
    settings: s,
    decisions,
    top: arbitrate(decisions, { capacityMinutes: capacity.capacityMinutes }),
    capacity,
    now: NOW,
  };
}

describe('capacity & plan', () => {
  it('subtracts meetings and applies measured low energy', () => {
    const snap = snapshot({
      events: [doc({ title: 'Client call', start: hoursFrom(NOW, 2), end: hoursFrom(NOW, 4) })] as never,
      health: [doc({ date: '2026-09-30', energy: 2, sleepHours: 5, source: 'manual' })] as never,
    });
    const c = computeCapacity(snap, DEFAULT_CONTEXT, NOW);
    expect(c.meetingMinutes).toBe(120);
    expect(c.energyMeasured).toBe(true);
    expect(c.energyFactor).toBeLessThan(1);
    expect(c.capacityMinutes).toBeLessThan(240);
  });

  it('does not claim an energy measurement without data', () => {
    const c = computeCapacity(emptySnapshot(), DEFAULT_CONTEXT, NOW);
    expect(c.energyMeasured).toBe(false);
    expect(c.energyFactor).toBe(1);
  });

  it('never schedules focus blocks over meetings', () => {
    const snap = snapshot({
      tasks: [
        doc({
          title: 'Report',
          category: 'work',
          status: 'todo',
          priority: 'high',
          essential: true,
          estimateMinutes: 60,
        }),
      ] as never,
      events: [doc({ title: 'Standup', start: hoursFrom(NOW, 1), end: hoursFrom(NOW, 1.5) })] as never,
    });
    const blocks = buildDayBlocks(snap, DEFAULT_CONTEXT, [], NOW);
    const ev = blocks.find((b) => b.kind === 'event')!;
    for (const f of blocks.filter((b) => b.kind === 'focus')) {
      expect(f.end <= ev.start || f.start >= ev.end).toBe(true);
    }
  });

  it('detects overlapping events', () => {
    const a = doc({ title: 'A', start: hoursFrom(NOW, 1), end: hoursFrom(NOW, 3) });
    const b = doc({ title: 'B', start: hoursFrom(NOW, 2), end: hoursFrom(NOW, 4) });
    expect(findConflicts([a, b] as never)).toHaveLength(1);
  });

  it('groups attention items', () => {
    const snap = snapshot({
      mailMessages: [
        doc({
          accountId: 'a',
          provider: 'gmail',
          externalId: '1',
          subject: 'Can you confirm?',
          sender: 'Bob',
          snippet: '',
          receivedAt: NOW.toISOString(),
          unread: true,
          needsReply: true,
          importance: 'normal',
        }),
      ] as never,
    });
    const g = groupAttention(rankSignals(buildSignals(snap, DEFAULT_CONTEXT, NOW), { edition: 'solo' }, NOW));
    expect(g.reply).toHaveLength(1);
  });
});

describe('coach grounding', () => {
  it('detects intents in four languages', () => {
    expect(detectIntent('Organise ma journée')).toBe('plan_day');
    expect(detectIntent('Review my cash flow')).toBe('finance');
    expect(detectIntent('Wie ist meine Energie?')).toBe('energy');
    expect(detectIntent('¿Qué proyecto está bloqueado?')).toBe('project');
  });

  it('never cites empty sources', () => {
    const a = answer('Organise ma journée', coachInput());
    expect(a.usedSources).toEqual([]);
    expect(a.confidence).toBe('low');
    expect(a.question).toBeDefined();
  });

  it('cites only sources that contributed', () => {
    const snap = snapshot({
      tasks: [
        doc({
          title: 'Send quote',
          category: 'work',
          status: 'todo',
          priority: 'high',
          dueDate: '2026-09-30',
        }),
      ] as never,
    });
    const a = answer('Organise ma journée', coachInput(snap));
    expect(a.usedSources.map((u) => u.source)).toEqual(['task']);
    expect(a.bullets[0]?.text).toBe('Send quote');
  });

  it('refuses to comment on finance without data', () => {
    const a = answer('ma trésorerie ?', coachInput());
    expect(a.lines[0]?.key).toBe('coach.finance.noData');
    expect(a.usedSources).toEqual([]);
  });

  it('respects disabled domains', () => {
    const s = settings();
    s.context.includedDomains.health = false;
    const a = answer('mon énergie', coachInput(emptySnapshot(), s));
    expect(a.title.key).toBe('coach.disabled.title');
  });
});

describe('finance', () => {
  it('parses localized amounts to cents', () => {
    expect(parseAmount('1 234,56 €')).toBe(123456);
    // No-break (U+00A0) and narrow no-break (U+202F) spaces, as produced by Intl in fr-FR.
    expect(parseAmount(`1${String.fromCharCode(0xa0)}234,56${String.fromCharCode(0xa0)}€`)).toBe(123456);
    expect(parseAmount(`1${String.fromCharCode(0x202f)}234,56`)).toBe(123456);
    expect(parseAmount('2 000a0')).toBeNull();
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount('12')).toBe(1200);
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
  });

  it('only counts settled entries in the balance', () => {
    const entries = [
      doc({
        date: '2026-09-02',
        kind: 'income',
        amount: 100000,
        currency: 'EUR',
        category: 'client',
        label: 'A',
        status: 'paid',
      }),
      doc({
        date: '2026-09-05',
        kind: 'income',
        amount: 50000,
        currency: 'EUR',
        category: 'client',
        label: 'B',
        status: 'pending',
      }),
      doc({
        date: '2026-09-06',
        kind: 'expense',
        amount: 20000,
        currency: 'EUR',
        category: 'tools',
        label: 'C',
        status: 'paid',
      }),
    ] as never;
    const m = summarizeMonth(entries, '2026-09');
    expect(m.balance).toBe(80000);
    expect(m.pendingIncome).toBe(50000);
  });
});

describe('wellbeing & learning', () => {
  it('computes streaks and trends', () => {
    const h = doc({ name: 'Walk', cadence: 'daily', domain: 'health' });
    const logs = ['2026-09-27', '2026-09-28', '2026-09-29'].map((date) => doc({ habitId: h.id, date }));
    expect(habitStreak(h as never, logs as never, NOW)).toBe(3);
    const t = healthTrend(
      [doc({ date: '2026-09-30', sleepHours: 7, energy: 4, source: 'manual' })] as never,
      NOW,
      7,
    );
    expect(t.avgSleep).toBe(7);
    expect(t.readiness).toBeGreaterThan(0);
    expect(healthTrend([], NOW).readiness).toBeNull();
  });

  it('schedules spaced review', () => {
    const skill = doc({ name: 'German', target: 'B2', progress: 10, resources: [], reviewIntervalDays: 2 });
    const good = scheduleReview(skill as never, 'good', NOW);
    expect(good.reviewIntervalDays).toBe(4);
    expect(good.nextReviewAt).toBe('2026-10-04');
    expect(scheduleReview(skill as never, 'hard', NOW).reviewIntervalDays).toBe(1);
  });
});

describe('ics', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:1',
    'DTSTART:20261001T090000Z',
    'DTEND:20261001T100000Z',
    'SUMMARY:Kick\\, off',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:2',
    'DTSTART;TZID=Europe/Paris:20261002T090000',
    'DTEND;TZID=Europe/Paris:20261002T093000',
    'RRULE:FREQ=WEEKLY;COUNT=3',
    'SUMMARY:Weekly',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:3',
    'DTSTART;VALUE=DATE:20261005',
    'SUMMARY:Holiday',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('parses UTC, TZID, recurrences and all-day events', () => {
    const ev = parseIcs(ics, { now: NOW });
    expect(ev.find((e) => e.uid === '1')?.title).toBe('Kick, off');
    const weekly = ev.filter((e) => e.uid.startsWith('2'));
    expect(weekly).toHaveLength(3);
    expect(weekly[0]?.start).toBe('2026-10-02T07:00:00.000Z');
    expect(ev.find((e) => e.uid === '3')?.allDay).toBe(true);
  });

  it('round-trips through toIcs', () => {
    const out = toIcs([
      { id: 'x', title: 'A; b', start: '2026-10-01T09:00:00.000Z', end: '2026-10-01T10:00:00.000Z' },
    ]);
    expect(parseIcs(out, { now: NOW })[0]?.title).toBe('A; b');
  });
});

describe('backup & migration', () => {
  it('round-trips a backup and rejects malformed files', () => {
    const snap = snapshot({
      tasks: [doc({ title: 'T', category: 'work', status: 'todo', priority: 'low' })] as never,
    });
    const b = createBackup(settings(), snap, '1.0.0');
    const parsed = parseBackup(JSON.stringify(b));
    expect(parsed.collections.tasks).toHaveLength(1);
    expect(() => parseBackup('nope')).toThrow(BackupError);
    expect(() => parseBackup(JSON.stringify({ format: 'x' }))).toThrow(BackupError);
    expect(() => parseBackup(JSON.stringify({ ...b, version: 99 }))).toThrow(/future-version/);
  });

  it('merges by last writer wins', () => {
    const a = { id: '1', createdAt: '', updatedAt: '2026-01-01', v: 'old' };
    const b = { id: '1', createdAt: '', updatedAt: '2026-02-01', v: 'new' };
    expect(mergeRecords([a], [b]).merged[0]?.v).toBe('new');
    expect(mergeRecords([b], [a]).changed).toHaveLength(0);
  });

  it('imports legacy V1-V8 state', () => {
    const res = importLegacyState({
      settings: { name: 'Guy', profile: 'professional', currency: 'EUR', onboardingComplete: true },
      tasks: [{ id: 't1', title: 'Old task', done: false, priority: 'high', estimate: 45 }],
      finance: [
        {
          id: 'f1',
          type: 'income',
          description: 'Client',
          amount: 1234.5,
          date: '2026-09-01',
          professional: true,
        },
      ],
      health: [{ id: 'h1', date: '2026-09-29', sleep: 7, energy: 8 }],
      projects: [{ id: 'p1', name: 'Launch', steps: [{ id: 's', text: 'Step', done: true }] }],
    });
    expect(res?.settings.edition).toBe('solo');
    expect(res?.snapshot.tasks?.[0]?.estimateMinutes).toBe(45);
    expect(res?.snapshot.finance?.[0]?.amount).toBe(123450);
    expect(res?.snapshot.health?.[0]?.energy).toBe(4);
    expect(res?.snapshot.projects?.[0]?.milestones[0]?.done).toBe(true);
    expect(importLegacyState(null)).toBeNull();
  });
});

describe('entitlements', () => {
  it('gates pro features and honours paid-through cancellations', () => {
    expect(can('finance', null)).toBe(false);
    expect(isPro({ plan: 'pro', status: 'active' })).toBe(true);
    expect(isPro({ plan: 'pro', status: 'cancelled', validUntil: '2026-12-01' }, NOW)).toBe(true);
    expect(isPro({ plan: 'pro', status: 'cancelled', validUntil: '2026-01-01' }, NOW)).toBe(false);
    expect(withinLimit('projects', 0, null)).toBe(true);
    expect(withinLimit('projects', 1, null)).toBe(false);
  });
});

describe('search & editions', () => {
  it('finds records accent-insensitively', () => {
    const snap = snapshot({
      tasks: [
        doc({ title: 'Préparer la réunion', category: 'work', status: 'todo', priority: 'low' }),
      ] as never,
    });
    expect(search(snap, 'reunion')[0]?.title).toBe('Préparer la réunion');
    expect(search(snap, 'zz')).toHaveLength(0);
  });

  it('exposes localized edition copy', () => {
    expect(normalizeEdition('personal')).toBe('life');
    expect(getEdition('creator', 'de').name).toBeTruthy();
    expect(getEdition('nomad', 'es').prompts).toHaveLength(3);
  });
});
