import type { CollectionName, Doc, Snapshot } from '../src/domain/types';
import { COLLECTIONS } from '../src/domain/types';

export const NOW = new Date('2026-09-30T08:00:00');

let seq = 0;
export function doc<T extends object>(fields: T, at: Date = NOW): T & Doc {
  seq += 1;
  return {
    id: `id${seq}`,
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
    deletedAt: null,
    ...fields,
  };
}

export function emptySnapshot(): Snapshot {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, []])) as unknown as Snapshot;
}

export function snapshot(parts: Partial<Snapshot>): Snapshot {
  const s = emptySnapshot();
  for (const [k, v] of Object.entries(parts))
    (s as Record<CollectionName, unknown[]>)[k as CollectionName] = v as unknown[];
  return s;
}

export function hoursFrom(base: Date, h: number): string {
  return new Date(base.getTime() + h * 3_600_000).toISOString();
}
