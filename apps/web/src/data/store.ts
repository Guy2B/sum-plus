/**
 * Application state: IndexedDB is the source of truth, Preact signals are the
 * in-memory projection the UI renders from. Every write goes through here so
 * persistence, cross-tab propagation and the sync outbox stay consistent.
 */
import { batch, computed, effect, signal } from '@preact/signals';
import type { CollectionMap, CollectionName, Doc, Settings, Snapshot } from '../domain/types';
import { COLLECTIONS, LOCAL_ONLY_COLLECTIONS } from '../domain/types';
import { defaultSettings, normalizeSettings } from '../domain/defaults';
import { newId, nowIso } from '../domain/ids';
import { FREE_ENTITLEMENT, type Entitlement } from '../domain/entitlements';
import { buildSignals } from '../domain/signals';
import { arbitrate, rankSignals } from '../domain/decision';
import { buildDayBlocks, computeCapacity, groupAttention } from '../domain/planning';
import { importLegacyState, LEGACY_STORAGE_KEY } from '../domain/legacy';
import { getKV, hardDelete, readCollection, setKV, wipeLocal, writeDocs, purgeTombstones } from './db';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  isAdmin: boolean;
  providers: string[];
}

export type SyncState = {
  status: 'off' | 'idle' | 'syncing' | 'error' | 'offline' | 'blocked';
  lastSyncAt: string | null;
  error: string | null;
};

const emptySnapshot = (): Snapshot =>
  Object.fromEntries(COLLECTIONS.map((c) => [c, []])) as unknown as Snapshot;

export const ready = signal(false);
export const snapshot = signal<Snapshot>(emptySnapshot());
export const settings = signal<Settings>(defaultSettings());
export const entitlement = signal<Entitlement>(FREE_ENTITLEMENT);
export const authUser = signal<AuthUser | null>(null);
export const syncState = signal<SyncState>({ status: 'off', lastSyncAt: null, error: null });
/** Ticks every minute so time-relative views (overdue, "in 2h") stay correct. */
export const clock = signal(new Date());

/* ------------------------------ derived ---------------------------------- */

/**
 * Settings as the engines should see them: health data is ignored entirely
 * until the user has given explicit, separate consent (GDPR art. 9).
 */
export const effectiveSettings = computed<Settings>(() => {
  const s = settings.value;
  if (s.consent.health) return s;
  return {
    ...s,
    context: { ...s.context, includedDomains: { ...s.context.includedDomains, health: false } },
  };
});

export const allSignals = computed(() =>
  buildSignals(snapshot.value, effectiveSettings.value.context, clock.value),
);

export const decisionContext = computed(() => {
  const s = snapshot.value;
  return {
    edition: settings.value.edition,
    primaryGoal: settings.value.context.primaryGoal,
    goals: s.goals.filter((g) => !g.deletedAt && g.status === 'active').map((g) => g.title),
    contacts: s.contacts.filter((c) => !c.deletedAt),
    feedback: s.feedback.filter((f) => !f.deletedAt).slice(-500),
  };
});

export const decisions = computed(() => rankSignals(allSignals.value, decisionContext.value, clock.value));
export const capacity = computed(() =>
  computeCapacity(snapshot.value, effectiveSettings.value.context, clock.value),
);
export const topDecisions = computed(() =>
  arbitrate(decisions.value, {
    capacityMinutes: Math.max(capacity.value.capacityMinutes, 30),
    maxItems: 3,
    fillWithLow: true,
  }),
);
export const attention = computed(() => groupAttention(decisions.value));
export const dayBlocks = computed(() =>
  buildDayBlocks(snapshot.value, effectiveSettings.value.context, topDecisions.value.selected, clock.value),
);

/* ----------------------------- change feed -------------------------------- */

type ChangeListener = (c: CollectionName | 'settings') => void;
const listeners = new Set<ChangeListener>();
export function onLocalChange(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sigma-life-os') : null;

function notify(c: CollectionName | 'settings', broadcast = true) {
  listeners.forEach((fn) => fn(c));
  if (broadcast) channel?.postMessage({ type: 'changed', collection: c });
}

channel?.addEventListener(
  'message',
  (ev: MessageEvent<{ type: string; collection: CollectionName | 'settings' }>) => {
    if (ev.data?.type !== 'changed') return;
    if (ev.data.collection === 'settings') void reloadSettings();
    else void reloadCollection(ev.data.collection);
  },
);

/* ------------------------------- loading ---------------------------------- */

export async function initStore(): Promise<{ migratedLegacy: Record<string, number> | null }> {
  const migratedLegacy = await migrateLegacyIfNeeded();
  const [loaded, storedSettings, storedEnt] = await Promise.all([
    Promise.all(COLLECTIONS.map(async (c) => [c, await readCollection(c)] as const)),
    getKV<Settings>('settings'),
    getKV<Entitlement>('entitlement'),
  ]);
  batch(() => {
    snapshot.value = Object.fromEntries(loaded) as unknown as Snapshot;
    settings.value = normalizeSettings(storedSettings);
    if (storedEnt) entitlement.value = storedEnt;
    ready.value = true;
  });
  setInterval(() => (clock.value = new Date()), 60_000);
  void purgeTombstones().catch(() => undefined);
  return { migratedLegacy };
}

async function reloadCollection(c: CollectionName) {
  const rows = await readCollection(c);
  snapshot.value = { ...snapshot.value, [c]: rows };
}

async function reloadSettings() {
  settings.value = normalizeSettings(await getKV<Settings>('settings'));
}

async function migrateLegacyIfNeeded(): Promise<Record<string, number> | null> {
  if (await getKV('legacyMigrated')) return null;
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null');
  } catch {
    raw = null;
  }
  await setKV('legacyMigrated', nowIso());
  const result = importLegacyState(raw);
  if (!result) return null;
  for (const [c, rows] of Object.entries(result.snapshot) as [CollectionName, Doc[]][]) {
    if (rows.length) await writeDocs(c, rows, { queue: !LOCAL_ONLY_COLLECTIONS.has(c) });
  }
  await setKV('settings', { ...result.settings, updatedAt: nowIso() });
  return result.counts;
}

