import { describe, expect, it } from 'vitest';
import { analyze, retentionRows, weekStart, type Daily } from '../src/domain/analytics';
import { dailySummary } from '../src/services/telemetry';
import { duePulse } from '../src/ui/pulse';
import type { DecisionFeedback, DecisionRecord } from '../src/domain/types';
import { NOW, doc } from './fixtures';

const day = (d: string, events: Record<string, number>, engine: Record<string, number> = {}): Daily => ({
  day: d,
  events,
  engine,
});

describe('admin analytics', () => {
  const daily = [
    day(
      '2026-09-29',
      {
        onboarding_started: 20,
        onboarding_complete: 16,
        first_plan: 15,
        first_decision: 6,
        first_completed: 5,
        app_open: 40,
      },
      { n: 10, p: 30, a: 18, s: 12, c: 9, w: 3, earlyP: 20, earlyA: 9, lateP: 10, lateA: 9 },
    ),
    // Previous period (7 days before): lower activation.
    day('2026-09-20', { onboarding_complete: 10, first_decision: 2 }, { p: 10, a: 4 }),
  ];

  it('computes activation and acceptance with their trend', () => {
    const a = analyze(daily, [], 7, NOW);
    expect(a.kpis.activation).toBe(37.5);
    expect(a.kpis.activationDelta).toBe(17.5);
    expect(a.kpis.acceptance).toBe(60);
    expect(a.engine.startRate).toBe(40);
    expect(a.personalization.acceptanceEarly).toBe(45);
    expect(a.personalization.acceptanceLate).toBe(90);
  });

  it('names the biggest leak of the funnel', () => {
    const a = analyze(daily, [], 7, NOW);
    expect(a.biggestLeak?.step).toBe('first_decision');
    expect(a.biggestLeak?.rate).toBe(40);
  });

  it('shows retention only for days a cohort has actually reached', () => {
    expect(weekStart('2026-W40')?.getDate()).toBe(28);
    const rows = retentionRows(
      [
        { cohort: '2026-W36', installs: 10, d1: 6, d7: 4, d30: 1 },
        { cohort: '2026-W40', installs: 5, d1: 2 },
      ],
      NOW,
    );
    expect(rows[0]!.cells).toEqual([60, 0, 40, 0, null]);
    expect(rows[1]!.cells.every((c) => c === null)).toBe(true);
  });

  it('reports empty when nothing has arrived yet', () => {
    expect(analyze([], [], 30, NOW).empty).toBe(true);
  });
});

describe('daily engine summary', () => {
  it('is made of numbers only', () => {
    const rec = (outcome: DecisionRecord['outcome'], started = false) =>
      doc({
        date: '2026-09-29',
        outcome,
        startedAt: started ? 'x' : null,
        title: 'secret title',
      } as unknown as DecisionRecord);
    const s = dailySummary(
      [rec('completed', true), rec('deferred'), rec('shown'), rec('wrongTime')],
      [doc({ action: 'completed' } as unknown as DecisionFeedback)],
      { avoided: { date: '2026-09-29', minutes: 70 } },
      '2026-09-29',
    );
    expect(s).toMatchObject({ p: 4, a: 1, s: 1, c: 1, d: 1, w: 1, ov: 70, ob: 1 });
    expect(Object.values(s!).every((v) => typeof v === 'number')).toBe(true);
    expect(dailySummary([], [], {}, '2026-09-29')).toBeNull();
  });
});

describe('weekly pulse', () => {
  it('asks after 7 days, then after 30 days, never twice', () => {
    expect(duePulse({ installedAt: '2026-09-27' }, NOW)).toBeNull();
    expect(duePulse({ installedAt: '2026-09-20' }, NOW)).toBe('d7');
    expect(duePulse({ installedAt: '2026-09-20', pulseAsked: ['d7'] }, NOW)).toBeNull();
    expect(duePulse({ installedAt: '2026-08-20', pulseAsked: ['d7'] }, NOW)).toBe('d30');
  });
});

describe('Free → Pro readiness', () => {
  it('computes the annual saving shown in the Pro window', async () => {
    const { annualSaving } = await import('../src/ui/pro');
    expect(annualSaving('8,90 €', '69 €')).toBe(35);
    expect(annualSaving('', '69 €')).toBeNull();
  });

  it('reads the Pro funnel and price answers from the aggregates', () => {
    const a = analyze(
      [
        {
          day: '2026-09-29',
          events: { pro_gate_seen: 10, pro_cta_clicked: 4, checkout_started: 1, app_open: 5 },
          byFrom: {
            coach: { pro_gate_seen: 6, pro_cta_clicked: 3, checkout_started: 1 },
            sidebar: { pro_cta_clicked: 1 },
          },
          price: { yes: 3, maybe: 2, expensive: 4, useless: 1 },
        },
      ],
      [],
      7,
      NOW,
    );
    expect(a.pro.clickRate).toBe(40);
    expect(a.pro.byTrigger[0]).toMatchObject({ from: 'coach', checkout: 1 });
    expect(a.pro.price.find((p) => p.answer === 'expensive')?.share).toBe(40);
  });
});
