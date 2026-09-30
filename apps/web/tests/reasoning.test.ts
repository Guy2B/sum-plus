import { describe, expect, it } from 'vitest';
import type { Signal } from '../src/domain/signals';
import { buildSignals } from '../src/domain/signals';
import { decide, learnProfile, learnTimeRules, rankSignals } from '../src/domain/decision';
import { whyNot } from '../src/domain/whynot';
import { detectIntent } from '../src/domain/coach';
import { NOW, doc, hoursFrom, snapshot } from './fixtures';

const task = (id: string, over: Partial<Signal> = {}): Signal => ({
  id: `tasks:${id}`,
  sourceType: 'task',
  domain: 'core',
  ref: { collection: 'tasks', id },
  title: id,
  category: 'admin',
  createdAt: hoursFrom(NOW, -2),
  userCreated: true,
  ...over,
});

describe('learning from feedback', () => {
  const fb = (action: 'wrongTime' | 'deferred' | 'completed', hour: number) => ({
    action,
    sourceType: 'task',
    category: 'admin',
    hour,
  });

  it('learns "not in the afternoon" for admin work and applies it only then', () => {
    const feedback = [fb('wrongTime', 16), fb('deferred', 15), fb('wrongTime', 17 - 1), fb('completed', 9)];
    const rules = learnTimeRules(feedback);
    expect(rules).toContainEqual(
      expect.objectContaining({ dimension: 'category', value: 'admin', period: 'afternoon' }),
    );
    const profile = learnProfile(feedback);
    const s = task('invoice', { estimateMinutes: 20 });
    const afternoon = new Date(NOW);
    afternoon.setHours(15);
    const morning = new Date(NOW);
    morning.setHours(9);
    const pm = decide(s, { edition: 'solo' }, profile, afternoon);
    const am = decide(s, { edition: 'solo' }, profile, morning);
    expect(pm.score).toBeLessThan(am.score);
    expect(pm.reasons.map((r) => r.key)).toContain('reason.behavior.avoidPeriod');
  });

  it('never hides something due within hours, even at a "wrong" time', () => {
    const profile = learnProfile([fb('wrongTime', 15), fb('wrongTime', 15), fb('wrongTime', 15)]);
    const at = new Date(NOW);
    at.setHours(15);
    const urgent = decide(task('tax', { dueAt: hoursFrom(at, 2) }), { edition: 'solo' }, profile, at);
    expect(urgent.reasons.map((r) => r.key)).not.toContain('reason.behavior.avoidPeriod');
  });
});

describe('goal → project → action chain', () => {
  it('links a task to its project and goal, counts what it unblocks and raises its priority', () => {
    const goal = doc({ title: 'Lancer mon activité', horizon: 'quarter', status: 'active' });
    const project = doc({ name: 'Site vitrine', status: 'active', milestones: [], goalId: goal.id });
    const t1 = doc({
      title: 'Choisir le nom de domaine',
      status: 'todo',
      projectId: project.id,
      dueDate: '2026-10-02',
      category: 'work',
      priority: 'medium',
    });
    const t2 = doc({
      title: 'Rédiger les textes',
      status: 'todo',
      projectId: project.id,
      dueDate: '2026-10-05',
      category: 'work',
      priority: 'medium',
    });
    const loose = doc({
      title: 'Ranger le bureau',
      status: 'todo',
      dueDate: '2026-10-02',
      category: 'work',
      priority: 'medium',
    });
    const signals = buildSignals(
      snapshot({ goals: [goal], projects: [project], tasks: [t1, t2, loose] } as never),
      undefined,
      NOW,
    );
    const s1 = signals.find((s) => s.title === t1.title)!;
    expect(s1.chain).toEqual(['Lancer mon activité', 'Site vitrine']);
    expect(s1.unblocks).toBe(1);
    const ranked = rankSignals(signals, { edition: 'solo' }, NOW);
    const d1 = ranked.find((d) => d.signal.title === t1.title)!;
    const dl = ranked.find((d) => d.signal.title === loose.title)!;
    expect(d1.score).toBeGreaterThan(dl.score);
    expect(d1.reasons.map((r) => r.key)).toEqual(expect.arrayContaining(['reason.chain', 'reason.unblocks']));
    expect(whyNot(d1, dl).key).toBe('whynot.unblocks');
  });
});

describe('why not something else', () => {
  it('explains that the alternative can wait when its deadline is later', () => {
    const [a, b] = rankSignals(
      [task('today', { dueAt: hoursFrom(NOW, 4) }), task('thursday', { dueAt: hoursFrom(NOW, 72) })],
      { edition: 'solo' },
      NOW,
    );
    const w = whyNot(a!, b!);
    expect(w.key).toBe('whynot.canWait');
    expect(w.until).toBe(b!.signal.dueAt);
  });
});

describe('coach as an interface to the engine', () => {
  it('routes engine questions in four languages', () => {
    expect(detectIntent('Qu’est-ce que j’oublie ?')).toBe('forgetting');
    expect(detectIntent('What can wait?')).toBe('canWait');
    expect(detectIntent('Warum ist meine Woche überlastet?')).toBe('overload');
    expect(detectIntent('Libère-moi vendredi après-midi')).toBe('freeUp');
    expect(detectIntent('¿Qué me está bloqueando?')).toBe('blocked');
    expect(detectIntent('Quel projet est bloqué ?')).toBe('project');
  });
});
