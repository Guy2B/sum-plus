import { describe, expect, it } from 'vitest';
import { fromModel } from '../src/domain/command';
import { detectCommitment, parseCapture } from '../src/domain/capture';
import { decisionQuality, estimateAccuracy } from '../src/domain/quality';
import { detectStagnation } from '../src/domain/stagnation';
import { detectIntent } from '../src/domain/coach';
import type { DecisionFeedback, DecisionRecord, Task } from '../src/domain/types';
import { NOW, doc, snapshot } from './fixtures';

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('model output is validated, never trusted', () => {
  const input = "j'ai promis à Müller d'envoyer le devis vendredi";

  it('accepts a structure grounded in the sentence', () => {
    const r = fromModel(
      { kind: 'task', title: 'envoyer le devis', date: '2026-10-02', promisedTo: 'Müller' },
      input,
      NOW,
    );
    expect(r?.kind).toBe('task');
    if (r?.kind === 'task') {
      expect(r.captured.promisedTo).toBe('Müller');
      expect(r.captured.dueDate).toBe('2026-10-02');
    }
  });

  it('rejects invented titles, people, dates and times', () => {
    expect(fromModel({ kind: 'task', title: 'réserver un vol pour Tokyo' }, input, NOW)).toBeNull();
    expect(
      fromModel({ kind: 'task', title: 'envoyer le devis', promisedTo: 'Dupont' }, input, NOW),
    ).toBeNull();
    expect(fromModel({ kind: 'task', title: 'envoyer le devis', date: '2031-01-01' }, input, NOW)).toBeNull();
    expect(fromModel({ kind: 'event', title: 'envoyer le devis', time: '25h' }, input, NOW)).toBeNull();
    expect(fromModel({ kind: 'delete-everything' }, input, NOW)).toBeNull();
    expect(fromModel('not json', input, NOW)).toBeNull();
  });
});

describe('commitments', () => {
  it('finds who something was promised to, in four languages', () => {
    expect(detectCommitment("J'ai promis à Müller le devis")).toBe('Müller');
    expect(detectCommitment('I promised Anna the report')).toBe('Anna');
    expect(detectCommitment('Bericht an Jonas versprochen')).toBe('Jonas');
    expect(detectCommitment('Le prometí a Lucía llamar')).toBe('Lucía');
    expect(detectCommitment('envoyer le devis vendredi')).toBeNull();
    expect(parseCapture('promis à Müller: devis demain', NOW).promisedTo).toBe('Müller');
  });
});

describe('decision quality', () => {
  const rec = (i: number, outcome: DecisionRecord['outcome'], role: DecisionRecord['role'] = 'now') =>
    doc<DecisionRecord>({
      signalId: `tasks:${i}`,
      date: '2026-09-29',
      title: `t${i}`,
      role,
      reasons: [],
      setAside: [],
      context: { freeMinutes: 60, capacityMinutes: 240, energy: null, minutesLeft: null },
      category: 'work',
      sourceType: 'tasks',
      estimate: 30,
      outcome,
      completedAt: outcome === 'completed' ? '2026-09-29T15:00:00' : null,
    } as unknown as DecisionRecord);

  it('measures the funnel from what really happened', () => {
    const q = decisionQuality(
      [rec(1, 'completed'), rec(2, 'deferred'), rec(3, 'shown', 'watch'), rec(4, 'rejected')],
      [],
      NOW,
    );
    expect(q.proposed).toBe(4);
    expect(q.completed).toBe(1);
    expect(q.deferred).toBe(1);
    expect(q.rejected).toBe(1);
    expect(q.acceptance).toBe(25);
    expect(q.estimateError).toBeNull();
  });

  it('shows whether calibration improves estimates', () => {
    // Work systematically takes twice the estimate: calibration should learn it.
    const fb = Array.from({ length: 6 }, (_, i) =>
      doc<DecisionFeedback>(
        {
          signalId: `tasks:${i}`,
          action: 'completed',
          category: 'work',
          sourceType: 'tasks',
          minutes: 60,
          estimate: 30,
        } as unknown as DecisionFeedback,
        daysAgo(6 - i),
      ),
    );
    const acc = estimateAccuracy(fb);
    expect(acc.samples).toBe(6);
    expect(acc.raw).toBe(50);
    expect(acc.calibrated!).toBeLessThan(acc.raw!);
  });
});

describe('stagnation', () => {
  it('flags work deferred again and again, not just overdue', () => {
    const task = doc<Task>({ title: 'Déclaration', status: 'todo', priority: 'medium' } as unknown as Task);
    const fb = [1, 2, 3].map((i) =>
      doc<DecisionFeedback>(
        { signalId: `tasks:${task.id}`, action: 'deferred' } as unknown as DecisionFeedback,
        daysAgo(i),
      ),
    );
    const out = detectStagnation(snapshot({ tasks: [task], feedback: fb }), NOW);
    expect(out[0]).toMatchObject({ kind: 'task', deferrals: 3 });
    const fresh = doc<Task>({ title: 'Nouveau', status: 'todo', priority: 'medium' } as unknown as Task);
    expect(detectStagnation(snapshot({ tasks: [fresh] }), NOW)).toHaveLength(0);
  });
});

describe('decision memory', () => {
  it('routes "why did we decide" questions to the memory', () => {
    expect(detectIntent('Pourquoi avait-on décidé de faire le devis ?')).toBe('memory');
    expect(detectIntent('Why did you pick the report yesterday?')).toBe('memory');
  });
});
