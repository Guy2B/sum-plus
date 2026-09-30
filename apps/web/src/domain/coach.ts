/**
 * Σ Coach — grounded, deterministic answers built only from the user's data.
 *
 * Every answer lists the sources it actually read *and* that contained data;
 * when evidence is thin it says so and asks a clarifying question instead of
 * guessing. Wording is returned as i18n keys; user data is passed verbatim.
 */
import type { Settings, Snapshot } from './types';
import type { Arbitration, Decision } from './decision';
import type { Capacity } from './planning';
import { isTodayTask } from './planning';
import { summarizeMonth, formatMoney } from './finance';
import { healthTrend, habitStreak } from './wellbeing';
import { isStalled, projectNextStep, projectProgress } from './learning';
import { addDays, isoDay, monthKey, startOfWeek, toDate, WEEKDAY_KEYS } from './dates';
import { planMission } from './missions';
import { normalizeText } from './text';
import { includesAny } from './text';
import { domainEnabled } from './signals';

export type CoachIntent =
  | 'plan_day'
  | 'prioritize'
  | 'review'
  | 'finance'
  | 'project'
  | 'energy'
  | 'replies'
  | 'study'
  | 'goals'
  | 'household'
  | 'career'
  | 'forgetting'
  | 'canWait'
  | 'overload'
  | 'blocked'
  | 'freeUp'
  | 'help';

export interface Line {
  key: string;
  params?: Record<string, string | number>;
  /** Verbatim user/provider text, rendered as-is (already data, never translated). */
  text?: string;
}

export interface CoachAnswer {
  intent: CoachIntent;
  title: Line;
  lines: Line[];
  bullets: Line[];
  usedSources: { source: string; count: number }[];
  confidence: 'low' | 'medium' | 'high';
  question?: Line;
  actions: { key: string; route: string }[];
  disclaimer?: Line;
}

const INTENT_TERMS: [CoachIntent, string[]][] = [
  // Engine questions first: they are more specific than the topical intents below.
  ['forgetting', ['oubli', 'forget', 'vergess', 'olvid']],
  ['canWait', ['peut attendre', 'can wait', 'warten', 'puede esperar']],
  ['overload', ['surcharg', 'overload', 'too much', 'uberlast', 'sobrecarg']],
  ['freeUp', ['libere', 'free up', 'free my', 'freimachen', 'frei machen', 'liberame', 'libera']],
  [
    'finance',
    [
      'tresorerie',
      'cash',
      'budget',
      'argent',
      'money',
      'finance',
      'factur',
      'invoice',
      'depense',
      'expense',
      'revenu',
      'income',
      'geld',
      'finanz',
      'dinero',
      'gasto',
      'ingreso',
    ],
  ],
  [
    'energy',
    [
      'energie',
      'energy',
      'fatigue',
      'tired',
      'sommeil',
      'sleep',
      'stress',
      'repos',
      'rest',
      'burn',
      'mude',
      'schlaf',
      'cansad',
      'sueno',
      'sante',
      'health',
    ],
  ],
  [
    'replies',
    [
      'repondre',
      'reply',
      'mail',
      'email',
      'message',
      'inbox',
      'boite',
      'antwort',
      'correo',
      'responder',
      'commentaire',
      'comment',
    ],
  ],
  [
    'project',
    [
      'projet',
      'project',
      'bloque',
      'blocked',
      'unblock',
      'debloquer',
      'client',
      'mission',
      'projekt',
      'proyecto',
      'bloquead',
    ],
  ],
  [
    'study',
    [
      'revision',
      'reviser',
      'exam',
      'study',
      'etudier',
      'apprendre',
      'learn',
      'cours',
      'lernen',
      'estudiar',
      'examen',
      'competence',
      'skill',
    ],
  ],
  ['goals', ['objectif', 'goal', 'ziel', 'objetivo', 'but ', 'ambition']],
  [
    'household',
    [
      'enfant',
      'ecole',
      'famille',
      'school',
      'kid',
      'child',
      'kinder',
      'schule',
      'hijo',
      'escuela',
      'devoirs',
      'homework',
    ],
  ],
  [
    'career',
    [
      'candidature',
      'emploi',
      'job',
      'interview',
      'entretien',
      'cv',
      'bewerbung',
      'empleo',
      'recrut',
      'offre d',
    ],
  ],
  [
    'review',
    [
      'revue',
      'review',
      'bilan',
      'overview',
      'resume',
      'weekly',
      'hebdo',
      'semaine',
      'woche',
      'resumen',
      'semana',
      'point sur',
    ],
  ],
  [
    'plan_day',
    [
      'journee',
      'organise',
      'organiser',
      'planifi',
      'plan my',
      'my day',
      'today',
      "aujourd'hui",
      'tag',
      'dia',
      'agenda',
      'schedule',
    ],
  ],
  [
    'prioritize',
    [
      'priorit',
      'first',
      "d'abord",
      'zuerst',
      'primero',
      'quoi faire',
      'what should',
      'next',
      'prochaine',
      'important',
    ],
  ],
  // Generic "what blocks me": after the topical "project" intent.
  ['blocked', ['bloqu', 'block', 'stuck', 'coince', 'stagn', 'atasc']],
];

