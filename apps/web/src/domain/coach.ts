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
import { addDays, isoDay, monthKey, startOfWeek, toDate } from './dates';
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
];

export function detectIntent(question: string): CoachIntent {
  for (const [intent, terms] of INTENT_TERMS) {
    if (includesAny(question, terms)) return intent;
  }
  return 'help';
}

export interface CoachInput {
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
  const a = builder(input);
  if (a.confidence === 'low' && !a.question) a.question = { key: 'coach.q.lowData' };
  return a;
}

const BUILDERS: Record<CoachIntent, (i: CoachInput) => CoachAnswer> = {
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
