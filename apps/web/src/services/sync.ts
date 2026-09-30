/**
 * Cloud sync engine (Pro).
 *
 * Model: every record lives at users/{uid}/{collection}/{id}. Writes are
 * queued in the IndexedDB outbox and pushed in batches; each pushed document
 * carries a server timestamp (`serverUpdatedAt`) that is used as the pull
 * cursor. Conflicts resolve per record with last-writer-wins on `updatedAt`,
 * and deletions replicate as tombstones.
 *
 * Health data is only synced after explicit, separate consent; provider
 * caches (mail, social) and the coach transcript never leave the device.
 */
import { effect } from '@preact/signals';
import type { CollectionName, Doc, Settings } from '../domain/types';
import { COLLECTIONS, LOCAL_ONLY_COLLECTIONS, SENSITIVE_COLLECTIONS } from '../domain/types';
import { isPro } from '../domain/entitlements';
import {
  authUser,
  entitlement,
  settings,
  snapshot,
  syncState,
  applyRemote,
  onLocalChange,
  updateSettings,
} from '../data/store';
import { ackOutbox, getKV, outbox, readDoc, setKV, writeDocs } from '../data/db';
import { cloud } from './firebase';
import { reportError } from './monitoring';

let disposeWatcher: (() => void) | null = null;
let session: {
  uid: string;
  key: string;
  unsubs: (() => void)[];
  timer: ReturnType<typeof setInterval> | null;
} | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

export function syncableCollections(s: Settings): CollectionName[] {
  return COLLECTIONS.filter(
    (c) => !LOCAL_ONLY_COLLECTIONS.has(c) && (!SENSITIVE_COLLECTIONS.has(c) || Boolean(s.consent.health)),
  );
}

export function startSync(uid: string): void {
  stopSync();
  disposeWatcher = effect(() => {
    const user = authUser.value;
    const allowed =
      user?.uid === uid && isPro(entitlement.value) && Boolean(settings.value.consent.cloudSync);
    const collectionsKey = syncableCollections(settings.value).join(',');
    if (!allowed) {
      endSession();
      syncState.value = {
        ...syncState.value,
        status: user && !isPro(entitlement.value) ? 'blocked' : 'off',
        error: null,
      };
      return;
    }
    // (Re)start when the set of syncable collections changes, e.g. after health consent.
    if (!session || session.uid !== uid || session.key !== collectionsKey) {
      endSession();
      void beginSession(uid, collectionsKey);
    }
  });
}

export function stopSync(): void {
  disposeWatcher?.();
  disposeWatcher = null;
  endSession();
  syncState.value = { status: 'off', lastSyncAt: syncState.value.lastSyncAt, error: null };
}

function endSession() {
  if (!session) return;
  session.unsubs.forEach((u) => u());
  if (session.timer) clearInterval(session.timer);
  session = null;
}

async function beginSession(uid: string, key: string) {
  const current = {
    uid,
    unsubs: [] as (() => void)[],
    timer: null as ReturnType<typeof setInterval> | null,
    key,
  };
  session = current;
  syncState.value = { ...syncState.value, status: navigator.onLine ? 'syncing' : 'offline', error: null };
  try {
    const { db } = await cloud();
    const fs = await import('firebase/firestore');
    const collections = syncableCollections(settings.value);

    // First sync of a collection for this account: upload everything local.
    for (const c of collections) {
      const flag = `sync:${uid}:init:${c}`;
      if (await getKV(flag)) continue;
      const rows = snapshot.value[c] as Doc[];
      if (rows.length) await writeDocs(c, rows, { queue: true });
      await setKV(flag, new Date().toISOString());
    }
    await setKV('settingsDirty', true);

    for (const c of collections) {
      const cursorKey = `sync:${uid}:cursor:${c}`;
      const cursor = (await getKV<number>(cursorKey)) ?? 0;
      const q = fs.query(
        fs.collection(db, 'users', uid, c),
        fs.where('serverUpdatedAt', '>', fs.Timestamp.fromMillis(cursor)),
        fs.orderBy('serverUpdatedAt'),
      );
      const unsub = fs.onSnapshot(
        q,
        { includeMetadataChanges: false },
        (snap) => {
          if (session !== current || snap.metadata.hasPendingWrites) return;
          const incoming: Doc[] = [];
          let maxCursor = cursor;
          snap.docChanges().forEach((change) => {
            if (change.type === 'removed') return;
            const data = change.doc.data({ serverTimestamps: 'none' }) as Doc & {
              serverUpdatedAt?: { toMillis(): number } | null;
            };
            const ts = data.serverUpdatedAt?.toMillis?.();
            if (ts) maxCursor = Math.max(maxCursor, ts);
            const { serverUpdatedAt: _s, ...rest } = data;
            const local = (snapshot.value[c] as Doc[]).find((d) => d.id === rest.id);
            if (!local || local.updatedAt < rest.updatedAt) incoming.push(rest as Doc);
          });
          void applyRemote(c, incoming as never).then(() =>
            maxCursor > cursor ? setKV(cursorKey, maxCursor) : undefined,
          );
          syncState.value = { status: 'idle', lastSyncAt: new Date().toISOString(), error: null };
        },
        (err) => onSyncError(err),
      );
      current.unsubs.push(unsub);
    }

    // Settings document.
    const settingsRef = fs.doc(db, 'users', uid, 'meta', 'settings');
    current.unsubs.push(
      fs.onSnapshot(
        settingsRef,
        (snap) => {
          if (!snap.exists() || snap.metadata.hasPendingWrites) return;
          const remote = snap.data() as Settings & { updatedAt?: string };
          void getKV<Settings & { updatedAt?: string }>('settings').then((local) => {
            if (!local?.updatedAt || (remote.updatedAt && remote.updatedAt > local.updatedAt)) {
              const {
                updatedAt: _u,
                serverUpdatedAt: _s,
                ...rest
              } = remote as Settings & { updatedAt?: string; serverUpdatedAt?: unknown };
              void updateSettings(() => ({ ...settings.value, ...(rest as Settings) }), { fromRemote: true });
            }
          });
        },
        (err) => onSyncError(err),
      ),
    );

    current.unsubs.push(onLocalChange(() => scheduleFlush()));
    const onOnline = () => {
      syncState.value = { ...syncState.value, status: 'syncing' };
      scheduleFlush(0);
    };
    const onOffline = () => (syncState.value = { ...syncState.value, status: 'offline' });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    current.unsubs.push(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    });
    current.timer = setInterval(() => scheduleFlush(0), 60_000);
    scheduleFlush(0);
  } catch (err) {
    onSyncError(err);
  }
}

