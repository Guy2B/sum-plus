import type { CollectionName, ContextProfile, Domain, RelationshipType, Snapshot } from './types';
import { addDays, hoursUntil, isoDay, toDate, WEEKDAY_KEYS } from './dates';

export type SourceType =
  | 'task'
  | 'event'
  | 'mail'
  | 'social'
  | 'finance'
  | 'health'
  | 'learning'
  | 'habit'
  | 'project'
  | 'household'
  | 'career';

/**
 * A normalised, provenance-carrying observation the decision engine can rank.
 * `title` holds user/provider data verbatim; generated wording uses `titleKey`
 * so it is localised at render time and never invented as data.
 */
export interface Signal {
  id: string;
  sourceType: SourceType;
  domain: Domain | 'core';
  ref: { collection: CollectionName; id: string };
  title?: string;
  titleKey?: string;
  titleParams?: Record<string, string | number>;
  body?: string;
  sender?: string;
  senderEmail?: string;
  category?: string;
  provider?: string;
  dueAt?: string | null;
  createdAt?: string;
  receivedAt?: string;
  needsReply?: boolean;
  urgent?: boolean;
  important?: boolean;
  essential?: boolean;
  estimateMinutes?: number;
  amount?: number;
  riskLevel?: 'high' | 'medium' | 'low';
  relationshipType?: RelationshipType;
  userCreated?: boolean;
  url?: string;
}

const alive = <T extends { deletedAt?: string | null }>(rows: T[]): T[] => rows.filter((r) => !r.deletedAt);

export function domainEnabled(context: ContextProfile | undefined, domain: Domain | 'core'): boolean {
  if (domain === 'core') return true;
  return context?.includedDomains?.[domain] !== false;
}

