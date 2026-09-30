/**
 * User actions on decisions. Each one updates the underlying record and
 * logs feedback so the behaviour profile can learn (after enough evidence).
 */
import { computed, signal } from '@preact/signals';
import { track } from '../services/telemetry';
import type { Decision } from '../domain/decision';
import type { CollectionName, FeedbackAction, DecisionOutcome, DecisionRecord } from '../domain/types';
import { create, createMany, snapshot, update } from './store';
import { withLoggedSession } from '../domain/missions';
import { getKV, setKV } from './db';
import { isoDay } from '../domain/dates';
import { decisions, topDecisions, attention } from './store';
import { arbitrate } from '../domain/decision';
import { groupAttention } from '../domain/planning';
import { capacity } from './store';

/** signalId → ISO time until which it is hidden. */
export const snoozes = signal<Record<string, string>>({});

export async function loadSnoozes(): Promise<void> {
  const stored = (await getKV<Record<string, string>>('snoozes')) ?? {};
  const now = new Date().toISOString();
  snoozes.value = Object.fromEntries(Object.entries(stored).filter(([, until]) => until > now));
}

async function snooze(signalId: string, hours: number) {
  const until = new Date(Date.now() + hours * 3_600_000).toISOString();
  snoozes.value = { ...snoozes.value, [signalId]: until };
  await setKV('snoozes', snoozes.value);
}

const visible = (d: Decision) => {
  const until = snoozes.value[d.signal.id];
  return !until || until <= new Date().toISOString();
};

export const visibleDecisions = computed(() => decisions.value.filter(visible));
export const visibleTop = computed(() => {
  void topDecisions.value;
  return arbitrate(visibleDecisions.value, {
    capacityMinutes: Math.max(capacity.value.capacityMinutes, 30),
    maxItems: 3,
    fillWithLow: true,
  });
});
export const visibleAttention = computed(() => {
  void attention.value;
  return groupAttention(visibleDecisions.value);
});

/* ----------------------------- decision memory ----------------------------- */

const recordId = (d: Decision) => `${isoDay()}:${d.signal.id}`;

/** Updates today's memory of a decision shown on Today (no-op if it was not shown there). */
async function markOutcome(d: Decision, outcome: DecisionOutcome, extra: Partial<DecisionRecord> = {}) {
  const id = recordId(d);
  const rec = snapshot.value.decisionLog.find((r) => r.id === id && !r.deletedAt);
  if (!rec || rec.outcome === 'completed') return;
  if (outcome === 'accepted' && rec.outcome !== 'shown') return;
  await update('decisionLog', id, { outcome, ...extra });
}

export async function markStarted(d: Decision): Promise<void> {
  void track('decision_started');
  await markOutcome(d, 'started', { startedAt: new Date().toISOString() });
}

/** Remembers the cards shown today, once per decision and day. */
export async function rememberShown(rows: Omit<DecisionRecord, 'createdAt' | 'updatedAt' | 'deletedAt'>[]) {
  const known = new Set(snapshot.value.decisionLog.map((r) => r.id));
  const fresh = rows.filter((r) => !known.has(r.id));
  if (fresh.length) await createMany('decisionLog', fresh);
}

async function logFeedback(d: Decision, action: FeedbackAction, minutes?: number) {
  await create('feedback', {
    signalId: d.signal.id,
    action,
    sourceType: d.signal.sourceType,
    intent: d.facts.intent,
    category: d.signal.category,
    relationshipType: d.facts.relationshipType,
    hour: new Date().getHours(),
    minutes: minutes ?? null,
    estimate: minutes ? d.facts.effortMinutes : null,
  });
}

/** Marks done; `minutes` = real time spent (focus timer), used to calibrate estimates. */
export async function completeDecision(d: Decision, minutes?: number): Promise<void> {
  void track('decision_completed');
  const { collection, id } = d.signal.ref;
  const now = new Date().toISOString();
  switch (collection) {
    case 'tasks':
      await update('tasks', id, { status: 'done', completedAt: now, essential: false });
      break;
    case 'mailMessages':
      await update('mailMessages', id, { resolved: true, unread: false });
      break;
    case 'socialItems':
      await update('socialItems', id, { resolved: true });
      break;
    case 'finance':
      await update('finance', id, { status: 'paid' });
      break;
    case 'habits':
      await create('habitLogs', { habitId: id, date: isoDay() });
      break;
    case 'schoolItems':
      await update('schoolItems', id, { done: true });
      break;
    case 'missions': {
      const m = snapshot.value.missions.find((x) => x.id === id);
      if (m && d.signal.session)
        await update(
          'missions',
          id,
          withLoggedSession(m, minutes ? { ...d.signal.session, minutes } : d.signal.session),
        );
      break;
    }
    case 'projects': {
      const p = snapshot.value.projects.find((x) => x.id === id);
      const next = p?.milestones.find((m) => !m.done);
      if (p && next)
        await update('projects', id, {
          milestones: p.milestones.map((m) => (m.id === next.id ? { ...m, done: true } : m)),
        });
      break;
    }
    default:
      await snooze(d.signal.id, 20);
  }
  await logFeedback(d, 'completed', minutes);
  await markOutcome(d, 'completed', { completedAt: new Date().toISOString(), minutes: minutes ?? null });
}

export async function deferDecision(d: Decision): Promise<void> {
  if (d.signal.ref.collection === 'tasks') {
    await update('tasks', d.signal.ref.id, { essential: false, scheduledFor: 'week' });
  }
  await snooze(d.signal.id, 24);
  await logFeedback(d, 'deferred');
  await markOutcome(d, 'deferred');
}

export async function dismissDecision(d: Decision): Promise<void> {
  if (d.signal.ref.collection === 'mailMessages')
    await update('mailMessages', d.signal.ref.id, { resolved: true });
  else if (d.signal.ref.collection === 'socialItems')
    await update('socialItems', d.signal.ref.id, { resolved: true });
  else await snooze(d.signal.id, 24 * 7);
  await logFeedback(d, 'rejected');
  await markOutcome(d, 'rejected');
}

export async function acceptDecision(d: Decision): Promise<void> {
  await logFeedback(d, 'accepted');
  await markOutcome(d, 'accepted');
}

/** "Wrong time": hide it for a few hours and teach Σ not to propose this kind of item now. */
export async function wrongTimeDecision(d: Decision): Promise<void> {
  await snooze(d.signal.id, 4);
  await logFeedback(d, 'wrongTime');
  await markOutcome(d, 'wrongTime');
}

/** Turns a message or social item into a task linked to its source. */
export async function toTask(collection: CollectionName, id: string): Promise<void> {
  if (collection === 'mailMessages') {
    const m = snapshot.value.mailMessages.find((x) => x.id === id);
    if (!m) return;
    await create('tasks', {
      title: m.subject,
      notes: `${m.sender}: ${m.snippet}`.slice(0, 1000),
      category: 'work',
      status: 'todo',
      priority: m.importance === 'high' ? 'high' : 'medium',
      scheduledFor: 'today',
      source: { provider: m.provider, ref: m.externalId, url: m.url },
      estimateMinutes: 15,
    });
    await update('mailMessages', id, { resolved: true });
  } else if (collection === 'socialItems') {
    const s = snapshot.value.socialItems.find((x) => x.id === id);
    if (!s) return;
    await create('tasks', {
      title: `${s.author}: ${s.text.slice(0, 80)}`,
      category: 'work',
      status: 'todo',
      priority: 'medium',
      source: { provider: s.provider, ref: s.externalId, url: s.url },
      estimateMinutes: 10,
    });
    await update('socialItems', id, { resolved: true });
  }
}
