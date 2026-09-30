import { beforeEach, describe, expect, it } from 'vitest';
import { parseCapture } from '../src/domain/capture';
import { NOW } from './fixtures';
import type { Doc } from '../src/domain/types';

describe('quick capture parser', () => {
  it('extracts due date, duration and priority in French', () => {
    const c = parseCapture('Appeler Marc demain 30min !', NOW);
    expect(c).toMatchObject({
      title: 'Appeler Marc',
      dueDate: '2026-10-01',
      estimateMinutes: 30,
      priority: 'high',
    });
  });

  it('understands English, German and Spanish keywords', () => {
    expect(parseCapture('Send invoice today', NOW)).toMatchObject({
      title: 'Send invoice',
      dueDate: '2026-09-30',
      scheduledFor: 'today',
    });
    expect(parseCapture('Rechnung schicken morgen', NOW).dueDate).toBe('2026-10-01');
    expect(parseCapture('Llamar a Ana mañana 1h', NOW)).toMatchObject({
      title: 'Llamar a Ana',
      dueDate: '2026-10-01',
      estimateMinutes: 60,
    });
  });

  it('handles weekdays, explicit dates and category tags', () => {
    expect(parseCapture('Réunion vendredi', NOW).dueDate).toBe('2026-10-02');
    expect(parseCapture('Dossier 15/10 #admin', NOW)).toMatchObject({
      title: 'Dossier',
      dueDate: '2026-10-15',
      category: 'admin',
    });
    expect(parseCapture('Rapport 2026-11-03', NOW).dueDate).toBe('2026-11-03');
  });

  it('keeps unknown words and never returns an empty title', () => {
    expect(parseCapture('demain', NOW).title).toBe('demain');
    expect(parseCapture('Préparer #inconnu point 3', NOW).title).toBe('Préparer #inconnu point 3');
  });
});

describe('local store (IndexedDB)', () => {
  beforeEach(async () => {
    const { eraseDevice } = await import('../src/data/store');
    await eraseDevice();
  });

  it('creates, updates, soft-deletes and restores with an outbox entry', async () => {
    const store = await import('../src/data/store');
    const db = await import('../src/data/db');
    const task = await store.create('tasks', {
      title: 'A',
      category: 'work',
      status: 'todo',
      priority: 'medium',
    });
    await store.update('tasks', task.id, { title: 'B' });
    expect(store.snapshot.value.tasks.find((t) => t.id === task.id)?.title).toBe('B');
    await store.remove('tasks', task.id);
    const stored = await db.readDoc<Doc>('tasks', task.id);
    expect(stored?.deletedAt).toBeTruthy();
    await store.restore('tasks', task.id);
    expect((await db.readDoc<Doc>('tasks', task.id))?.deletedAt).toBeNull();
    const outbox = await db.outbox();
    expect(outbox.some((o) => o._c === 'tasks' && o.id === task.id)).toBe(true);
  });

  it('never queues local-only collections for sync', async () => {
    const store = await import('../src/data/store');
    const db = await import('../src/data/db');
    await store.create('coachMessages', { role: 'user', text: 'hello' });
    expect((await db.outbox()).some((o) => o._c === 'coachMessages')).toBe(false);
  });

  it('applies remote records without queuing them back', async () => {
    const store = await import('../src/data/store');
    const db = await import('../src/data/db');
    await store.applyRemote('goals', [
      { id: 'g1', title: 'Remote', horizon: 'month', status: 'active', createdAt: 'x', updatedAt: 'y' },
    ]);
    expect(store.snapshot.value.goals[0]?.title).toBe('Remote');
    expect((await db.outbox()).some((o) => o.id === 'g1')).toBe(false);
  });

  it('migrates legacy localStorage data exactly once', async () => {
    const db = await import('../src/data/db');
    await db.wipeLocal();
    localStorage.setItem(
      'sum-algbr-state-v1',
      JSON.stringify({ settings: { name: 'Old' }, tasks: [{ id: 'l1', title: 'Legacy' }] }),
    );
    const store = await import('../src/data/store');
    const first = await store.initStore();
    expect(first.migratedLegacy?.tasks).toBe(1);
    expect(store.snapshot.value.tasks.some((t) => t.title === 'Legacy')).toBe(true);
    expect(store.settings.value.name).toBe('Old');
    const second = await store.initStore();
    expect(second.migratedLegacy).toBeNull();
  });
});
