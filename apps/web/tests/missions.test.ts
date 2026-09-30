import { describe, expect, it } from 'vitest';
import type { Mission } from '../src/domain/types';
import {
  currentPage,
  isTrainingDay,
  knowledgeAt,
  loadFactor,
  planMission,
  readingPace,
  sessionToLog,
  topicStates,
  withLoggedSession,
} from '../src/domain/missions';
import { convertModules } from '../src/domain/missions-convert';
import { buildSignals } from '../src/domain/signals';
import { rankSignals } from '../src/domain/decision';
import { addDays, isoDay } from '../src/domain/dates';
import { NOW, doc, snapshot } from './fixtures';

const day = (n: number) => isoDay(addDays(NOW, n));

function mission(fields: Partial<Mission>): Mission {
  return doc({
    kind: 'exam',
    title: 'Maths',
    status: 'active',
    minutesPerDay: 40,
    daysPerWeek: 7,
    topics: [],
    log: [],
    ...fields,
  } as Omit<Mission, 'id' | 'createdAt' | 'updatedAt'>) as Mission;
}

const topics = [
  { id: 'a', title: 'Fractions', mastery: 4 },
  { id: 'b', title: 'Géométrie', mastery: 1 },
  { id: 'c', title: 'Équations', mastery: 3 },
];

describe('topics model (exam)', () => {
  it('starts with the weakest topic and ends with a mock exam then a light review', () => {
    const plan = planMission(mission({ topics, targetDate: day(8) }), NOW);
    expect(plan.today?.topic).toBe('Géométrie');
    expect(plan.sessions.find((s) => s.date === day(6))?.kind).toBe('mock');
    expect(plan.sessions.find((s) => s.date === day(7))?.kind).toBe('light');
    expect(plan.sessions.some((s) => s.date >= day(8))).toBe(false);
    expect(plan.daysLeft).toBe(8);
  });

  it('forecasts higher readiness with more time and says how much is missing', () => {
    const short = planMission(mission({ topics, targetDate: day(3), minutesPerDay: 15 }), NOW).forecast;
    const long = planMission(mission({ topics, targetDate: day(14), minutesPerDay: 60 }), NOW).forecast;
    expect(long.readiness!).toBeGreaterThan(short.readiness!);
    expect(short.onTrack).toBe(false);
    expect(short.atRisk).toContain('Géométrie');
    // Too little time: Σ says so instead of promising an impossible number.
    expect(short.reasons.map((r) => r.key)).toContain('mission.reason.tooLate');
    // Recoverable: Σ gives the smallest daily increase that gets back on track.
    const medium = planMission(mission({ topics, targetDate: day(10), minutesPerDay: 15 }), NOW).forecast;
    expect(medium.onTrack).toBe(false);
    expect(medium.extraMinutes).toBeGreaterThan(0);
    const fixed = planMission(
      mission({ topics, targetDate: day(10), minutesPerDay: 15 + medium.extraMinutes }),
      NOW,
    ).forecast;
    expect(fixed.onTrack).toBe(true);
  });

  it('learns from the log: a studied topic is known better, then slowly forgotten', () => {
    const m = mission({ topics, log: [{ date: day(0), minutes: 45, topicId: 'b', rating: 'good' }] });
    const b = topicStates(m).find((s) => s.topic.id === 'b')!;
    const before = topicStates(mission({ topics })).find((s) => s.topic.id === 'b')!;
    expect(knowledgeAt(b, NOW)).toBeGreaterThan(knowledgeAt(before, NOW));
    expect(knowledgeAt(b, addDays(NOW, 20))).toBeLessThan(knowledgeAt(b, NOW));
  });

  it('proposes nothing more today once a session is logged', () => {
    const m = mission({ topics, targetDate: day(8), log: [{ date: day(0), minutes: 40, topicId: 'b' }] });
    expect(planMission(m, NOW).today).toBeNull();
  });
});

