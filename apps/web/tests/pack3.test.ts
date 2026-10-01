import { describe, expect, it } from 'vitest';
import type { Signal } from '../src/domain/signals';
import type { Task } from '../src/domain/types';
import { rankSignals } from '../src/domain/decision';
import { detectRisks } from '../src/domain/risks';
import { isChatModel, recommendModel } from '../src/services/llm';
import { isoWeek, telemetryRecord } from '../src/services/telemetry';
import { NOW, doc, hoursFrom, snapshot } from './fixtures';

const sig = (id: string, over: Partial<Signal> = {}): Signal => ({
  id: `tasks:${id}`,
  sourceType: 'task',
  domain: 'core',
  ref: { collection: 'tasks', id },
  title: id,
  createdAt: hoursFrom(NOW, -2),
  userCreated: true,
  estimateMinutes: 30,
  ...over,
});

describe('attention: what could slip through the cracks', () => {
  it('ranks promises and close deadlines first, ignores work that can wait', () => {
    const promise = doc<Task>({
      title: 'Devis Müller',
      status: 'todo',
      priority: 'high',
      dueDate: '2026-09-30',
      promisedTo: 'Müller',
    } as unknown as Task);
    const decisions = rankSignals(
      [
        sig('invoice', { dueAt: hoursFrom(NOW, 40) }),
        sig('someday'),
        sig('reply', {
          sourceType: 'mail',
          needsReply: true,
          sender: 'Léa',
          receivedAt: hoursFrom(NOW, -80),
        }),
      ],
      { edition: 'solo' },
      NOW,
    );
    const risks = detectRisks(decisions, snapshot({ tasks: [promise] }), NOW);
    expect(risks[0]).toMatchObject({ kind: 'commitment', level: 'high', title: 'Devis Müller' });
    expect(risks.find((r) => r.title === 'invoice')).toMatchObject({ kind: 'deadline', level: 'medium' });
    expect(risks.some((r) => r.title === 'someday')).toBe(false);
  });

  it('never lists a promise that is already kept', () => {
    const done = doc<Task>({ title: 'Kept', status: 'done', promisedTo: 'Anna' } as unknown as Task);
    expect(detectRisks([], snapshot({ tasks: [done] }), NOW)).toHaveLength(0);
  });
});

describe('local model picker', () => {
  it('never offers embedding models and recommends a capable chat model', () => {
    const models = ['bge-m3:latest', 'qwen3-vl:8b', 'qwen3:4b', 'qwen3:8b', 'gemma3:12b'];
    expect(models.filter(isChatModel)).not.toContain('bge-m3:latest');
    expect(recommendModel(models)).toBe('qwen3:8b');
    expect(recommendModel(['nomic-embed-text'])).toBeNull();
    expect(recommendModel(['phi4:14b'])).toBe('phi4:14b');
  });
});

describe('anonymous measurement', () => {
  it('sends only counters: no identifier, no content, age in days', () => {
    const r = telemetryRecord('app_open', '2026-09-23', NOW, {
      edition: 'solo',
      locale: 'fr',
      version: '1.3.0',
    });
    expect(Object.keys(r).sort()).toEqual(['age', 'cohort', 'day', 'e', 'ed', 'lang', 'v']);
    expect(r).toMatchObject({ e: 'app_open', day: '2026-09-30', age: 7, cohort: '2026-W39' });
  });

  it('computes ISO weeks across year boundaries', () => {
    expect(isoWeek(new Date(2026, 0, 1))).toBe('2026-W01');
    expect(isoWeek(new Date(2027, 0, 1))).toBe('2026-W53');
  });
});

describe('model output replayed from a real qwen3:8b run', () => {
  it('reads "14h" as a time, not 840 minutes, and a mentioned person as no promise', async () => {
    const { fromModel } = await import('../src/domain/command');
    const input = 'rappeler Marc demain à 14h';
    const asTask = fromModel(
      { kind: 'task', title: 'rappeler Marc', date: '2026-10-01', minutes: 840, promisedTo: 'Marc' },
      input,
      NOW,
    );
    expect(asTask?.kind).toBe('task');
    if (asTask?.kind === 'task') {
      expect(asTask.captured.estimateMinutes).toBeNull();
      expect(asTask.captured.promisedTo).toBeNull();
    }
    const withTime = fromModel(
      { kind: 'task', title: 'rappeler Marc', date: '2026-10-01', time: '14:00' },
      input,
      NOW,
    );
    expect(withTime?.kind).toBe('event');
    if (withTime?.kind === 'event') expect(withTime.start.getHours()).toBe(14);
  });
});

describe('native sign-in', () => {
  it('reads the account email from an ID token without trusting it for anything else', async () => {
    const { emailFromIdToken } = await import('../src/services/native-auth');
    const payload = btoa(JSON.stringify({ email: 'lea@example.com' })).replace(/=+$/, '');
    expect(emailFromIdToken(`h.${payload}.s`)).toBe('lea@example.com');
    expect(emailFromIdToken('garbage')).toBeNull();
    expect(emailFromIdToken(undefined)).toBeNull();
  });
});