/* ------------------------------- writes ----------------------------------- */

type NewFields<C extends CollectionName> = Omit<
  CollectionMap[C],
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
> & { id?: string };

async function persist<C extends CollectionName>(
  c: C,
  docs: CollectionMap[C][],
  opts: { fromRemote?: boolean } = {},
) {
  await writeDocs(c, docs, { queue: !opts.fromRemote && !LOCAL_ONLY_COLLECTIONS.has(c) });
  const byId = new Map((snapshot.value[c] as Doc[]).map((d) => [d.id, d]));
  for (const d of docs) byId.set(d.id, d);
  snapshot.value = { ...snapshot.value, [c]: [...byId.values()] };
  notify(c, !opts.fromRemote);
}

export async function create<C extends CollectionName>(
  c: C,
  fields: NewFields<C>,
): Promise<CollectionMap[C]> {
  const now = nowIso();
  const doc = {
    ...fields,
    id: fields.id ?? newId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  } as unknown as CollectionMap[C];
  await persist(c, [doc]);
  return doc;
}

export async function createMany<C extends CollectionName>(c: C, rows: NewFields<C>[]): Promise<void> {
  const now = nowIso();
  await persist(
    c,
    rows.map(
      (f) =>
        ({
          ...f,
          id: f.id ?? newId(),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        }) as unknown as CollectionMap[C],
    ),
  );
}

export async function update<C extends CollectionName>(
  c: C,
  id: string,
  patch: Partial<CollectionMap[C]>,
): Promise<void> {
  const current = (snapshot.value[c] as Doc[]).find((d) => d.id === id);
  if (!current) return;
  await persist(c, [{ ...current, ...patch, id, updatedAt: nowIso() } as CollectionMap[C]]);
}

/** Soft delete: the tombstone replicates the deletion to other devices. */
export async function remove(c: CollectionName, id: string): Promise<void> {
  await update(c, id, { deletedAt: nowIso() } as never);
}

export async function restore(c: CollectionName, id: string): Promise<void> {
  await update(c, id, { deletedAt: null } as never);
}

/** Imports records as-is (backup restore): original ids and timestamps are preserved. */
export async function importDocs<C extends CollectionName>(c: C, docs: CollectionMap[C][]): Promise<void> {
  if (docs.length) await persist(c, docs);
}

/** Applies records coming from the cloud (already conflict-resolved by the caller). */
export async function applyRemote<C extends CollectionName>(c: C, docs: CollectionMap[C][]): Promise<void> {
  if (docs.length) await persist(c, docs, { fromRemote: true });
}

export async function replaceCollection<C extends CollectionName>(
  c: C,
  docs: CollectionMap[C][],
): Promise<void> {
  const existing = (snapshot.value[c] as Doc[]).map((d) => d.id);
  await hardDelete(c, existing);
  snapshot.value = { ...snapshot.value, [c]: [] };
  await persist(c, docs);
}

export async function updateSettings(
  patch: Partial<Settings> | ((s: Settings) => Settings),
  opts: { fromRemote?: boolean } = {},
): Promise<void> {
  const next =
    typeof patch === 'function' ? patch(settings.value) : normalizeSettings({ ...settings.value, ...patch });
  settings.value = next;
  await setKV('settings', { ...next, updatedAt: nowIso() });
  if (!opts.fromRemote) await setKV('settingsDirty', true);
  notify('settings', !opts.fromRemote);
}

export async function setEntitlement(e: Entitlement): Promise<void> {
  entitlement.value = e;
  await setKV('entitlement', e);
}

export async function eraseDevice(): Promise<void> {
  await wipeLocal();
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* storage may be unavailable */
  }
  batch(() => {
    snapshot.value = emptySnapshot();
    settings.value = defaultSettings();
    entitlement.value = FREE_ENTITLEMENT;
  });
  await setKV('legacyMigrated', nowIso());
}

/* --------------------------- theme side-effect ---------------------------- */

effect(() => {
  if (typeof document === 'undefined') return;
  const s = settings.value;
  const root = document.documentElement;
  root.lang = s.locale;
  if (s.theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = s.theme;
  root.dataset.edition = s.edition;
});
