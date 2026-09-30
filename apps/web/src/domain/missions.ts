/**
 * Σ mission engine — turns a goal (exam, interview, book, fitness…) into a plan
 * placed on the calendar, a forecast, and today's session. Fully deterministic:
 * the same inputs and history always give the same plan, and every number can
 * be explained. Four models cover the six kinds:
 *
 *  - topics  (exam, language): spaced repetition on a forgetting curve,
 *            weakest topic first, mock exam at D-2, light review at D-1;
 *  - steps   (interview, presentation): dated preparation checklist;
 *  - pace    (book): measured reading speed → projected finish date;
 *  - program (fitness): progressive load, deload every 4th week, recovery
 *            after a hard session, consistency forecast.
 */
import type { ISODate, Mission, MissionKind, MissionLogEntry, MissionTopic } from './types';
import { addDays, isoDay, startOfDay, toDate } from './dates';

export type SessionKind =
  'study' | 'mock' | 'light' | 'step' | 'read' | 'endurance' | 'strength' | 'mobility' | 'recovery';

export interface PlannedSession {
  date: ISODate;
  minutes: number;
  kind: SessionKind;
  topicId?: string;
  topic?: string;
  step?: string;
  fromPage?: number;
  toPage?: number;
}

export interface MissionReason {
  key: string;
  params?: Record<string, string | number>;
}

export interface Forecast {
  /** Projected preparation at the target date (topics / steps), 0..100. */
  readiness: number | null;
  /** Progress so far, 0..100. */
  progress: number;
  onTrack: boolean;
  projectedFinish: ISODate | null;
  /** Extra minutes per day that would put the mission back on track (0 = none). */
  extraMinutes: number;
  atRisk: string[];
  headline: MissionReason;
  reasons: MissionReason[];
}

export interface MissionPlan {
  sessions: PlannedSession[];
  forecast: Forecast;
  today: PlannedSession | null;
  daysLeft: number | null;
}

export const MISSION_KINDS: MissionKind[] = [
  'exam',
  'interview',
  'book',
  'fitness',
  'language',
  'presentation',
];

export const MODEL: Record<MissionKind, 'topics' | 'steps' | 'pace' | 'program'> = {
  exam: 'topics',
  language: 'topics',
  interview: 'steps',
  presentation: 'steps',
  book: 'pace',
  fitness: 'program',
};

/** Preparation steps: key, offset in days from the target date, minutes. */
export const STEPS: Record<'interview' | 'presentation', [string, number, number][]> = {
  interview: [
    ['research', -5, 45],
    ['stories', -4, 60],
    ['questions', -3, 20],
    ['mock', -2, 45],
    ['logistics', -1, 15],
    ['followup', 2, 10],
  ],
  presentation: [
    ['outline', -6, 30],
    ['content', -5, 60],
    ['slides', -4, 60],
    ['rehearse', -2, 30],
    ['final', -1, 30],
    ['logistics', -1, 10],
  ],
};

/* --------------------------------- helpers -------------------------------- */

const DAY = 86_400_000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round5 = (v: number) => Math.max(5, Math.round(v / 5) * 5);
const daysBetween = (a: Date, b: Date) =>
  Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);

