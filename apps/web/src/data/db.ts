/**
 * Local-first persistence on IndexedDB.
 *
 * - `docs`   every domain record, keyed by [collection, id]
 * - `outbox` records changed locally and not yet acknowledged by the cloud
 * - `kv`     settings, sync cursors, cached entitlement, migration flags
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CollectionName, Doc } from '../domain/types';

export type StoredDoc = Doc & { _c: CollectionName; [k: string]: unknown };

interface SigmaDB extends DBSchema {
  docs: { key: [CollectionName, string]; value: StoredDoc; indexes: { byCollection: CollectionName } };
  outbox: { key: [CollectionName, string]; value: { _c: CollectionName; id: string; queuedAt: string } };
  kv: { key: string; value: unknown };
}

const DB_NAME = 'sigma-life-os';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<SigmaDB>> | null = null;

export function db(): Promise<IDBPDatabase<SigmaDB>> {
  dbPromise ??= openDB<SigmaDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      const docs = database.createObjectStore('docs', { keyPath: ['_c', 'id'] });
      docs.createIndex('byCollection', '_c');
      database.createObjectStore('outbox', { keyPath: ['_c', 'id'] });
      database.createObjectStore('kv');
    },
    blocked() {
      console.warn('[db] upgrade blocked by another tab');
    },
  });
  return dbPromise;
}

export async function readCollection<T extends Doc>(c: CollectionName): Promise<T[]> {
  const rows = await (await db()).getAllFromIndex('docs', 'byCollection', c);
  return rows.map(strip) as unknown as T[];
}

export async function writeDocs(c: CollectionName, docs: Doc[], opts: { queue: boolean }): Promise<void> {
  const d = await db();
  const tx = d.transaction(['docs', 'outbox'], 'readwrite');
  const queuedAt = new Date().toISOString();
  for (const doc of docs) {
    await tx.objectStore('docs').put({ ...doc, _c: c } as StoredDoc);
    if (opts.queue) await tx.objectStore('outbox').put({ _c: c, id: doc.id, queuedAt });
  }
  await tx.done;
}

export async function readDoc<T extends Doc>(c: CollectionName, id: string): Promise<T | undefined> {
  const row = await (await db()).get('docs', [c, id]);
  return row ? (strip(row) as unknown as T) : undefined;
}

export async function hardDelete(c: CollectionName, ids: string[]): Promise<void> {
  const d = await db();
  const tx = d.transaction(['docs', 'outbox'], 'readwrite');
  for (const id of ids) {
    await tx.objectStore('docs').delete([c, id]);
    await tx.objectStore('outbox').delete([c, id]);
  }
  await tx.done;
}

export async function outbox(): Promise<{ _c: CollectionName; id: string; queuedAt: string }[]> {
  return (await db()).getAll('outbox');
}

export async function ackOutbox(
  items: { _c: CollectionName; id: string; queuedAt: string }[],
): Promise<void> {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  for (const item of items) {
    // Only acknowledge if nothing newer was queued meanwhile.
    const current = await tx.store.get([item._c, item.id]);
    if (current && current.queuedAt === item.queuedAt) await tx.store.delete([item._c, item.id]);
  }
  await tx.done;
}

export async function getKV<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined;
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key);
}

export async function deleteKV(key: string): Promise<void> {
  await (await db()).delete('kv', key);
}

/** Irreversibly removes every local record (used by "erase this device" and account deletion). */
export async function wipeLocal(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['docs', 'outbox', 'kv'], 'readwrite');
  await Promise.all([
    tx.objectStore('docs').clear(),
    tx.objectStore('outbox').clear(),
    tx.objectStore('kv').clear(),
  ]);
  await tx.done;
}

/** Physically removes tombstones older than `days` that are already synced. */
export async function purgeTombstones(days = 45): Promise<number> {
  const d = await db();
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const pending = new Set((await d.getAll('outbox')).map((o) => `${o._c}:${o.id}`));
  const tx = d.transaction('docs', 'readwrite');
  let removed = 0;
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const v = cursor.value;
    if (v.deletedAt && v.deletedAt < cutoff && !pending.has(`${v._c}:${v.id}`)) {
      await cursor.delete();
      removed += 1;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return removed;
}

function strip(row: StoredDoc): Doc {
  const { _c: _ignored, ...rest } = row;
  return rest as Doc;
}