const PROJECT_NOUNS = ['projet', 'project', 'proyecto', 'projekt'];
const BLOCK_TERMS = ['bloqu', 'block', 'stuck', 'coince', 'atasc'];

export function detectIntent(question: string): CoachIntent {
  // "What is blocking me?" is about everything; "which project is stuck?" stays a project question.
  if (includesAny(question, BLOCK_TERMS) && !includesAny(question, PROJECT_NOUNS)) return 'blocked';
  for (const [intent, terms] of INTENT_TERMS) {
    if (includesAny(question, terms)) return intent;
  }
  return 'help';
}

export interface CoachInput {
  question?: string;
  snap: Snapshot;
  settings: Settings;
  decisions: Decision[];
  top: Arbitration;
  capacity: Capacity;
  now: Date;
}

const alive = <T extends { deletedAt?: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);

function decisionLine(d: Decision): Line {
  if (d.signal.titleKey) return { key: d.signal.titleKey, params: d.signal.titleParams };
  return { key: '', text: d.signal.title ?? '' };
}

function sourcesOf(decisions: Decision[]): { source: string; count: number }[] {
  const m = new Map<string, number>();
  for (const d of decisions) m.set(d.signal.sourceType, (m.get(d.signal.sourceType) ?? 0) + 1);
  return [...m.entries()].map(([source, count]) => ({ source, count }));
}

function confidenceFor(used: { count: number }[]): CoachAnswer['confidence'] {
  const total = used.reduce((s, u) => s + u.count, 0);
  if (used.length >= 2 && total >= 3) return 'high';
  if (total > 0) return 'medium';
  return 'low';
}

export function answer(question: string, input: CoachInput, forced?: CoachIntent): CoachAnswer {
  const intent = forced ?? detectIntent(question);
  const builder = BUILDERS[intent] ?? BUILDERS.help;
  const a = builder({ ...input, question });
  if (a.confidence === 'low' && !a.question) a.question = { key: 'coach.q.lowData' };
  return a;
}

const WEEKDAY_WORDS: Record<string, number> = {
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
  dimanche: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
  montag: 1,
  dienstag: 2,
  mittwoch: 3,
  donnerstag: 4,
  freitag: 5,
  samstag: 6,
  sonntag: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 0,
};

/** "What am I forgetting?": overdue items, replies waiting 2+ days, missions behind, stale inbox, stalled projects. */
function forgetting({ decisions, top, snap, now }: CoachInput): CoachAnswer {
  const shown = new Set(top.selected.map((d) => d.signal.id));
  const risky = decisions.filter(
    (d) =>
      !shown.has(d.signal.id) &&
      (d.firedRules.includes('overdue') ||
        (d.signal.sourceType === 'mail' && d.facts.waitingHours >= 48) ||
        (d.signal.sourceType === 'mission' && Boolean(d.signal.essential))),
  );
  const staleInbox = alive(snap.tasks).filter(
    (t) => t.status === 'inbox' && t.createdAt < addDays(now, -7).toISOString(),
  );
  const stalled = alive(snap.projects).filter((p) => isStalled(p, snap.tasks));
  const lines: Line[] = [];
  if (risky.length) lines.push({ key: 'coach.forget.risky', params: { count: risky.length } });
  if (staleInbox.length) lines.push({ key: 'coach.forget.inbox', params: { count: staleInbox.length } });
  for (const p of stalled.slice(0, 3))
    lines.push({ key: 'coach.forget.stalled', params: { project: p.name } });
  if (!lines.length) lines.push({ key: 'coach.forget.none' });
  const used = [
    ...sourcesOf(risky),
    ...(staleInbox.length ? [{ source: 'task', count: staleInbox.length }] : []),
    ...(stalled.length ? [{ source: 'project', count: stalled.length }] : []),
  ];
  return {
    intent: 'forgetting',
    title: { key: 'coach.forget.title' },
    lines,
    bullets: risky.slice(0, 6).map(decisionLine),
    usedSources: used,
    confidence: confidenceFor(used),
    actions: [{ key: 'coach.action.openAttention', route: 'attention' }],
  };
}