/** Weekdays (0 = Sunday) used for a given number of sessions per week, spread evenly. */
const WEEK_PATTERNS: Record<number, number[]> = {
  1: [3],
  2: [2, 5],
  3: [1, 3, 5],
  4: [1, 2, 4, 6],
  5: [1, 2, 3, 5, 6],
  6: [1, 2, 3, 4, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};

export function isTrainingDay(day: Date, daysPerWeek: number): boolean {
  return (WEEK_PATTERNS[clamp(Math.round(daysPerWeek), 1, 7)] ?? WEEK_PATTERNS[7]!).includes(day.getDay());
}

function sortedLog(m: Mission): MissionLogEntry[] {
  return [...(m.log ?? [])].sort((a, b) => a.date.localeCompare(b.date));
}

function doneToday(m: Mission, today: ISODate): boolean {
  return (m.log ?? []).some((l) => l.date === today);
}

/* ------------------------------- topics model ------------------------------ */

const GAIN = { easy: 0.45, good: 0.35, hard: 0.18 } as const;

interface TopicState {
  topic: MissionTopic;
  k: number; // knowledge right after the last touch, 0..1
  last: Date; // last touch
  reviews: number;
}

/** Stability (days) grows with each review: well-reviewed topics are forgotten more slowly. */
const stability = (reviews: number) => 5 + 5 * reviews;

export function knowledgeAt(s: TopicState, day: Date): number {
  const days = Math.max(0, daysBetween(s.last, day));
  return s.k * Math.exp(-days / stability(s.reviews));
}

function applyGain(s: TopicState, day: Date, rating: keyof typeof GAIN, minutes: number) {
  const current = knowledgeAt(s, day);
  const gain = GAIN[rating] * clamp(minutes / 30, 0.3, 2);
  s.k = current + (1 - current) * gain;
  s.last = day;
  s.reviews += 1;
}

export function topicStates(m: Mission): TopicState[] {
  const created = toDate(m.createdAt) ?? new Date();
  const states = m.topics.map((topic) => ({
    topic,
    k: 0.15 + 0.2 * (clamp(topic.mastery, 1, 5) - 1),
    last: startOfDay(created),
    reviews: clamp(topic.mastery, 1, 5) - 1,
  }));
  for (const l of sortedLog(m)) {
    const day = toDate(l.date);
    if (!day) continue;
    const rating = l.rating ?? 'good';
    if (l.topicId) {
      const s = states.find((x) => x.topic.id === l.topicId);
      if (s) applyGain(s, day, rating, l.minutes);
    } else {
      // Whole-subject session (mock exam, light review): small gain on every topic.
      for (const s of states) applyGain(s, day, rating, l.minutes / Math.max(1, states.length) + 10);
    }
  }
  return states;
}

function cloneStates(states: TopicState[]): TopicState[] {
  return states.map((s) => ({ ...s, last: new Date(s.last) }));
}

function simulateTopics(
  m: Mission,
  start: Date,
  end: Date | null,
  minutesPerDay: number,
  horizon: number,
): { sessions: PlannedSession[]; states: TopicState[] } {
  const states = cloneStates(topicStates(m));
  const sessions: PlannedSession[] = [];
  const lastDay = end ? addDays(end, -1) : addDays(start, horizon - 1);
  const totalDays = daysBetween(start, lastDay) + 1;
  let previous: string | null = null;
  for (let i = 0; i < totalDays; i++) {
    const day = addDays(start, i);
    const toTarget = end ? daysBetween(day, end) : null;
    const date = isoDay(day);
    if (toTarget === 1) {
      const minutes = round5(Math.min(minutesPerDay, 20));
      sessions.push({ date, minutes, kind: 'light' });
      for (const s of states) applyGain(s, day, 'good', minutes / states.length + 10);
      continue;
    }
    if (toTarget === 2 && daysBetween(start, end!) >= 4) {
      const minutes = round5(Math.min(90, Math.max(minutesPerDay, 45)));
      sessions.push({ date, minutes, kind: 'mock' });
      for (const s of states) applyGain(s, day, 'good', minutes / states.length + 10);
      continue;
    }
    const nearTarget = toTarget !== null && toTarget <= 7;
    if (!nearTarget && !isTrainingDay(day, m.daysPerWeek)) continue;
    if (!states.length) continue;
    const measure = end ?? day;
    const ranked = [...states].sort((a, b) => knowledgeAt(a, measure) - knowledgeAt(b, measure));
    const pick = ranked.find((s) => s.topic.id !== previous || states.length === 1) ?? ranked[0]!;
    const minutes = round5(Math.min(minutesPerDay, 90));
    sessions.push({ date, minutes, kind: 'study', topicId: pick.topic.id, topic: pick.topic.title });
    applyGain(pick, day, 'good', minutes);
    previous = pick.topic.id;
  }
  return { sessions, states };
}

const readinessOf = (states: TopicState[], day: Date) =>
  states.length ? Math.round((states.reduce((a, s) => a + knowledgeAt(s, day), 0) / states.length) * 100) : 0;

function planTopics(m: Mission, now: Date, horizon: number): MissionPlan {
  const today = startOfDay(now);
  const target = toDate(m.targetDate);
  const end = target && target > today ? startOfDay(target) : null;
  const start = doneToday(m, isoDay(now)) ? addDays(today, 1) : today;
  const daysLeft = end ? daysBetween(today, end) : null;
  const current = topicStates(m);
  const progress = readinessOf(current, today);

  if (!end) {
    // No date (language, or exam without a date): steady spaced repetition.
    const { sessions } = simulateTopics(m, start, null, m.minutesPerDay, horizon);
    const weakest = [...current].sort((a, b) => knowledgeAt(a, today) - knowledgeAt(b, today))[0];
    return {
      sessions,
      today: sessions.find((s) => s.date === isoDay(now)) ?? null,
      daysLeft,
      forecast: {
        readiness: null,
        progress,
        onTrack: true,
        projectedFinish: null,
        extraMinutes: 0,
        atRisk: current.filter((s) => knowledgeAt(s, today) < 0.5).map((s) => s.topic.title),
        headline: { key: 'mission.headline.mastery', params: { pct: progress } },
        reasons: weakest ? [{ key: 'mission.reason.weakest', params: { topic: weakest.topic.title } }] : [],
      },
    };
  }

  const run = (minutes: number) => simulateTopics(m, start, end, minutes, horizon);
  const base = run(m.minutesPerDay);
  const readiness = readinessOf(base.states, end);
  // Smallest daily increase that brings the forecast back on track (≥ 80 %).
  let extraMinutes = 0;
  let tooLate = false;
  if (readiness < 80) {
    tooLate = true;
    for (let extra = 10; extra <= 60; extra += 10) {
      if (readinessOf(run(m.minutesPerDay + extra).states, end) >= 80) {
        extraMinutes = extra;
        tooLate = false;
        break;
      }
    }
  }
  const atRisk = base.states.filter((s) => knowledgeAt(s, end) < 0.7).map((s) => s.topic.title);
  const reasons: MissionReason[] = [{ key: 'mission.reason.daysLeft', params: { days: daysLeft ?? 0 } }];
  const next = base.sessions[0];
  if (next?.topic) reasons.push({ key: 'mission.reason.weakest', params: { topic: next.topic } });
  if (extraMinutes) reasons.push({ key: 'mission.reason.extra', params: { minutes: extraMinutes } });
  if (tooLate) reasons.push({ key: 'mission.reason.tooLate' });
  if (atRisk.length)
    reasons.push({ key: 'mission.reason.atRisk', params: { topics: atRisk.slice(0, 3).join(', ') } });
  return {
    sessions: base.sessions.slice(0, Math.max(horizon, 3)),
    today: base.sessions.find((s) => s.date === isoDay(now)) ?? null,
    daysLeft,
    forecast: {
      readiness,
      progress,
      onTrack: readiness >= 80,
      projectedFinish: isoDay(end),
      extraMinutes,
      atRisk,
      headline: { key: 'mission.headline.readiness', params: { pct: readiness } },
      reasons,
    },
  };
}

/* -------------------------------- steps model ------------------------------ */

function planSteps(m: Mission, now: Date): MissionPlan {
  const today = startOfDay(now);
  const target = toDate(m.targetDate) ?? addDays(today, 7);
  const steps = STEPS[m.kind as 'interview' | 'presentation'] ?? STEPS.interview;
  const done = new Set((m.log ?? []).map((l) => l.step).filter(Boolean));
  const totalMinutes = steps.reduce((a, [, , min]) => a + min, 0);
  const doneMinutes = steps.filter(([k]) => done.has(k)).reduce((a, [, , min]) => a + min, 0);
  const daysLeft = daysBetween(today, target);

  const sessions: PlannedSession[] = [];
  const overdue: string[] = [];
  for (const [step, offset, minutes] of steps) {
    if (done.has(step)) continue;
    const due = startOfDay(addDays(target, offset));
    if (due < today) overdue.push(step);
    const day = due < today ? today : due;
    sessions.push({ date: isoDay(day), minutes, kind: 'step', step });
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date));

  // Remaining work that must happen before the target versus the time left.
  const before = sessions.filter((s) => s.date < isoDay(target));
  const needed = before.reduce((a, s) => a + s.minutes, 0);
  const available = Math.max(0, daysLeft) * m.minutesPerDay;
  const onTrack = needed <= available && overdue.length <= 1;
  const progress = Math.round((doneMinutes / totalMinutes) * 100);
  const extraMinutes =
    !onTrack && daysLeft > 0 ? Math.max(0, Math.ceil((needed - available) / daysLeft / 5) * 5) : 0;
  const reasons: MissionReason[] = [
    { key: 'mission.reason.daysLeft', params: { days: Math.max(0, daysLeft) } },
  ];
  if (overdue.length) reasons.push({ key: 'mission.reason.overdueSteps', params: { count: overdue.length } });
  reasons.push({ key: 'mission.reason.remaining', params: { minutes: needed } });
  return {
    sessions,
    today: sessions.find((s) => s.date === isoDay(now)) ?? null,
    daysLeft,
    forecast: {
      readiness: progress,
      progress,
      onTrack,
      projectedFinish: isoDay(target),
      extraMinutes,
      atRisk: overdue,
      headline: {
        key: 'mission.headline.steps',
        params: { done: steps.length - sessions.length, total: steps.length },
      },
      reasons,
    },
  };
}

