/**
 * Demo workspace generator used by onboarding ("try with examples") and the
 * admin QA scenarios. Every seeded record is tagged so it can be removed in
 * one click without touching real data.
 */
import type { EditionKey, Locale } from '../domain/types';
import { COLLECTIONS } from '../domain/types';
import { editionDemo } from '../domain/editions';
import { addDays, isoDay, atTime } from '../domain/dates';
import { newId } from '../domain/ids';
import { DEMO_PROVIDER, isDemoRecord } from '../domain/demo';
import { convertModulesToMissions, createMany, remove, snapshot } from './store';

export { DEMO_PROVIDER };

export async function seedDemo(edition: EditionKey, locale: Locale, now: Date = new Date()): Promise<void> {
  const demo = editionDemo(edition, locale);
  const src = { provider: DEMO_PROVIDER };
  const d = (n: number) => isoDay(addDays(now, n));
  // Fixed ids so the demo shows a goal → project → action chain.
  const goalId = newId('demo');
  const projectId = newId('demo');

  await createMany(
    'tasks',
    demo.tasks.map((title, i) => ({
      id: newId('demo'),
      title,
      category: i === 3 ? 'projects' : 'work',
      status: i === 3 ? 'inbox' : 'todo',
      priority: i === 0 ? 'high' : 'medium',
      essential: i === 0,
      dueDate: i === 0 ? d(0) : i === 1 ? d(1) : i === 2 ? d(4) : null,
      estimateMinutes: [45, 30, 20, 15][i] ?? 30,
      projectId: i === 1 ? projectId : null,
      source: src,
    })),
  );

  const [projectName, ...steps] = demo.project;
  await createMany('projects', [
    {
      id: projectId,
      goalId,
      name: projectName ?? '—',
      description: '',
      status: 'active',
      dueDate: d(21),
      milestones: steps.map((title, i) => ({ id: newId(), title, done: i === 0, dueDate: d(3 + i * 5) })),
    },
  ]);

  await createMany('finance', [
    {
      id: newId('demo'),
      date: d(-6),
      kind: 'income',
      amount: 180000,
      currency: 'EUR',
      category: 'client',
      label: demo.income,
      status: 'paid',
      taxRelevant: true,
    },
    {
      id: newId('demo'),
      date: d(-2),
      kind: 'expense',
      amount: 4900,
      currency: 'EUR',
      category: 'tools',
      label: demo.expense,
      status: 'paid',
      taxRelevant: true,
    },
    {
      id: newId('demo'),
      date: d(-1),
      kind: 'income',
      amount: 65000,
      currency: 'EUR',
      category: 'client',
      label: demo.income,
      status: 'pending',
      dueDate: d(5),
    },
  ]);

  await createMany('journal', [
    {
      id: newId('demo'),
      date: d(-1),
      kind: 'reflection',
      text: `${demo.journal}\n\n${demo.gratitude}`,
      mood: 4,
      tags: [],
    },
  ]);

  await createMany('skills', [
    {
      id: newId('demo'),
      name: demo.skill,
      target: 'B1',
      progress: 35,
      nextReviewAt: d(0),
      reviewIntervalDays: 2,
      resources: [],
    },
  ]);

  await createMany(
    'goals',
    demo.goals.slice(0, 3).map((title, i) => ({
      id: i === 0 ? goalId : newId('demo'),
      title,
      horizon: i === 0 ? 'week' : i === 1 ? 'month' : 'quarter',
      status: 'active',
      targetValue: 100,
      currentValue: [20, 45, 10][i] ?? 0,
    })),
  );

  await createMany('habits', [
    { id: newId('demo'), name: demo.goals[4] ?? demo.skill, cadence: 'daily', domain: 'personal' },
  ]);

  await createMany(
    'events',
    demo.events.map((title, i) => {
      const day = addDays(now, i === 0 ? 1 : 3);
      const start = atTime(day, i === 0 ? '10:00' : '16:00');
      return {
        id: newId('demo'),
        title,
        start: start.toISOString(),
        end: new Date(start.getTime() + 3_600_000).toISOString(),
        source: src,
      };
    }),
  );

  const fitness = { fr: 'Remise en forme', en: 'Get fit', de: 'Fit werden', es: 'Ponerse en forma' }[locale];
  await createMany('missions', [
    {
      id: newId('demo'),
      kind: 'fitness',
      title: fitness,
      status: 'active',
      minutesPerDay: 30,
      daysPerWeek: 3,
      level: 'beginner',
      topics: [],
      targetDate: d(42),
      log: [
        { date: d(-5), minutes: 20, rating: 'good' },
        { date: d(-3), minutes: 25, rating: 'good' },
      ],
    },
    {
      id: newId('demo'),
      kind: 'book',
      title: 'Atomic Habits',
      status: 'active',
      minutesPerDay: 20,
      daysPerWeek: 5,
      topics: [],
      totalPages: 320,
      startPage: 40,
      targetDate: d(30),
      log: [
        { date: d(-2), minutes: 20, page: 58, rating: 'good' },
        { date: d(-1), minutes: 25, page: 80, rating: 'good' },
      ],
    },
  ]);

  // A realistic week: two mails waiting for an answer, a busy afternoon, a conflict tomorrow.
  const mails = {
    fr: [
      [
        'Marc Dubois',
        'marc.dubois@example.com',
        'Devis pour lundi ?',
        'Pouvez-vous m’envoyer le devis avant lundi ? On valide mardi.',
      ],
      [
        'Sophie Martin',
        'sophie@example.com',
        'Point rapide cette semaine ?',
        'J’aimerais caler 30 min pour parler du partenariat.',
      ],
    ],
    en: [
      [
        'Marc Dubois',
        'marc.dubois@example.com',
        'Quote for Monday?',
        'Could you send the quote before Monday? We decide on Tuesday.',
      ],
      [
        'Sophie Martin',
        'sophie@example.com',
        'Quick call this week?',
        'I would like 30 minutes to discuss the partnership.',
      ],
    ],
    de: [
      [
        'Marc Dubois',
        'marc.dubois@example.com',
        'Angebot bis Montag?',
        'Können Sie mir das Angebot vor Montag schicken? Wir entscheiden am Dienstag.',
      ],
      [
        'Sophie Martin',
        'sophie@example.com',
        'Kurzer Termin diese Woche?',
        'Ich hätte gern 30 Minuten für die Partnerschaft.',
      ],
    ],
    es: [
      [
        'Marc Dubois',
        'marc.dubois@example.com',
        '¿Presupuesto para el lunes?',
        '¿Puedes enviarme el presupuesto antes del lunes? Decidimos el martes.',
      ],
      [
        'Sophie Martin',
        'sophie@example.com',
        '¿Llamada rápida esta semana?',
        'Me gustaría hablar 30 minutos sobre la colaboración.',
      ],
    ],
  }[locale];
  await createMany(
    'mailMessages',
    mails.map(([sender, senderEmail, subject, snippet], i) => ({
      id: newId('demo'),
      accountId: 'demo',
      provider: 'gmail' as const,
      externalId: `demo-${i}`,
      subject: subject!,
      sender: sender!,
      senderEmail,
      snippet: snippet!,
      receivedAt: addDays(now, i === 0 ? -2 : -1).toISOString(),
      unread: true,
      needsReply: true,
      importance: i === 0 ? ('high' as const) : ('normal' as const),
    })),
  );
  const busy = {
    fr: ['Réunion équipe', 'Appel fournisseur'],
    en: ['Team meeting', 'Supplier call'],
    de: ['Teammeeting', 'Lieferantengespräch'],
    es: ['Reunión de equipo', 'Llamada proveedor'],
  }[locale];
  const slot = (day: number, hhmm: string, minutes: number) => {
    const start = atTime(addDays(now, day), hhmm);
    return { start: start.toISOString(), end: new Date(start.getTime() + minutes * 60_000).toISOString() };
  };
  await createMany('events', [
    { id: newId('demo'), title: busy[0]!, ...slot(0, '14:00', 90), source: src },
    { id: newId('demo'), title: busy[1]!, ...slot(1, '10:30', 60), source: src },
  ]);

  await createMany('health', [
    { id: newId('demo'), date: d(-1), sleepHours: 6.8, energy: 3, stress: 3, steps: 7400, source: 'manual' },
    { id: newId('demo'), date: d(0), sleepHours: 7.4, energy: 4, stress: 2, steps: 2100, source: 'manual' },
  ]);
  await convertModulesToMissions();
}

type DemoCandidate = Parameters<typeof isDemoRecord>[0];

/** Removes every demo record — seeded or converted from a seeded one — leaving real data untouched. */
export async function clearDemo(): Promise<number> {
  let n = 0;
  for (const c of COLLECTIONS) {
    for (const doc of [...(snapshot.value[c] as DemoCandidate[])]) {
      if (!doc.deletedAt && isDemoRecord(doc)) {
        await remove(c, doc.id);
        n += 1;
      }
    }
  }
  return n;
}

export function hasDemoData(): boolean {
  return COLLECTIONS.some((c) =>
    (snapshot.value[c] as DemoCandidate[]).some((d) => !d.deletedAt && isDemoRecord(d)),
  );
}