export function buildSignals(
  snap: Snapshot,
  context: ContextProfile | undefined,
  now: Date = new Date(),
): Signal[] {
  const out: Signal[] = [];
  const today = isoDay(now);
  const in7 = addDays(now, 7);

  for (const t of alive(snap.tasks)) {
    if (t.status === 'done') continue;
    out.push({
      id: `tasks:${t.id}`,
      sourceType: 'task',
      domain: 'core',
      ref: { collection: 'tasks', id: t.id },
      title: t.title,
      body: t.notes,
      category: t.category,
      dueAt: t.dueDate ?? null,
      createdAt: t.createdAt,
      urgent: Boolean(t.urgent) || t.priority === 'high',
      important: Boolean(t.important) || t.priority === 'high',
      essential: t.essential,
      estimateMinutes: t.estimateMinutes,
      userCreated: !t.source,
      provider: t.source?.provider,
      url: t.source?.url,
    });
  }

  if (domainEnabled(context, 'calendar')) {
    for (const e of alive(snap.events)) {
      const start = toDate(e.start);
      if (!start || start > in7) continue;
      if (start.getTime() < now.getTime() - 3_600_000) continue;
      out.push({
        id: `events:${e.id}`,
        sourceType: 'event',
        domain: 'calendar',
        ref: { collection: 'events', id: e.id },
        title: e.title,
        body: e.description,
        dueAt: e.start,
        createdAt: e.createdAt,
        provider: e.source?.provider,
        url: e.source?.url,
      });
    }
  }

  if (domainEnabled(context, 'mail')) {
    const contacts = alive(snap.contacts);
    for (const m of alive(snap.mailMessages)) {
      if (m.resolved) continue;
      if (!m.needsReply && !(m.unread && m.importance === 'high')) continue;
      const received = toDate(m.receivedAt);
      if (received && received < addDays(now, -21)) continue;
      const contact = contacts.find(
        (c) => c.email && m.senderEmail && c.email.toLowerCase() === m.senderEmail.toLowerCase(),
      );
      out.push({
        id: `mailMessages:${m.id}`,
        sourceType: 'mail',
        domain: 'mail',
        ref: { collection: 'mailMessages', id: m.id },
        title: m.subject,
        body: m.snippet,
        sender: m.sender,
        senderEmail: m.senderEmail,
        receivedAt: m.receivedAt,
        needsReply: m.needsReply,
        important: m.importance === 'high',
        relationshipType: contact?.relationshipType,
        provider: m.provider,
        url: m.url,
      });
    }
  }

  if (domainEnabled(context, 'social')) {
    for (const s of alive(snap.socialItems)) {
      if (s.resolved || !s.needsReply) continue;
      out.push({
        id: `socialItems:${s.id}`,
        sourceType: 'social',
        domain: 'social',
        ref: { collection: 'socialItems', id: s.id },
        title: s.text.slice(0, 140),
        sender: s.author,
        receivedAt: s.publishedAt,
        needsReply: true,
        provider: s.provider,
        url: s.url,
      });
    }
  }

  if (domainEnabled(context, 'finance')) {
    for (const f of alive(snap.finance)) {
      if (f.status === 'paid') continue;
      out.push({
        id: `finance:${f.id}`,
        sourceType: 'finance',
        domain: 'finance',
        ref: { collection: 'finance', id: f.id },
        titleKey: f.kind === 'income' ? 'signal.finance.collect' : 'signal.finance.pay',
        titleParams: { label: f.label, counterparty: f.counterparty ?? '' },
        category: f.category,
        dueAt: f.dueDate ?? f.date,
        createdAt: f.createdAt,
        amount: f.amount / 100,
        riskLevel: f.status === 'overdue' ? 'high' : 'medium',
        userCreated: true,
        estimateMinutes: 10,
      });
    }
  }

  if (domainEnabled(context, 'health')) {
    const latest = alive(snap.health)
      .filter((h) => h.date >= isoDay(addDays(now, -1)))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (latest) {
      const lowEnergy = latest.energy != null && latest.energy <= 2;
      const shortSleep = latest.sleepHours != null && latest.sleepHours < 6;
      if (lowEnergy || shortSleep) {
        out.push({
          id: `health:${latest.id}`,
          sourceType: 'health',
          domain: 'health',
          ref: { collection: 'health', id: latest.id },
          titleKey: 'signal.health.recover',
          titleParams: { sleep: latest.sleepHours ?? '—', energy: latest.energy ?? '—' },
          createdAt: latest.createdAt,
          dueAt: `${today}T20:00:00`,
          userCreated: true,
          estimateMinutes: 20,
        });
      }
    }
  }

  if (domainEnabled(context, 'learning')) {
    for (const s of alive(snap.skills)) {
      if (!s.nextReviewAt || s.nextReviewAt > today) continue;
      out.push({
        id: `skills:${s.id}`,
        sourceType: 'learning',
        domain: 'learning',
        ref: { collection: 'skills', id: s.id },
        titleKey: 'signal.learning.review',
        titleParams: { name: s.name },
        dueAt: s.nextReviewAt,
        createdAt: s.createdAt,
        userCreated: true,
        estimateMinutes: 25,
      });
    }
  }

  const weekday = WEEKDAY_KEYS[now.getDay()];
  const loggedToday = new Set(
    alive(snap.habitLogs)
      .filter((l) => l.date === today)
      .map((l) => l.habitId),
  );
  for (const h of alive(snap.habits)) {
    if (h.archived || loggedToday.has(h.id)) continue;
    if (h.cadence === 'weekdays' && (weekday === 'sat' || weekday === 'sun')) continue;
    if (h.cadence === 'weekly') continue;
    out.push({
      id: `habits:${h.id}`,
      sourceType: 'habit',
      domain: 'core',
      ref: { collection: 'habits', id: h.id },
      titleKey: 'signal.habit.do',
      titleParams: { name: h.name },
      category: h.domain,
      createdAt: h.createdAt,
      userCreated: true,
      estimateMinutes: 15,
    });
  }

  for (const p of alive(snap.projects)) {
    if (p.status !== 'active') continue;
    const next = p.milestones.find((m) => !m.done);
    if (next?.dueDate && (hoursUntil(next.dueDate, now) ?? Infinity) <= 24 * 7) {
      out.push({
        id: `projects:${p.id}:${next.id}`,
        sourceType: 'project',
        domain: 'core',
        ref: { collection: 'projects', id: p.id },
        titleKey: 'signal.project.milestone',
        titleParams: { project: p.name, milestone: next.title },
        body: p.description,
        category: 'projects',
        dueAt: next.dueDate,
        createdAt: p.createdAt,
        userCreated: true,
        amount: p.value ? p.value / 100 : undefined,
        estimateMinutes: 45,
      });
    }
  }

  if (domainEnabled(context, 'household')) {
    const members = new Map(alive(snap.household).map((m) => [m.id, m.name]));
    for (const s of alive(snap.schoolItems)) {
      if (s.done || !s.dueDate) continue;
      if ((hoursUntil(s.dueDate, now) ?? Infinity) > 24 * 7) continue;
      out.push({
        id: `schoolItems:${s.id}`,
        sourceType: 'household',
        domain: 'household',
        ref: { collection: 'schoolItems', id: s.id },
        titleKey: 'signal.household.item',
        titleParams: { member: members.get(s.memberId) ?? '', title: s.title },
        dueAt: s.dueDate,
        createdAt: s.createdAt,
        userCreated: true,
        important: s.kind === 'form' || s.kind === 'exam',
        estimateMinutes: 15,
      });
    }
  }

  if (domainEnabled(context, 'career')) {
    for (const a of alive(snap.applications)) {
      if (a.stage === 'rejected' || a.stage === 'accepted') continue;
      if (!a.nextActionAt || (hoursUntil(a.nextActionAt, now) ?? Infinity) > 24 * 3) continue;
      out.push({
        id: `applications:${a.id}`,
        sourceType: 'career',
        domain: 'career',
        ref: { collection: 'applications', id: a.id },
        titleKey: 'signal.career.next',
        titleParams: { company: a.company, role: a.role, action: a.nextAction ?? '' },
        dueAt: a.nextActionAt,
        createdAt: a.createdAt,
        userCreated: true,
        important: a.stage === 'interview' || a.stage === 'offer',
        estimateMinutes: 30,
      });
    }
  }

  return out;
}

/** Plain text used for keyword inference; includes localisation params but never keys. */
export function signalText(s: Signal): string {
  return [s.title, s.body, s.sender, s.category, ...Object.values(s.titleParams ?? {})]
    .filter(Boolean)
    .join(' ');
}