/* --------------------------------- pace model ------------------------------ */

export const DEFAULT_PAGES_PER_MINUTE = 0.8;

export function currentPage(m: Mission): number {
  const pages = (m.log ?? []).map((l) => l.page ?? 0);
  return Math.max(m.startPage ?? 0, ...pages, 0);
}

/** Pages per minute measured on the latest sessions that recorded a page. */
export function readingPace(m: Mission): number {
  let previous = m.startPage ?? 0;
  const samples: { pages: number; minutes: number }[] = [];
  for (const l of sortedLog(m)) {
    if (l.page == null || !l.minutes) continue;
    const pages = l.page - previous;
    if (pages > 0) samples.push({ pages, minutes: l.minutes });
    previous = Math.max(previous, l.page);
  }
  const recent = samples.slice(-5);
  const minutes = recent.reduce((a, s) => a + s.minutes, 0);
  if (minutes < 15) return DEFAULT_PAGES_PER_MINUTE;
  return clamp(recent.reduce((a, s) => a + s.pages, 0) / minutes, 0.1, 5);
}

function planPace(m: Mission, now: Date, horizon: number): MissionPlan {
  const today = startOfDay(now);
  const total = Math.max(1, m.totalPages ?? 1);
  const page = Math.min(total, currentPage(m));
  const pace = readingPace(m);
  const perSession = Math.max(1, Math.round(pace * m.minutesPerDay));
  const start = doneToday(m, isoDay(now)) ? addDays(today, 1) : today;

  const sessions: PlannedSession[] = [];
  let cursor = page;
  let finish: Date | null = null;
  for (let i = 0; i < 730 && cursor < total; i++) {
    const day = addDays(start, i);
    if (!isTrainingDay(day, m.daysPerWeek)) continue;
    const to = Math.min(total, cursor + perSession);
    if (sessions.length < horizon) {
      const minutes = round5((to - cursor) / pace);
      sessions.push({ date: isoDay(day), minutes, kind: 'read', fromPage: cursor + 1, toPage: to });
    }
    cursor = to;
    if (cursor >= total) finish = day;
  }

  const target = toDate(m.targetDate);
  const daysLeft = target ? daysBetween(today, target) : null;
  let onTrack = true;
  let extraMinutes = 0;
  const reasons: MissionReason[] = [{ key: 'mission.reason.pace', params: { pages: Math.round(pace * 60) } }];
  if (target && page < total) {
    onTrack = Boolean(finish && finish <= startOfDay(target));
    if (!onTrack) {
      let readingDays = 0;
      for (let d = start; d <= target; d = addDays(d, 1)) if (isTrainingDay(d, m.daysPerWeek)) readingDays++;
      const needed = readingDays ? (total - page) / pace / readingDays : Infinity;
      extraMinutes = Number.isFinite(needed)
        ? Math.max(5, Math.ceil((needed - m.minutesPerDay) / 5) * 5)
        : 60;
      reasons.push({ key: 'mission.reason.extra', params: { minutes: extraMinutes } });
    }
  }
  reasons.push({ key: 'mission.reason.pagesLeft', params: { pages: total - page } });
  return {
    sessions,
    today: sessions.find((s) => s.date === isoDay(now)) ?? null,
    daysLeft,
    forecast: {
      readiness: null,
      progress: Math.round((page / total) * 100),
      onTrack,
      projectedFinish: page >= total ? isoDay(today) : finish ? isoDay(finish) : null,
      extraMinutes,
      atRisk: [],
      headline: finish
        ? { key: 'mission.headline.finish', params: { days: Math.max(0, daysBetween(today, finish)) } }
        : { key: 'mission.headline.finished' },
      reasons,
    },
  };
}

