import { describe, expect, it } from 'vitest';
import {
  arbitrate,
  buildFacts,
  decide,
  inferIntent,
  learnProfile,
  rankSignals,
} from '../src/domain/decision';
import type { DecisionContext } from '../src/domain/decision';
import type { Signal } from '../src/domain/signals';
import { buildSignals } from '../src/domain/signals';
import { DEFAULT_CONTEXT } from '../src/domain/defaults';
import { NOW, doc, hoursFrom, snapshot } from './fixtures';

const ctx: DecisionContext = { edition: 'solo' };
const profile = learnProfile([]);

const task = (over: Partial<Signal> = {}): Signal => ({
  id: `tasks:${Math.random()}`,
  sourceType: 'task',
  domain: 'core',
  ref: { collection: 'tasks', id: 'x' },
  title: 'Write report',
  createdAt: hoursFrom(NOW, -2),
  userCreated: true,
  ...over,
});

const mail = (over: Partial<Signal> = {}): Signal => ({
  id: `mailMessages:${Math.random()}`,
  sourceType: 'mail',
  domain: 'mail',
  ref: { collection: 'mailMessages', id: 'm' },
  title: 'Question',
  sender: 'Alice <alice@example.com>',
  senderEmail: 'alice@example.com',
  receivedAt: hoursFrom(NOW, -1),
  ...over,
});

describe('knowledge', () => {
  it('detects promotions and suppresses them', () => {
    const s = mail({
      title: '50% discount — unsubscribe here',
      sender: 'news <noreply@shop.com>',
      senderEmail: 'noreply@shop.com',
    });
    expect(inferIntent(s)).toBe('promotion');
    const d = decide(s, ctx, profile, NOW);
    expect(d.action).toBe('ignore');
    expect(d.band).toBe('low');
    expect(d.firedRules).toContain('promotion');
  });

  it('recognises invoices as transactional in several languages', () => {
    expect(inferIntent(task({ title: 'Envoyer la facture Dupont' }))).toBe('transactional');
    expect(inferIntent(task({ title: 'Rechnung an Kunde senden' }))).toBe('transactional');
  });

  it('uses declared contacts for relationship weight', () => {
    const withClient: DecisionContext = {
      ...ctx,
      contacts: [{ name: 'Alice', email: 'alice@example.com', relationshipType: 'strategic_client' }],
    };
    const f = buildFacts(mail({ needsReply: true }), withClient, NOW);
    expect(f.relationshipType).toBe('strategic_client');
    expect(f.relationshipValue).toBe(1);
  });
});

describe('scoring', () => {
  it('ranks an overdue task above an undated one', () => {
    const overdue = task({ title: 'Pay supplier', dueAt: hoursFrom(NOW, -5) });
    const later = task({ title: 'Tidy desk' });
    const [first] = rankSignals([later, overdue], ctx, NOW);
    expect(first?.signal.title).toBe('Pay supplier');
    expect(first?.firedRules).toContain('overdue');
    expect(first?.reasons.some((r) => r.key === 'reason.rule.overdue')).toBe(true);
  });

  it('keeps scores within 0..100 and exposes the formula', () => {
    const d = decide(
      task({ urgent: true, important: true, essential: true, dueAt: hoursFrom(NOW, -48) }),
      ctx,
      profile,
      NOW,
    );
    expect(d.score).toBeGreaterThanOrEqual(0);
    expect(d.score).toBeLessThanOrEqual(100);
    expect(Object.keys(d.formula)).toEqual(['base', 'rules', 'behavior', 'edition', 'confidencePenalty']);
  });

  it('flags an unverified sender as an uncertainty instead of guessing', () => {
    const d = decide(mail({ needsReply: true }), ctx, profile, NOW);
    expect(d.uncertainties.map((u) => u.key)).toContain('uncertainty.relationship');
  });

  it('edition changes ranking of the same signals', () => {
    const exam = task({ title: 'Réviser examen de statistiques', dueAt: hoursFrom(NOW, 30) });
    const quote = task({ title: 'Envoyer devis client', dueAt: hoursFrom(NOW, 30) });
    const student = rankSignals([exam, quote], { edition: 'student' }, NOW);
    const solo = rankSignals([exam, quote], { edition: 'solo' }, NOW);
    expect(student[0]?.signal.title).toContain('examen');
    expect(solo[0]?.signal.title).toContain('devis');
  });
});