export function scheduleFlush(delay = 1200): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), delay);
}

/** Pushes the outbox and dirty settings. Safe to call concurrently. */
export async function flush(): Promise<void> {
  const s = session;
  if (!s || flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const { db } = await cloud();
    const fs = await import('firebase/firestore');
    // Settings first: security rules read the consent recorded there (e.g. for health records).
    if (await getKV('settingsDirty')) {
      const local = await getKV<Settings & { updatedAt?: string }>('settings');
      if (local)
        await fs.setDoc(fs.doc(db, 'users', s.uid, 'meta', 'settings'), {
          ...clean(local),
          serverUpdatedAt: fs.serverTimestamp(),
        });
      await setKV('settingsDirty', false);
    }
    const allowed = new Set(syncableCollections(settings.value));
    const pending = await outbox();
    for (let i = 0; i < pending.length; i += 400) {
      const chunk = pending.slice(i, i + 400).filter((it) => allowed.has(it._c)); // others stay queued until allowed
      const writes: { item: (typeof chunk)[number]; data: Doc }[] = [];
      for (const item of chunk) {
        const local = await readDoc<Doc>(item._c, item.id);
        if (local) writes.push({ item, data: local });
      }
      const ref = (w: (typeof writes)[number]) => fs.doc(db, 'users', s.uid, w.item._c, w.item.id);
      try {
        const batch = fs.writeBatch(db);
        writes.forEach((w) => batch.set(ref(w), { ...clean(w.data), serverUpdatedAt: fs.serverTimestamp() }));
        if (writes.length) await batch.commit();
      } catch (err) {
        if (
          (err as { code?: string }).code !== 'permission-denied' &&
          (err as { code?: string }).code !== 'invalid-argument'
        )
          throw err;
        // One invalid record must not block the queue: retry one by one and report rejects.
        for (const w of writes) {
          await fs
            .setDoc(ref(w), { ...clean(w.data), serverUpdatedAt: fs.serverTimestamp() })
            .catch((e: unknown) => {
              if ((e as { code?: string }).code === 'permission-denied' && !isPro(entitlement.value)) throw e;
              reportError(e, { where: `sync.reject.${w.item._c}` });
            });
        }
      }
      await ackOutbox(chunk);
    }
    syncState.value = { status: 'idle', lastSyncAt: new Date().toISOString(), error: null };
  } catch (err) {
    onSyncError(err);
  } finally {
    flushing = false;
  }
}

function onSyncError(err: unknown) {
  const code = (err as { code?: string }).code ?? 'unknown';
  if (code === 'permission-denied') {
    syncState.value = { ...syncState.value, status: 'blocked', error: code };
    return;
  }
  if (code === 'unavailable') {
    syncState.value = { ...syncState.value, status: 'offline', error: null };
    return;
  }
  syncState.value = { ...syncState.value, status: 'error', error: code };
  reportError(err, { where: 'sync' });
}

/** Firestore rejects `undefined`; JSON round-trip also drops functions/prototypes. */
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
