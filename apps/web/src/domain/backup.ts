import type { CollectionName, Doc, Settings, Snapshot } from './types';
import { COLLECTIONS } from './types';
import { normalizeSettings, SCHEMA_VERSION } from './defaults';

export const BACKUP_FORMAT = 'sigma-life-os-backup';

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  app: string;
  settings: Settings;
  collections: Partial<Snapshot>;
}

export function createBackup(
  settings: Settings,
  snapshot: Snapshot,
  appVersion: string,
  include: (c: CollectionName) => boolean = () => true,
): Backup {
  const collections: Partial<Snapshot> = {};
  for (const c of COLLECTIONS) {
    if (!include(c)) continue;
    // Tombstones are not exported: a backup is a readable copy of live data.
    (collections as Record<string, Doc[]>)[c] = (snapshot[c] as Doc[]).filter((d) => !d.deletedAt);
  }
  return {
    format: BACKUP_FORMAT,
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    app: appVersion,
    settings,
    collections,
  };
}

export class BackupError extends Error {
  constructor(public readonly code: 'invalid-json' | 'wrong-format' | 'future-version' | 'invalid-records') {
    super(code);
  }
}

const MAX_RECORDS = 200_000;

export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('invalid-json');
  }
  if (!data || typeof data !== 'object') throw new BackupError('wrong-format');
  const b = data as Partial<Backup>;
  if (b.format !== BACKUP_FORMAT || typeof b.collections !== 'object' || !b.collections)
    throw new BackupError('wrong-format');
  if (typeof b.version !== 'number' || b.version > SCHEMA_VERSION) throw new BackupError('future-version');
  const collections: Partial<Snapshot> = {};
  let total = 0;
  for (const c of COLLECTIONS) {
    const rows = (b.collections as Record<string, unknown>)[c];
    if (rows == null) continue;
    if (!Array.isArray(rows)) throw new BackupError('invalid-records');
    const valid = rows.filter(
      (r): r is Doc =>
        Boolean(r) &&
        typeof r === 'object' &&
        typeof (r as Doc).id === 'string' &&
        (r as Doc).id.length > 0 &&
        (r as Doc).id.length < 200,
    );
    total += valid.length;
    (collections as Record<string, Doc[]>)[c] = valid.map((d) => ({
      ...d,
      createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
      updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : new Date().toISOString(),
    }));
  }
  if (total > MAX_RECORDS) throw new BackupError('invalid-records');
  return {
    format: BACKUP_FORMAT,
    version: b.version,
    exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
    app: typeof b.app === 'string' ? b.app : '',
    settings: normalizeSettings(b.settings),
    collections,
  };
}

/** Last-writer-wins merge of two record sets by `updatedAt`. */
export function mergeRecords<T extends Doc>(local: T[], incoming: T[]): { merged: T[]; changed: T[] } {
  const map = new Map(local.map((d) => [d.id, d]));
  const changed: T[] = [];
  for (const d of incoming) {
    const existing = map.get(d.id);
    if (!existing || existing.updatedAt < d.updatedAt) {
      map.set(d.id, d);
      changed.push(d);
    }
  }
  return { merged: [...map.values()], changed };
}