describe('steps model (interview)', () => {
  it('schedules dated steps, moves overdue ones to today and tracks progress', () => {
    const m = mission({ kind: 'interview', title: 'ACME', targetDate: day(3), minutesPerDay: 30 });
    const plan = planMission(m, NOW);
    // research (D-5) and stories (D-4) are already late → today.
    expect(plan.sessions.filter((s) => s.date === day(0)).map((s) => s.step)).toEqual(
      expect.arrayContaining(['research', 'stories', 'questions']),
    );
    expect(plan.forecast.atRisk).toEqual(['research', 'stories']);
    const done = planMission({ ...m, log: [{ date: day(0), minutes: 45, step: 'research' }] }, NOW);
    expect(done.forecast.progress).toBeGreaterThan(plan.forecast.progress);
    expect(done.sessions.some((s) => s.step === 'research')).toBe(false);
  });
});

describe('pace model (book)', () => {
  it('measures reading speed and predicts the finish date', () => {
    const m = mission({
      kind: 'book',
      title: 'Sapiens',
      totalPages: 400,
      startPage: 0,
      minutesPerDay: 30,
      daysPerWeek: 7,
      log: [
        { date: day(-2), minutes: 30, page: 30 },
        { date: day(-1), minutes: 30, page: 60 },
      ],
    });
    expect(currentPage(m)).toBe(60);
    expect(readingPace(m)).toBeCloseTo(1, 5);
    const plan = planMission(m, NOW);
    expect(plan.today).toMatchObject({ fromPage: 61, toPage: 90, minutes: 30 });
    expect(plan.forecast.projectedFinish).toBe(day(11)); // 340 pages at 30/day → 12 sessions
    expect(plan.forecast.progress).toBe(15);
  });

  it('computes the extra daily minutes needed to hit a target date', () => {
    const m = mission({ kind: 'book', totalPages: 300, minutesPerDay: 20, targetDate: day(5), log: [] });
    const f = planMission(m, NOW).forecast;
    expect(f.onTrack).toBe(false);
    expect(f.extraMinutes).toBeGreaterThan(20);
  });
});

describe('program model (fitness)', () => {
  it('trains on spread weekdays with progressive load and a deload week', () => {
    expect([1, 3, 5].every((d) => isTrainingDay(new Date(2026, 8, 27 + d), 3))).toBe(true);
    expect(loadFactor(0)).toBe(1);
    expect(loadFactor(2)).toBeCloseTo(1.2);
    expect(loadFactor(3)).toBe(0.7);
    const plan = planMission(mission({ kind: 'fitness', title: 'Forme', daysPerWeek: 3, level: 'beginner' }), NOW);
    expect(plan.today?.kind).toBe('endurance'); // Wednesday is a training day
    expect(plan.sessions.map((s) => s.kind).slice(0, 3)).toEqual(['endurance', 'strength', 'mobility']);
  });

  it('recovers after a hard session and flags low consistency', () => {
    const created = addDays(NOW, -21);
    const m = {
      ...mission({ kind: 'fitness', daysPerWeek: 7, level: 'intermediate', minutesPerDay: 60 }),
      createdAt: created.toISOString(),
      log: [{ date: day(-1), minutes: 40, rating: 'hard' as const }],
    };
    const plan = planMission(m, NOW);
    expect(plan.today?.kind).toBe('recovery');
    expect(plan.forecast.onTrack).toBe(false);
    expect(plan.forecast.reasons.map((r) => r.key)).toContain('mission.reason.recovery');
  });
});

describe('integration with the decision engine', () => {
  it("turns today's session into a ranked decision explained by the forecast", () => {
    const m = mission({ topics, targetDate: day(4) });
    const signals = buildSignals(snapshot({ missions: [m] }), undefined, NOW);
    const s = signals.find((x) => x.sourceType === 'mission')!;
    expect(s.titleKey).toBe('mission.session.study');
    expect(s.titleParams).toMatchObject({ topic: 'Géométrie' });
    expect(s.session).toMatchObject({ topicId: 'b', date: day(0) });
    const [d] = rankSignals([s], { edition: 'student' }, NOW);
    expect(d!.reasons[0]!.key).toBe('mission.headline.readiness');
  });
});

