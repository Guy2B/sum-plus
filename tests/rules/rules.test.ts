/**
 * Firestore security rules tests. Run against the emulator:
 *   npm run test:rules   (requires Java 21 for the Firebase emulator)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, deleteDoc, Timestamp } from 'firebase/firestore';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-sigma',
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => env?.cleanup());
beforeEach(async () => env.clearFirestore());

const record = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: 'x',
  createdAt: '2026-09-30T08:00:00.000Z',
  updatedAt: '2026-09-30T08:00:00.000Z',
  deletedAt: null,
  serverUpdatedAt: serverTimestamp(),
  ...extra,
});

async function grant(uid: string, entitlement: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `entitlements/${uid}`), entitlement);
  });
}

async function consentHealth(uid: string, value: string | null) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${uid}/meta/settings`), {
      consent: { health: value, cloudSync: 'x' },
    });
  });
}

describe('sync collections', () => {
  it('blocks free users from syncing', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'users/alice/tasks/t1'), record('t1')));
  });

  it('lets a Pro user write their own records and nobody else’s', async () => {
    await grant('alice', { plan: 'pro', status: 'active' });
    const alice = env.authenticatedContext('alice').firestore();
    const bob = env.authenticatedContext('bob').firestore();
    await assertSucceeds(setDoc(doc(alice, 'users/alice/tasks/t1'), record('t1')));
    await assertSucceeds(getDoc(doc(alice, 'users/alice/tasks/t1')));
    await assertFails(getDoc(doc(bob, 'users/alice/tasks/t1')));
    await assertFails(setDoc(doc(bob, 'users/alice/tasks/t2'), record('t2')));
  });

  it('honours paid-through cancellations and rejects expired ones', async () => {
    await grant('carol', {
      plan: 'pro',
      status: 'cancelled',
      validUntilTs: Timestamp.fromMillis(Date.now() + 86_400_000),
    });
    await assertSucceeds(
      setDoc(doc(env.authenticatedContext('carol').firestore(), 'users/carol/tasks/t1'), record('t1')),
    );
    await grant('dave', {
      plan: 'pro',
      status: 'cancelled',
      validUntilTs: Timestamp.fromMillis(Date.now() - 86_400_000),
    });
    await assertFails(
      setDoc(doc(env.authenticatedContext('dave').firestore(), 'users/dave/tasks/t1'), record('t1')),
    );
  });

  it('validates record shape, server timestamp and collection allow-list', async () => {
    await grant('alice', { plan: 'pro', status: 'active' });
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'users/alice/tasks/t1'), record('other-id')));
    await assertFails(
      setDoc(doc(db, 'users/alice/tasks/t1'), { ...record('t1'), serverUpdatedAt: Timestamp.fromMillis(0) }),
    );
    await assertFails(setDoc(doc(db, 'users/alice/mailMessages/m1'), record('m1')));
    await assertFails(setDoc(doc(db, 'users/alice/auditEvents/a1'), record('a1')));
    await assertFails(deleteDoc(doc(db, 'users/alice/tasks/t1')));
  });

  it('requires recorded consent for health records', async () => {
    await grant('alice', { plan: 'pro', status: 'active' });
    const db = env.authenticatedContext('alice').firestore();
    await consentHealth('alice', null);
    await assertFails(setDoc(doc(db, 'users/alice/health/h1'), record('h1')));
    await consentHealth('alice', '2026-09-30T08:00:00.000Z');
    await assertSucceeds(setDoc(doc(db, 'users/alice/health/h1'), record('h1')));
  });
});

describe('server-owned data', () => {
  it('never lets clients write entitlements (no self-granted Pro)', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'entitlements/alice'), { plan: 'pro', status: 'active' }));
    await grant('alice', { plan: 'free', status: 'none' });
    await assertSucceeds(getDoc(doc(db, 'entitlements/alice')));
    await assertFails(getDoc(doc(env.authenticatedContext('bob').firestore(), 'entitlements/alice')));
  });

  it('keeps credentials, OAuth states, rate limits and audit logs private', async () => {
    const db = env.authenticatedContext('alice').firestore();
    for (const path of ['private/alice/connectors/c1', 'oauthStates/s1', 'rateLimits/r1', 'auditLog/a1']) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { x: 1 }));
    }
  });

  it('denies unauthenticated access everywhere', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'users/alice/tasks/t1')));
    await assertFails(getDoc(doc(db, 'entitlements/alice')));
  });
});
