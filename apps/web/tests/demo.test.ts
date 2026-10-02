import { describe, expect, it } from 'vitest';
import { isDemoRecord } from '../src/domain/demo';

describe('demo records', () => {
  it('catches seeded, converted and demo-sourced records', () => {
    expect(isDemoRecord({ id: 'demo_abc' })).toBe(true);
    // Skills seeded by the demo are converted into missions whose id embeds the demo id.
    expect(isDemoRecord({ id: 'mig_skill_demo_abc' })).toBe(true);
    expect(isDemoRecord({ id: 'mig_school_demo_abc' })).toBe(true);
    expect(isDemoRecord({ id: 'x1', source: { provider: 'demo' } })).toBe(true);
    expect(isDemoRecord({ id: 'x2', accountId: 'demo' })).toBe(true);
    expect(isDemoRecord({ id: 'mig_jobsearch', pipeline: [{ id: 'demo_a' }, { id: 'demo_b' }] })).toBe(true);
  });

  it('never touches real data', () => {
    expect(isDemoRecord({ id: 'a1b2c3' })).toBe(false);
    expect(isDemoRecord({ id: 'mig_skill_a1b2' })).toBe(false);
    expect(isDemoRecord({ id: 'x3', source: { provider: 'gmail' } })).toBe(false);
    expect(isDemoRecord({ id: 'mig_jobsearch', pipeline: [{ id: 'demo_a' }, { id: 'real1' }] })).toBe(false);
    expect(isDemoRecord({ id: 'mig_jobsearch', pipeline: [] })).toBe(false);
    expect(isDemoRecord({ id: 'demonstration' })).toBe(false);
  });
});
