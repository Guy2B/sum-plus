/**
 * Admin analytics: turns the daily aggregates written by the Netlify job into
 * the few numbers that steer the product — activation, D7 retention, decision
 * acceptance, the biggest leak in the funnel, engine quality, personalisation.
 * Pure functions: the screen and the tests share them.
 */
import { addDays, isoDay } from './dates';

export interface Daily {
  day: string;
  events?: Record<string, number>;
  byLang?: Record<string, Record<string, number>>;
  bySrc?: Record<string, Record<string, number>>;
  ai?: Record<string, number>;
  pf?: Record<string, number>;
  engine?: Record<string, number>;
  visits?: Record<string, number>;
  visitsLang?: Record<string, number>;
}

export interface Cohort {
  cohort: string;
  installs: number;
  d1?: number;
  d3?: number;
  d7?: number;
  d14?: number;
  d30?: number;
}

export const FUNNEL = [
  'onboarding_started',
  'onboarding_complete',
  'first_plan',
  'first_decision',
  'first_completed',
] as const;
export const RETENTION_AGES = [1, 3, 7, 14, 30] as const;

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

function add(into: Record<string, number>, from: Record<string, number> | undefined) {
  for (const [k, v] of Object.entries(from ?? {})) into[k] = (into[k] ?? 0) + (typeof v === 'number' ? v : 0);
}

/** Sums a period of daily aggregates, optionally for one language. */
export function sumPeriod(rows: Daily[], lang?: string) {
  const events: Record<string, number> = {};
  const engine: Record<string, number> = {};
  const visits: Record<string, number> = {};
  const ai: Record<string, number> = {};
  const pf: Record<string, number> = {};
  const bySrc: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    add(events, lang ? r.byLang?.[lang] : r.events);
    add(engine, r.engine);
    add(visits, r.visits);
    add(ai, r.ai);
    add(pf, r.pf);
    for (const [src, counts] of Object.entries(r.bySrc ?? {})) add((bySrc[src] ??= {}), counts);
  }
  return { events, engine, visits, ai, pf, bySrc };
}

/** Cohort retention: share of installs of that week that opened the app on day N ("—" when not reached yet). */
export function retentionRows(cohorts: Cohort[], now: Date) {
  return cohorts
    .filter((c) => c.installs > 0)
    .map((c) => {
      const start = weekStart(c.cohort);
      return {
        cohort: c.cohort,
        installs: c.installs,
        cells: RETENTION_AGES.map((age) => {
          const reached = start ? addDays(start, age + 6).getTime() <= now.getTime() : false;
          return reached ? pct(c[`d${age}` as const] ?? 0, c.installs) : null;
        }),
      };
    });
}

/** D7 over every cohort old enough, weighted by installs. */
export function d7Retention(cohorts: Cohort[], now: Date): number | null {
  let installs = 0;
  let back = 0;
  for (const c of cohorts) {
    const start = weekStart(c.cohort);
    if (!start || addDays(start, 13).getTime() > now.getTime()) continue;
    installs += c.installs;
    back += c.d7 ?? 0;
  }
  return pct(back, installs);
}

/** Monday of an ISO week ("2026-W40"). */
export function weekStart(cohort: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(cohort);
  if (!m) return null;
  const year = Number(m[1]);
  const jan4 = new Date(year, 0, 4);
  const monday = addDays(jan4, -((jan4.getDay() + 6) % 7));
  return addDays(monday, (Number(m[2]) - 1) * 7);
}