/** "What can wait?": not essential, no deadline in the next 3 days, not critical. */
function canWait({ decisions, top }: CoachInput): CoachAnswer {
  const shown = new Set(top.selected.map((d) => d.signal.id));
  const waitable = decisions
    .filter(
      (d) =>
        !shown.has(d.signal.id) &&
        !d.signal.essential &&
        (d.facts.hoursToDue === null || d.facts.hoursToDue > 72) &&
        d.band !== 'critical',
    )
    .slice(0, 6);
  const used = sourcesOf(waitable);
  return {
    intent: 'canWait',
    title: { key: 'coach.wait.title' },
    lines: waitable.length
      ? [{ key: 'coach.wait.intro', params: { count: waitable.length } }]
      : [{ key: 'coach.wait.none' }],
    bullets: waitable.map(decisionLine),
    usedSources: used,
    confidence: confidenceFor(used),
    actions: [{ key: 'coach.action.openPlan', route: 'plan' }],
  };
}

/** "Why is my week overloaded?": needed hours (tasks due, meetings, mission sessions) vs available. */
function overload({ snap, capacity, now }: CoachInput): CoachAnswer {
  const endIso = addDays(now, 7).toISOString();
  const tasks = alive(snap.tasks).filter(
    (t) => t.status !== 'done' && t.dueDate && t.dueDate <= isoDay(addDays(now, 7)),
  );
  const taskMinutes = tasks.reduce((a, t) => a + (t.estimateMinutes ?? 30), 0);
  const events = alive(snap.events).filter(
    (e) => !e.allDay && e.start >= now.toISOString() && e.start <= endIso,
  );
  const meetingMinutes = events.reduce(
    (a, e) => a + Math.max(0, (new Date(e.end).getTime() - new Date(e.start).getTime()) / 60_000),
    0,
  );
  const missions = alive(snap.missions ?? []).filter((m) => m.status === 'active');
  const missionMinutes = missions.reduce(
    (a, m) => a + planMission(m, now, 7).sessions.reduce((s, x) => s + x.minutes, 0),
    0,
  );
  const available = Math.max(60, capacity.capacityMinutes) * 5;
  const needed = taskMinutes + meetingMinutes + missionMinutes;
  const pct = Math.round((needed / available) * 100);
  const h = (m: number) => Math.round(m / 60);
  const biggest = [...tasks]
    .sort((a, b) => (b.estimateMinutes ?? 30) - (a.estimateMinutes ?? 30))
    .slice(0, 3);
  const used = [
    { source: 'task', count: tasks.length },
    { source: 'event', count: events.length },
    { source: 'mission', count: missions.length },
  ].filter((u) => u.count);
  return {
    intent: 'overload',
    title: { key: 'coach.overload.title' },
    lines: [
      { key: 'coach.overload.summary', params: { needed: h(needed), available: h(available), pct } },
      {
        key: 'coach.overload.split',
        params: { tasks: h(taskMinutes), meetings: h(meetingMinutes), missions: h(missionMinutes) },
      },
      { key: pct > 100 ? 'coach.overload.yes' : 'coach.overload.no' },
    ],
    bullets: biggest.map((t) => ({
      key: 'coach.overload.big',
      params: { what: t.title, minutes: t.estimateMinutes ?? 30 },
    })),
    usedSources: used,
    confidence: confidenceFor(used),
    actions: [{ key: 'coach.action.openPlan', route: 'plan' }],
  };
}

