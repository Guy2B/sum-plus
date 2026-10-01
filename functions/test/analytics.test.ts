import { describe, expect, it, vi } from 'vitest';
import { buildCohorts, buildDaily, digestText, parseVisit, weekStart } from '../src/handlers/analytics';

// The module imports the Firestore runtime (mock hoisted by Vitest); only pure helpers are tested.
vi.mock('../src/lib/runtime', () => ({
  FieldValue: {},
  Timestamp: {},
  callableDefaults: {},
  db: {},
  logger: { warn: () => undefined, error: () => undefined },
  requireAdmin: () => 'admin',
}));


const row = (e: string, extra: Record<string, unknown> = {}) => ({
  e,
  day: '2026-09-30',
  cohort: '2026-W40',
  age: 0,
  lang: 'fr',
  ...extra,
});

describe('analytics aggregation', () => {
  it('sums one day of counters by event, language, source, AI mode and engine', () => {
    const d = buildDaily([
      row('app_open', { ai: 'local', pf: 'pwa', src: 'demo' }),
      row('app_open', { ai: 'core', pf: 'web' }),
      row('onboarding_complete', { lang: 'de', src: 'mine' }),
      row('daily_summary', { p: 6, a: 4, s: 3, c: 2, ob: 25, eb: 40, ea: 20, age: 31 }),
    ]);
    expect(d.events).toMatchObject({ app_open: 2, onboarding_complete: 1, daily_summary: 1 });
    expect(d.byLang.de).toEqual({ onboarding_complete: 1 });
    expect(d.bySrc.direct).toMatchObject({ app_open: 1 });
    expect(d.ai).toEqual({ local: 1, core: 1 });
    expect(d.engine).toMatchObject({ n: 1, p: 6, a: 4, ob5: 1, ob20: 1, ebSum: 40, eaSum: 20, ebN: 1, lateP: 6, lateA: 4 });
  });

  it('counts installs per week and returns on day 1/3/7/14/30 only', () => {
    const c = buildCohorts(
      [row('onboarding_complete'), row('onboarding_complete')],
      [row('app_open', { age: 1 }), row('app_open', { age: 7 }), row('app_open', { age: 5 })],
    );
    expect(c['2026-W40']).toEqual({ installs: 2, d1: 1, d7: 1 });
  });

  it('accepts only known visit counters and languages', () => {
    expect(parseVisit('k=landing&lang=de')).toEqual({ k: 'landing', lang: 'de' });
    expect(parseVisit('k=cta_demo&lang=xx')).toEqual({ k: 'cta_demo', lang: null });
    expect(parseVisit('k=anything')).toBeNull();
    expect(parseVisit(null)).toBeNull();
  });

  it('writes a four-line morning digest with the biggest leak', () => {
    const text = digestText(
      [
        {
          events: { onboarding_started: 10, onboarding_complete: 8, first_plan: 8, first_decision: 2, app_open: 30 },
          engine: { p: 20, a: 12 },
          visits: { landing: 100, cta_demo: 7, cta_mine: 3 },
        },
      ],
      [{ installs: 4, d7: 1 }],
    );
    expect(text).toContain('Activation 25 %');
    expect(text).toContain('J7 25 %');
    expect(text).toContain('Acceptation 60 %');
    expect(text).toContain('100 vues, 10 clics');
    expect(text).toContain('1er plan → 1re décision : −75 %');
  });

  it('finds the Monday of an ISO week', () => {
    expect(weekStart('2026-W40')?.toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(weekStart('nope')).toBeNull();
  });
});