describe('behaviour learning', () => {
  it('stays neutral below the observation threshold', () => {
    const p = learnProfile([{ action: 'accepted', sourceType: 'mail', hour: 9 }]);
    expect(p.ready).toBe(false);
  });

  it('learns acceptance patterns after enough observations', () => {
    const fb = Array.from({ length: 8 }, () => ({
      action: 'rejected' as const,
      sourceType: 'social',
      hour: 10,
    }));
    const p = learnProfile(fb);
    expect(p.ready).toBe(true);
    const s: Signal = { ...mail({ needsReply: true }), sourceType: 'social', domain: 'social' };
    const withP = decide(s, ctx, p, NOW);
    const without = decide(s, ctx, learnProfile([]), NOW);
    expect(withP.score).toBeLessThan(without.score);
  });
});

describe('arbitration', () => {
  it('selects at most three and respects source limits', () => {
    const mails = Array.from({ length: 4 }, (_, i) =>
      mail({ title: `Client request ${i} proposal`, needsReply: true, receivedAt: hoursFrom(NOW, -30 - i) }),
    );
    const tasks = Array.from({ length: 4 }, (_, i) =>
      task({ title: `Deliver item ${i}`, dueAt: hoursFrom(NOW, 5 + i) }),
    );
    const ranked = rankSignals([...mails, ...tasks], ctx, NOW);
    const a = arbitrate(ranked, { capacityMinutes: 600 });
    expect(a.selected.length).toBeLessThanOrEqual(3);
    const mailCount = a.selected.filter(
      (d) => d.signal.sourceType === 'mail' && d.band !== 'critical',
    ).length;
    expect(mailCount).toBeLessThanOrEqual(1);
  });

  it('merges a task and an email about the same topic and boosts it', () => {
    const t = task({ title: 'Relancer facture Dupont septembre', dueAt: hoursFrom(NOW, 4) });
    const m = mail({ title: 'Relancer facture Dupont septembre', needsReply: true });
    const a = arbitrate(rankSignals([t, m], ctx, NOW));
    expect(a.selected).toHaveLength(1);
    expect(a.selected[0]?.corroboratedBy).toHaveLength(1);
    expect(a.rejected.some((r) => r.reason === 'merged')).toBe(true);
  });

  it('respects the time budget after the first item', () => {
    const big = [
      task({ title: 'Quarterly accounting close', estimateMinutes: 120, dueAt: hoursFrom(NOW, 3) }),
      task({ title: 'Website redesign draft', estimateMinutes: 120, dueAt: hoursFrom(NOW, 4) }),
    ];
    const a = arbitrate(rankSignals(big, ctx, NOW), { capacityMinutes: 150 });
    expect(a.selected).toHaveLength(1);
    expect(a.rejected.some((r) => r.reason === 'capacity')).toBe(true);
  });
});

describe('signals from snapshot', () => {
  it('builds signals only for open, enabled data', () => {
    const snap = snapshot({
      tasks: [
        doc({ title: 'Open', category: 'work', status: 'todo', priority: 'medium' }),
        doc({ title: 'Done', category: 'work', status: 'done', priority: 'medium' }),
      ] as never,
      mailMessages: [
        doc({
          accountId: 'a',
          provider: 'gmail',
          externalId: '1',
          subject: 'Hi',
          sender: 'Bob',
          snippet: '',
          receivedAt: NOW.toISOString(),
          unread: true,
          needsReply: true,
          importance: 'normal',
        }),
      ] as never,
    });
    const all = buildSignals(snap, DEFAULT_CONTEXT, NOW);
    expect(all.map((s) => s.title)).toEqual(['Open', 'Hi']);
    const noMail = buildSignals(
      snap,
      { ...DEFAULT_CONTEXT, includedDomains: { ...DEFAULT_CONTEXT.includedDomains, mail: false } },
      NOW,
    );
    expect(noMail.map((s) => s.title)).toEqual(['Open']);
  });
});