/** "What is blocking?": projects without a next step or with an overdue step, missions behind. */
function blocked({ snap, now }: CoachInput): CoachAnswer {
  const today = isoDay(now);
  const stalled = alive(snap.projects).filter((p) => isStalled(p, snap.tasks));
  const late = alive(snap.projects).filter(
    (p) =>
      p.status === 'active' &&
      alive(snap.tasks).some(
        (t) => t.projectId === p.id && t.status !== 'done' && t.dueDate && t.dueDate < today,
      ),
  );
  const behind = alive(snap.missions ?? [])
    .filter((m) => m.status === 'active')
    .map((m) => ({ m, f: planMission(m, now).forecast }))
    .filter((x) => !x.f.onTrack);
  const bullets: Line[] = [
    ...stalled.map((p) => ({ key: 'coach.blocked.noNext', params: { what: p.name } })),
    ...late.map((p) => ({ key: 'coach.blocked.late', params: { what: p.name } })),
    ...behind.map((x) => ({ key: 'coach.blocked.mission', params: { what: x.m.title } })),
  ];
  const used = [
    { source: 'project', count: stalled.length + late.length },
    { source: 'mission', count: behind.length },
  ].filter((u) => u.count);
  return {
    intent: 'blocked',
    title: { key: 'coach.blocked.title' },
    lines: bullets.length ? [] : [{ key: 'coach.blocked.none' }],
    bullets,
    usedSources: used,
    confidence: bullets.length ? 'high' : 'medium',
    actions: [{ key: 'coach.action.openProjects', route: 'projects' }],
  };
}

/** "Free up my Friday afternoon": what occupies that window and how much must move. */
function freeUp({ snap, now, question }: CoachInput): CoachAnswer {
  const q = normalizeText(question ?? '');
  const wd =
    q
      .split(/[^a-z]+/)
      .map((w) => WEEKDAY_WORDS[w])
      .find((x) => x !== undefined) ?? 5;
  const afternoon = /apres|afternoon|nachmittag|tarde/.test(q);
  let day = new Date(now);
  for (let i = 0; i < 7 && day.getDay() !== wd; i++) day = addDays(day, 1);
  const iso = isoDay(day);
  const events = alive(snap.events).filter(
    (e) => !e.allDay && e.start.startsWith(iso) && (!afternoon || new Date(e.start).getHours() >= 12),
  );
  const due = alive(snap.tasks).filter((t) => t.status !== 'done' && t.dueDate === iso);
  const sessions = alive(snap.missions ?? [])
    .filter((m) => m.status === 'active')
    .flatMap((m) =>
      planMission(m, now, 10)
        .sessions.filter((s) => s.date === iso)
        .map(() => m.title),
    );
  const bullets: Line[] = [
    ...events.map((e) => ({ key: 'coach.free.event', params: { what: e.title } })),
    ...due.map((t) => ({ key: 'coach.free.due', params: { what: t.title } })),
    ...sessions.map((what) => ({ key: 'coach.free.session', params: { what } })),
  ];
  const lines: Line[] = [
    {
      key: afternoon ? 'coach.free.dayAfternoon' : 'coach.free.day',
      params: { day: `@weekday.${WEEKDAY_KEYS[wd]}` },
    },
  ];
  lines.push(
    bullets.length
      ? {
          key: 'coach.free.advice',
          params: { events: events.length, due: due.length, sessions: sessions.length },
        }
      : { key: 'coach.free.already' },
  );
  const used = [
    { source: 'event', count: events.length },
    { source: 'task', count: due.length },
    { source: 'mission', count: sessions.length },
  ].filter((u) => u.count);
  return {
    intent: 'freeUp',
    title: { key: 'coach.free.title' },
    lines,
    bullets,
    usedSources: used,
    confidence: used.length ? 'high' : 'medium',
    actions: [{ key: 'coach.action.openCalendar', route: 'calendar' }],
  };
}