export function analyze(daily: Daily[], cohorts: Cohort[], days: number, now: Date, lang?: string) {
  const since = isoDay(addDays(now, -(days - 1)));
  const prevSince = isoDay(addDays(now, -(days * 2 - 1)));
  const current = sumPeriod(
    daily.filter((d) => d.day >= since),
    lang,
  );
  const previous = sumPeriod(
    daily.filter((d) => d.day >= prevSince && d.day < since),
    lang,
  );
  const e = current.events;
  const g = current.engine;

  const activation = pct(e.first_decision ?? 0, e.onboarding_complete ?? 0);
  const activationPrev = pct(previous.events.first_decision ?? 0, previous.events.onboarding_complete ?? 0);
  const acceptance = pct(g.a ?? 0, g.p ?? 0);
  const acceptancePrev = pct(previous.engine.a ?? 0, previous.engine.p ?? 0);
  const delta = (a: number | null, b: number | null) =>
    a !== null && b !== null ? Math.round((a - b) * 10) / 10 : null;

  const funnel = FUNNEL.map((step, i) => {
    const count = e[step] ?? 0;
    const before = i ? (e[FUNNEL[i - 1]!] ?? 0) : null;
    return { step, count, rate: before === null ? null : pct(count, before) };
  });
  const leaks = funnel.filter((f) => f.rate !== null && (e[FUNNEL[FUNNEL.indexOf(f.step) - 1]!] ?? 0) >= 3);
  const biggestLeak = leaks.length
    ? leaks.reduce((worst, f) => ((f.rate ?? 100) < (worst.rate ?? 100) ? f : worst))
    : null;

  const sources = Object.entries(current.bySrc)
    .map(([src, c]) => ({
      src,
      started: c.onboarding_started ?? 0,
      completed: c.onboarding_complete ?? 0,
      firstPlan: c.first_plan ?? 0,
      firstDecision: c.first_decision ?? 0,
      activation: pct(c.first_decision ?? 0, c.onboarding_complete ?? 0),
    }))
    .sort((a, b) => b.started - a.started);

  const engine = {
    summaries: g.n ?? 0,
    proposed: g.p ?? 0,
    acceptance,
    startRate: pct(g.s ?? 0, g.p ?? 0),
    completionAfterStart: pct(g.c ?? 0, g.s ?? 0),
    wrongTime: pct(g.w ?? 0, g.p ?? 0),
    deferral: pct(g.d ?? 0, g.p ?? 0),
    rejection: pct(g.r ?? 0, g.p ?? 0),
    avoidedAvg: g.n ? Math.round((g.ov ?? 0) / g.n) : null,
    estimateBefore: g.ebN ? Math.round((g.ebSum ?? 0) / g.ebN) : null,
    estimateAfter: g.ebN ? Math.round((g.eaSum ?? 0) / g.ebN) : null,
  };

  const personalization = {
    with5: pct(g.ob5 ?? 0, g.n ?? 0),
    with20: pct(g.ob20 ?? 0, g.n ?? 0),
    rulesAvg: g.n ? Math.round(((g.lr ?? 0) / g.n) * 10) / 10 : null,
    acceptanceEarly: pct(g.earlyA ?? 0, g.earlyP ?? 0),
    acceptanceLate: pct(g.lateA ?? 0, g.lateP ?? 0),
  };

  const opens = e.app_open ?? 0;
  const engagement = {
    opens,
    coach: e.coach_used ?? 0,
    coachApplied: e.coach_plan_applied ?? 0,
    replans: e.day_replanned ?? 0,
    started: e.decision_started ?? 0,
    completed: e.decision_completed ?? 0,
    perOpen: opens ? Math.round(((e.decision_started ?? 0) / opens) * 100) / 100 : null,
    ai: current.ai,
    pf: current.pf,
  };

  const landing = {
    views: current.visits.landing ?? 0,
    demo: current.visits.cta_demo ?? 0,
    mine: current.visits.cta_mine ?? 0,
    ctr: pct((current.visits.cta_demo ?? 0) + (current.visits.cta_mine ?? 0), current.visits.landing ?? 0),
  };

  return {
    kpis: {
      activation,
      activationDelta: delta(activation, activationPrev),
      d7: d7Retention(cohorts, now),
      acceptance,
      acceptanceDelta: delta(acceptance, acceptancePrev),
    },
    funnel,
    biggestLeak,
    sources,
    engine,
    personalization,
    engagement,
    landing,
    retention: retentionRows(cohorts, now),
    empty: !opens && !landing.views && !(e.onboarding_started ?? 0),
  };
}
