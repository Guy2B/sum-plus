/**
 * Which records belong to the demo workspace. Seeded ids start with "demo_",
 * but some demo records are later converted into others whose id only embeds
 * the source id (skills → missions: "mig_skill_demo_…"), and synced-looking
 * demo items carry a demo source or account instead. All of them must go when
 * the user removes the examples.
 */
export const DEMO_PROVIDER = 'demo';

interface MaybeDemo {
  id: string;
  deletedAt?: string | null;
  source?: { provider?: string } | null;
  accountId?: string | null;
  pipeline?: { id: string }[] | null;
}

const demoId = (id: string): boolean => id.startsWith('demo_') || id.includes('_demo_');

export function isDemoRecord(doc: MaybeDemo): boolean {
  if (demoId(doc.id)) return true;
  if (doc.source?.provider === DEMO_PROVIDER || doc.accountId === DEMO_PROVIDER) return true;
  // A converted job-search mission built only from demo applications.
  return Boolean(doc.pipeline?.length && doc.pipeline.every((p) => demoId(p.id)));
}