const BUILDERS: Record<CoachIntent, (i: CoachInput) => CoachAnswer> = {
  forgetting,
  canWait,
  overload,
  blocked,
  freeUp,
  plan_day: ({ top, capacity }) => {
    const used = sourcesOf(top.selected);
    if (capacity.meetingMinutes > 0) used.push({ source: 'event', count: 1 });
    if (capacity.energyMeasured && !used.some((u) => u.source === 'health'))
      used.push({ source: 'health', count: 1 });
    const lines: Line[] = [
      {
        key: 'coach.plan.capacity',
        params: {
          capacity: capacity.capacityMinutes,
          meetings: capacity.meetingMinutes,
          load: capacity.loadPct,
        },
      },
    ];
    if (capacity.status === 'overloaded') lines.push({ key: 'coach.plan.overloaded' });
    if (capacity.energyMeasured && capacity.energyFactor < 1)
      lines.push({
        key: 'coach.plan.lowEnergy',
        params: { pct: Math.round((1 - capacity.energyFactor) * 100) },
      });
    const bullets = top.selected.map((d) => ({
      ...decisionLine(d),
      params: { ...(decisionLine(d).params ?? {}), minutes: d.facts.effortMinutes },
    }));
    if (!bullets.length) lines.push({ key: 'coach.plan.empty' });
    return {
      intent: 'plan_day',
      title: { key: 'coach.plan.title' },
      lines,
      bullets,
      usedSources: used,
      confidence: confidenceFor(used),
      actions: [{ key: 'coach.action.openPlan', route: 'plan' }],
    };
  },

  prioritize: ({ decisions }) => {
    const best = decisions.find((d) => d.action !== 'ignore' && d.band !== 'low');
    const used = sourcesOf(decisions.slice(0, 10));
    if (!best) {
      return {
        intent: 'prioritize',
        title: { key: 'coach.prio.title' },
        lines: [{ key: 'coach.prio.none' }],
        bullets: [],
        usedSources: used,
        confidence: confidenceFor(used),
        actions: [{ key: 'coach.action.capture', route: 'tasks' }],
      };
    }
    return {
      intent: 'prioritize',
      title: { key: 'coach.prio.title' },
      lines: [{ key: 'coach.prio.best', params: { score: best.score } }, decisionLine(best)],
      bullets: best.reasons.slice(0, 3).map((r) => ({ key: r.key, params: r.params })),
      usedSources: used,
      confidence: best.facts.confidence >= 75 ? confidenceFor(used) : 'medium',
      actions: [{ key: 'coach.action.openToday', route: 'today' }],
    };
  },

  review: ({ snap, now, settings }) => {
    const weekStart = startOfWeek(now).toISOString();
    const tasks = alive(snap.tasks);
    const open = tasks.filter((t) => t.status !== 'done');
    const overdue = open.filter((t) => {
      const d = toDate(t.dueDate);
      return d && d < now;
    });
    const doneWeek = tasks.filter((t) => t.status === 'done' && (t.completedAt ?? t.updatedAt) >= weekStart);
    const projects = alive(snap.projects).filter((p) => p.status === 'active');
    const stalled = projects.filter((p) => isStalled(p, tasks));
    const replies = domainEnabled(settings.context, 'mail')
      ? alive(snap.mailMessages).filter((m) => m.needsReply && !m.resolved)
      : [];
    const habits = alive(snap.habits).filter((h) => !h.archived);
    const used = [
      { source: 'task', count: tasks.length },
      { source: 'project', count: projects.length },
      { source: 'mail', count: replies.length },
      { source: 'habit', count: habits.length },
    ].filter((u) => u.count > 0);
    const bullets: Line[] = [
      {
        key: 'coach.review.tasks',
        params: { open: open.length, overdue: overdue.length, done: doneWeek.length },
      },
    ];
    if (projects.length)
      bullets.push({
        key: 'coach.review.projects',
        params: { active: projects.length, stalled: stalled.length },
      });
    if (replies.length) bullets.push({ key: 'coach.review.replies', params: { count: replies.length } });
    const best = habits
      .map((h) => ({ h, s: habitStreak(h, snap.habitLogs, now) }))
      .sort((a, b) => b.s - a.s)[0];
    if (best && best.s > 0)
      bullets.push({ key: 'coach.review.habit', params: { name: best.h.name, streak: best.s } });
    const lines: Line[] = [];
    if (overdue.length) lines.push({ key: 'coach.review.overdueAdvice', params: { count: overdue.length } });
    if (stalled[0]) lines.push({ key: 'coach.review.stalledAdvice', params: { name: stalled[0].name } });
    if (!lines.length && used.length) lines.push({ key: 'coach.review.onTrack' });
    return {
      intent: 'review',
      title: { key: 'coach.review.title' },
      lines,
      bullets,
      usedSources: used,
      confidence: confidenceFor(used),
      actions: [{ key: 'coach.action.openTasks', route: 'tasks' }],
    };
  },

  finance: ({ snap, settings, now }) => {
    if (!domainEnabled(settings.context, 'finance')) return disabled('finance');
    const entries = alive(snap.finance);
    if (!entries.length) {
      return {
        intent: 'finance',
        title: { key: 'coach.finance.title' },
        lines: [{ key: 'coach.finance.noData' }],
        bullets: [],
        usedSources: [],
        confidence: 'low',
        actions: [{ key: 'coach.action.openFinance', route: 'finance' }],
      };
    }
    const m = summarizeMonth(entries, monthKey(now));
    const money = (v: number) => formatMoney(v, settings.currency, settings.locale);
    const bullets: Line[] = [
      {
        key: 'coach.finance.balance',
        params: { income: money(m.income), expense: money(m.expense), balance: money(m.balance) },
      },
    ];
    if (m.pendingIncome)
      bullets.push({ key: 'coach.finance.pendingIncome', params: { amount: money(m.pendingIncome) } });
    if (m.pendingExpense)
      bullets.push({ key: 'coach.finance.pendingExpense', params: { amount: money(m.pendingExpense) } });
    const topExpense = m.byCategory.find((c) => c.kind === 'expense');
    if (topExpense)
      bullets.push({
        key: 'coach.finance.topExpense',
        params: { category: topExpense.category, amount: money(topExpense.total) },
      });
    const lines: Line[] = [];
    if (m.overdueCount) lines.push({ key: 'coach.finance.overdue', params: { count: m.overdueCount } });
    else if (m.balance < 0) lines.push({ key: 'coach.finance.negative' });
    else lines.push({ key: 'coach.finance.ok' });
    return {
      intent: 'finance',
      title: { key: 'coach.finance.title' },
      lines,
      bullets,
      usedSources: [{ source: 'finance', count: entries.length }],
      confidence: entries.length >= 5 ? 'high' : 'medium',
      actions: [{ key: 'coach.action.openFinance', route: 'finance' }],
      disclaimer: { key: 'coach.disclaimer.finance' },
    };
  },

  project: ({ snap }) => {
    const tasks = alive(snap.tasks);
    const projects = alive(snap.projects).filter((p) => p.status === 'active');
    if (!projects.length) {
      return {
        intent: 'project',
        title: { key: 'coach.project.title' },
        lines: [{ key: 'coach.project.none' }],
        bullets: [],
        usedSources: [],
        confidence: 'low',
        actions: [{ key: 'coach.action.openProjects', route: 'projects' }],
      };
    }
    const stalled = projects.filter((p) => isStalled(p, tasks));
    const focus =
      stalled[0] ?? [...projects].sort((a, b) => projectProgress(a, tasks) - projectProgress(b, tasks))[0]!;
    const next = projectNextStep(focus, tasks);
    const lines: Line[] = [
      stalled.length
        ? { key: 'coach.project.stalled', params: { name: focus.name } }
        : {
            key: 'coach.project.slowest',
            params: { name: focus.name, progress: projectProgress(focus, tasks) },
          },
      next ? { key: 'coach.project.next', params: { step: next } } : { key: 'coach.project.defineNext' },
    ];
    return {
      intent: 'project',
      title: { key: 'coach.project.title' },
      lines,
      bullets: projects.slice(0, 5).map((p) => ({
        key: 'coach.project.item',
        params: { name: p.name, progress: projectProgress(p, tasks) },
      })),
      usedSources: [
        { source: 'project', count: projects.length },
        ...(tasks.some((t) => t.projectId)
          ? [{ source: 'task', count: tasks.filter((t) => t.projectId).length }]
          : []),
      ],
      confidence: 'high',
      actions: [{ key: 'coach.action.openProjects', route: 'projects' }],
    };
  },

  energy: ({ snap, settings, now, capacity }) => {
    if (!domainEnabled(settings.context, 'health')) return disabled('health');
    const trend = healthTrend(snap.health, now, 14);
    const measured = trend.series.filter((s) => s.sleepHours != null || s.energy != null).length;
    const disclaimer = { key: 'coach.disclaimer.health' };
    if (!measured) {
      return {
        intent: 'energy',
        title: { key: 'coach.energy.title' },
        lines: [{ key: 'coach.energy.noData' }],
        bullets: [],
        usedSources: [],
        confidence: 'low',
        actions: [{ key: 'coach.action.openHealth', route: 'health' }],
        disclaimer,
      };
    }
    const bullets: Line[] = [];
    if (trend.avgSleep != null)
      bullets.push({
        key: 'coach.energy.sleep',
        params: { hours: trend.avgSleep, trend: trend.sleepTrend ?? 'flat' },
      });
    if (trend.avgEnergy != null)
      bullets.push({ key: 'coach.energy.energy', params: { value: trend.avgEnergy } });
    const lines: Line[] = [];
    if (trend.readiness != null && trend.readiness < 50)
      lines.push({ key: 'coach.energy.protect', params: { capacity: capacity.capacityMinutes } });
    else lines.push({ key: 'coach.energy.steady' });
    return {
      intent: 'energy',
      title: { key: 'coach.energy.title' },
      lines,
      bullets,
      usedSources: [{ source: 'health', count: measured }],
      confidence: measured >= 5 ? 'high' : 'medium',
      actions: [{ key: 'coach.action.openHealth', route: 'health' }],
      disclaimer,
    };
  },

  replies: ({ decisions, settings }) => {
    const pending = decisions.filter(
      (d) =>
        d.signal.needsReply &&
        (d.signal.sourceType === 'mail'
          ? domainEnabled(settings.context, 'mail')
          : domainEnabled(settings.context, 'social')),
    );
    if (!pending.length) {
      return {
        intent: 'replies',
        title: { key: 'coach.replies.title' },
        lines: [{ key: 'coach.replies.none' }],
        bullets: [],
        usedSources: [],
        confidence: 'low',
        actions: [{ key: 'coach.action.openSources', route: 'sources' }],
      };
    }
    const oldest = [...pending].sort((a, b) => b.facts.waitingHours - a.facts.waitingHours)[0]!;
    return {
      intent: 'replies',
      title: { key: 'coach.replies.title' },
      lines: [
        {
          key: 'coach.replies.count',
          params: { count: pending.length, hours: Math.round(oldest.facts.waitingHours) },
        },
      ],
      bullets: pending.slice(0, 3).map((d) => ({
        key: 'coach.replies.item',
        params: { sender: d.signal.sender ?? '—', subject: d.signal.title ?? '' },
      })),
      usedSources: sourcesOf(pending),
      confidence: 'high',
      actions: [{ key: 'coach.action.openAttention', route: 'attention' }],
    };
  },

  study: ({ snap, now }) => {
    const today = isoDay(now);
    const skills = alive(snap.skills);
    const due = skills.filter((s) => s.nextReviewAt && s.nextReviewAt <= today);
    const academic = alive(snap.tasks).filter((t) => t.status !== 'done' && t.category === 'learning');
    const used = [
      { source: 'learning', count: skills.length },
      { source: 'task', count: academic.length },
    ].filter((u) => u.count > 0);
    const bullets: Line[] = [
      ...due
        .slice(0, 3)
        .map((s) => ({ key: 'coach.study.review', params: { name: s.name, progress: s.progress } })),
      ...academic.slice(0, 3).map((t) => ({ key: '', text: t.title })),
    ];
    return {
      intent: 'study',
      title: { key: 'coach.study.title' },
      lines: [
        bullets.length
          ? { key: 'coach.study.plan', params: { count: bullets.length } }
          : { key: 'coach.study.none' },
      ],
      bullets,
      usedSources: used,
      confidence: confidenceFor(used),
      actions: [{ key: 'coach.action.openLearning', route: 'missions' }],
    };
  },

  goals: ({ snap, settings }) => {
    const goals = alive(snap.goals).filter((g) => g.status === 'active');
    const lines: Line[] = [];
    if (settings.context.primaryGoal)
      lines.push({ key: 'coach.goals.primary', params: { goal: settings.context.primaryGoal } });
    if (!goals.length && !settings.context.primaryGoal) lines.push({ key: 'coach.goals.none' });
    const tasks = alive(snap.tasks);
    const bullets = goals.slice(0, 5).map((g) => ({
      key: 'coach.goals.item',
      params: {
        title: g.title,
        progress: g.targetValue ? Math.round(((g.currentValue ?? 0) / g.targetValue) * 100) : 0,
        tasks: tasks.filter((t) => t.goalId === g.id && t.status !== 'done').length,
      },
    }));
    const used = [{ source: 'goal', count: goals.length }].filter((u) => u.count > 0);
    return {
      intent: 'goals',
      title: { key: 'coach.goals.title' },
      lines,
      bullets,
      usedSources: used,
      confidence: confidenceFor(used),
      actions: [{ key: 'coach.action.openContext', route: 'context' }],
    };
  },

  household: ({ snap, settings, now }) => {
    if (!domainEnabled(settings.context, 'household')) return disabled('household');
    const members = new Map(alive(snap.household).map((m) => [m.id, m.name]));
    const horizon = isoDay(addDays(now, 7));
    const items = alive(snap.schoolItems).filter((s) => !s.done && s.dueDate && s.dueDate <= horizon);
    return {
      intent: 'household',
      title: { key: 'coach.household.title' },
      lines: [
        items.length
          ? { key: 'coach.household.count', params: { count: items.length } }
          : { key: 'coach.household.none' },
      ],
      bullets: items.slice(0, 5).map((s) => ({
        key: 'coach.household.item',
        params: { member: members.get(s.memberId) ?? '', title: s.title, date: s.dueDate ?? '' },
      })),
      usedSources: items.length ? [{ source: 'household', count: items.length }] : [],
      confidence: items.length ? 'high' : 'low',
      actions: [{ key: 'coach.action.openHousehold', route: 'household' }],
    };
  },

  career: ({ snap, settings }) => {
    if (!domainEnabled(settings.context, 'career')) return disabled('career');
    const apps = alive(snap.applications).filter((a) => a.stage !== 'rejected' && a.stage !== 'accepted');
    const byStage = apps.reduce<Record<string, number>>(
      (acc, a) => ((acc[a.stage] = (acc[a.stage] ?? 0) + 1), acc),
      {},
    );
    const next = apps
      .filter((a) => a.nextActionAt)
      .sort((a, b) => (a.nextActionAt ?? '').localeCompare(b.nextActionAt ?? ''));
    return {
      intent: 'career',
      title: { key: 'coach.career.title' },
      lines: [
        apps.length
          ? {
              key: 'coach.career.pipeline',
              params: { total: apps.length, interviews: byStage.interview ?? 0, offers: byStage.offer ?? 0 },
            }
          : { key: 'coach.career.none' },
      ],
      bullets: next.slice(0, 3).map((a) => ({
        key: 'coach.career.item',
        params: {
          company: a.company,
          role: a.role,
          action: a.nextAction ?? '',
          date: a.nextActionAt ?? '',
        },
      })),
      usedSources: apps.length ? [{ source: 'career', count: apps.length }] : [],
      confidence: apps.length ? 'high' : 'low',
      actions: [{ key: 'coach.action.openCareer', route: 'missions' }],
    };
  },

  help: ({ snap, now }) => {
    const openToday = alive(snap.tasks).filter((t) => isTodayTask(t, now)).length;
    return {
      intent: 'help',
      title: { key: 'coach.help.title' },
      lines: [
        { key: 'coach.help.intro' },
        ...(openToday ? [{ key: 'coach.help.today', params: { count: openToday } }] : []),
      ],
      bullets: [
        { key: 'coach.help.s1' },
        { key: 'coach.help.s2' },
        { key: 'coach.help.s3' },
        { key: 'coach.help.s4' },
      ],
      usedSources: openToday ? [{ source: 'task', count: openToday }] : [],
      confidence: 'medium',
      actions: [],
    };
  },
};

function disabled(domain: string): CoachAnswer {
  return {
    intent: 'help',
    title: { key: 'coach.disabled.title' },
    lines: [{ key: 'coach.disabled.body', params: { domain } }],
    bullets: [],
    usedSources: [],
    confidence: 'low',
    question: { key: 'coach.q.enableDomain' },
    actions: [{ key: 'coach.action.openContext', route: 'context' }],
  };
}