/* ------------------------------- program model ----------------------------- */

const ROTATION: SessionKind[] = ['endurance', 'strength', 'mobility'];
const BASE_MINUTES = { beginner: 20, intermediate: 30, advanced: 40 } as const;

/** Load multiplier: +10 % per week up to +80 %, deload (−30 %) every fourth week. */
export function loadFactor(week: number): number {
  if (week % 4 === 3) return 0.7;
  return 1 + 0.1 * Math.min(week, 8);
}

function planProgram(m: Mission, now: Date, horizon: number): MissionPlan {
  const today = startOfDay(now);
  const created = startOfDay(toDate(m.createdAt) ?? today);
  const log = sortedLog(m);
  const base = BASE_MINUTES[m.level ?? 'beginner'];
  const start = doneToday(m, isoDay(now)) ? addDays(today, 1) : today;

  const sessions: PlannedSession[] = [];
  let index = log.length;
  const last = log[log.length - 1];
  let lastHard = last?.rating === 'hard' ? toDate(last.date) : null;
  for (let i = 0; i < horizon; i++) {
    const day = addDays(start, i);
    if (!isTrainingDay(day, m.daysPerWeek)) continue;
    const week = Math.max(0, Math.floor(daysBetween(created, day) / 7));
    const minutes = round5(Math.min(m.minutesPerDay, base * loadFactor(week)));
    const afterHard = lastHard && daysBetween(lastHard, day) <= 1;
    const kind: SessionKind = afterHard ? 'recovery' : ROTATION[index % ROTATION.length]!;
    sessions.push({ date: isoDay(day), minutes: afterHard ? round5(minutes * 0.5) : minutes, kind });
    lastHard = null;
    index++;
  }

  // Consistency over the last four weeks (or since the start).
  const windowStart = addDays(today, -27) > created ? addDays(today, -27) : created;
  let expected = 0;
  for (let d = windowStart; d < today; d = addDays(d, 1)) if (isTrainingDay(d, m.daysPerWeek)) expected++;
  const doneRecent = log.filter((l) => l.date >= isoDay(windowStart) && l.date < isoDay(today)).length;
  const consistency = expected ? Math.round(clamp(doneRecent / expected, 0, 1) * 100) : 100;

  const target = toDate(m.targetDate);
  const daysLeft = target ? daysBetween(today, target) : null;
  let onTrack = consistency >= 70;
  const reasons: MissionReason[] = [{ key: 'mission.reason.consistency', params: { pct: consistency } }];
  let progress = consistency;
  if (target) {
    let required = 0;
    let remaining = 0;
    for (let d = created; d <= target; d = addDays(d, 1)) {
      if (!isTrainingDay(d, m.daysPerWeek)) continue;
      required++;
      if (d >= today) remaining++;
    }
    const projected = log.length + Math.round(remaining * (expected ? consistency / 100 : 1));
    progress = required ? Math.round(clamp(log.length / required, 0, 1) * 100) : 0;
    onTrack = projected >= required * 0.8;
    reasons.push({ key: 'mission.reason.sessionsProjected', params: { projected, required } });
    if (!onTrack) reasons.push({ key: 'mission.reason.addSession' });
  }
  if (last?.rating === 'hard') reasons.push({ key: 'mission.reason.recovery' });
  const week = Math.max(0, Math.floor(daysBetween(created, today) / 7));
  if (week % 4 === 3) reasons.push({ key: 'mission.reason.deload' });
  return {
    sessions,
    today: sessions.find((s) => s.date === isoDay(now)) ?? null,
    daysLeft,
    forecast: {
      readiness: null,
      progress,
      onTrack,
      projectedFinish: target ? isoDay(target) : null,
      extraMinutes: 0,
      atRisk: [],
      headline: { key: 'mission.headline.consistency', params: { pct: consistency, count: log.length } },
      reasons,
    },
  };
}

/* ---------------------------------- entry ---------------------------------- */

export function planMission(m: Mission, now: Date = new Date(), horizon = 14): MissionPlan {
  switch (MODEL[m.kind]) {
    case 'topics':
      return planTopics(m, now, horizon);
    case 'steps':
      return planSteps(m, now);
    case 'pace':
      return planPace(m, now, horizon);
    default:
      return planProgram(m, now, horizon);
  }
}

/** The log entry recorded when today's planned session is marked as done. */
export function sessionToLog(s: PlannedSession, rating: MissionLogEntry['rating'] = 'good'): MissionLogEntry {
  return {
    date: s.date,
    minutes: s.minutes,
    topicId: s.topicId ?? null,
    step: s.step ?? null,
    rating,
    page: s.toPage ?? null,
  };
}