describe('pipeline model (job search)', () => {
  it('schedules follow-ups after 7 days, interview prep, and the weekly applications', () => {
    const m = mission({
      kind: 'jobsearch',
      title: 'Job',
      daysPerWeek: 3,
      pipeline: [
        { id: 'p1', company: 'ACME', role: 'PM', stage: 'applied', appliedAt: day(-8) },
        { id: 'p2', company: 'Globex', role: 'PO', stage: 'interview', appliedAt: day(-12) },
        { id: 'p3', company: 'Initech', role: 'PM', stage: 'applied', appliedAt: day(-2) },
      ],
    });
    const plan = planMission(m, NOW);
    const todayKinds = plan.sessions.filter((s) => s.date === day(0)).map((s) => s.kind);
    expect(todayKinds[0]).toBe('prepare');
    expect(todayKinds).toContain('followup');
    expect(plan.sessions.find((s) => s.kind === 'followup' && s.company === 'Initech')?.date).toBe(day(5));
    // Target 3/week, Initech already sent on Monday → 2 left, spread over the rest of the week.
    const week = plan.sessions.filter((s) => s.kind === 'apply' && s.date <= day(4));
    expect(week).toHaveLength(2);
    expect(plan.forecast.reasons.find((r) => r.key === 'mission.reason.weekTarget')?.params).toEqual({
      done: 1,
      target: 3,
    });
    expect(plan.forecast.reasons[0]).toMatchObject({ key: 'mission.reason.interviewPrep' });
  });

  it('records a follow-up on the application when the session is done', () => {
    const m = mission({
      kind: 'jobsearch',
      pipeline: [{ id: 'p1', company: 'ACME', role: 'PM', stage: 'applied', appliedAt: day(-8) }],
    });
    const s = planMission(m, NOW).today!;
    const patch = withLoggedSession(m, sessionToLog(s));
    expect(patch.pipeline?.[0]?.followedUpAt).toBe(day(0));
    expect(planMission({ ...m, ...patch }, NOW).sessions.find((x) => x.kind === 'followup')?.date).toBe(day(7));
  });
});

describe('conversion of former modules', () => {
  it('turns skills, applications and upcoming school tests into missions, idempotently', () => {
    const snap = snapshot({
      skills: [doc({ name: 'Allemand', target: 'B1', progress: 50, resources: [] })] as never,
      applications: [doc({ company: 'ACME', role: 'PM', stage: 'applied', appliedAt: day(-3) })] as never,
      household: [doc({ name: 'Léa', relation: 'child' })] as never,
      schoolItems: [] as never,
    });
    const lea = snap.household[0]!;
    snap.schoolItems = [
      doc({ memberId: lea.id, title: 'Contrôle de maths', kind: 'exam', dueDate: day(6), done: false }),
      doc({ memberId: lea.id, title: 'Fiche', kind: 'form', dueDate: day(2), done: false }),
    ] as never;
    const c = convertModules(snap, 'fr', NOW);
    const kinds = c.create.map((m) => m.kind).sort();
    expect(kinds).toEqual(['exam', 'jobsearch', 'language']);
    expect(c.create.find((m) => m.kind === 'exam')).toMatchObject({ forName: 'Léa', targetDate: day(6) });
    expect(c.create.find((m) => m.kind === 'language')?.topics[0]?.mastery).toBe(3);
    expect(c.remove.map((r) => r.collection).sort()).toEqual(['applications', 'schoolItems', 'skills']);
    // Same input converted again on another device → same ids, no duplicates.
    expect(convertModules(snap, 'fr', NOW).create.map((m) => m.id)).toEqual(c.create.map((m) => m.id));
  });
});
