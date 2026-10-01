import { signal } from '@preact/signals';
import { authUser, setEntitlement, type AuthUser } from '../data/store';
import { FREE_ENTITLEMENT, type Entitlement } from '../domain/entitlements';
import { cloud, call } from './firebase';
import { cloudConfigured, config } from '../config';
import { COLLECTIONS, LOCAL_ONLY_COLLECTIONS } from '../domain/types';
import { startSync, stopSync } from './sync';
import { reportError } from './monitoring';

let unsubEntitlement: (() => void) | null = null;

/** Last sign-in error coming back from a redirect (shown in Account). */
export const authError = signal<string | null>(null);

/** Wires Firebase Auth state into the store and starts per-user listeners. */
export async function initAuth(): Promise<void> {
  if (!cloudConfigured()) return;
  try {
    const { auth, db } = await cloud();
    const { onIdTokenChanged, getRedirectResult } = await import('firebase/auth');
    // Coming back from a Google redirect sign-in: surface any error instead of failing silently.
    getRedirectResult(auth).catch((err: unknown) => {
      authError.value = (err as { code?: string }).code ?? 'unknown';
      reportError(err, { where: 'redirect-sign-in' });
    });
    const { doc, onSnapshot } = await import('firebase/firestore');
    onIdTokenChanged(auth, async (user) => {
      unsubEntitlement?.();
      unsubEntitlement = null;
      if (!user) {
        authUser.value = null;
        stopSync();
        await setEntitlement(FREE_ENTITLEMENT);
        return;
      }
      const token = await user.getIdTokenResult();
      const next: AuthUser = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        isAdmin: token.claims.admin === true,
        providers: user.providerData.map((p) => p.providerId),
      };
      authUser.value = next;
      if (!config.openAccess)
        unsubEntitlement = onSnapshot(
          doc(db, 'entitlements', user.uid),
          (snap) =>
            void setEntitlement(
              snap.exists() ? { ...FREE_ENTITLEMENT, ...(snap.data() as Entitlement) } : FREE_ENTITLEMENT,
            ),
          (err) => reportError(err, { where: 'entitlement-listener' }),
        );
      void startSync(user.uid);
    });
  } catch (err) {
    reportError(err, { where: 'initAuth' });
  }
}

export async function signInWithGoogle(): Promise<void> {
  const { auth } = await cloud();
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import('firebase/auth');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  // iPhone/iPad and home-screen apps cannot use sign-in popups: go through a redirect.
  if (preferRedirect()) return signInWithRedirect(auth, provider);
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request')
      await signInWithRedirect(auth, provider);
    else throw err;
  }
}

export function preferRedirect(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  return ios || standalone;
}

export async function signInWithMicrosoft(): Promise<void> {
  const { auth } = await cloud();
  const { OAuthProvider, signInWithPopup } = await import('firebase/auth');
  const provider = new OAuthProvider('microsoft.com');
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}

export async function signInWithEmail(
  email: string,
  password: string,
  mode: 'signin' | 'signup',
): Promise<void> {
  const { auth } = await cloud();
  const m = await import('firebase/auth');
  if (mode === 'signup') {
    const cred = await m.createUserWithEmailAndPassword(auth, email, password);
    await m.sendEmailVerification(cred.user);
  } else {
    await m.signInWithEmailAndPassword(auth, email, password);
  }
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { auth } = await cloud();
  const { sendPasswordResetEmail } = await import('firebase/auth');
  await sendPasswordResetEmail(auth, email);
}

export async function signOut(): Promise<void> {
  const { auth } = await cloud();
  const { signOut: fbSignOut } = await import('firebase/auth');
  stopSync();
  await fbSignOut(auth);
}

const CLOUD_COLLECTIONS = COLLECTIONS.filter((c) => !LOCAL_ONLY_COLLECTIONS.has(c));

/**
 * Erases every cloud record and the auth account. With Cloud Functions this is
 * done server-side (also removing connector credentials); in the free Spark
 * mode the client deletes its own documents (rules allow owner deletes).
 */
export async function deleteCloudAccount(): Promise<void> {
  const { auth, db } = await cloud();
  const { signOut: fbSignOut, deleteUser } = await import('firebase/auth');
  stopSync();
  if (config.functionsEnabled) {
    await call<Record<string, never>, { deleted: true }>('deleteMyAccount', {});
    await fbSignOut(auth).catch(() => undefined);
    return;
  }
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
  // Stored connector credentials live server-side: purge them first.
  if (config.functionsUrl) await call<Record<string, never>, { deleted: number }>('purgeMyConnectors', {});
  const fs = await import('firebase/firestore');
  for (const c of CLOUD_COLLECTIONS) {
    const snap = await fs.getDocs(fs.collection(db, 'users', user.uid, c));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = fs.writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  await fs.deleteDoc(fs.doc(db, 'users', user.uid, 'meta', 'settings')).catch(() => undefined);
  // Founder programme counter (beta).
  await fs.deleteDoc(fs.doc(db, 'founders', user.uid)).catch(() => undefined);
  // Firebase requires a recent sign-in to delete the account itself.
  await deleteUser(user);
}

export async function exportCloudData(): Promise<unknown> {
  if (config.functionsEnabled) return call<Record<string, never>, unknown>('exportMyData', {});
  const { auth, db } = await cloud();
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
  const fs = await import('firebase/firestore');
  const collections: Record<string, unknown[]> = {};
  for (const c of CLOUD_COLLECTIONS) {
    const snap = await fs.getDocs(fs.collection(db, 'users', user.uid, c));
    collections[c] = snap.docs.map((d) => d.data());
  }
  const settingsSnap = await fs.getDoc(fs.doc(db, 'users', user.uid, 'meta', 'settings'));
  return {
    format: 'sigma-life-os-cloud-export',
    exportedAt: new Date().toISOString(),
    account: {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.metadata.creationTime,
    },
    settings: settingsSnap.exists() ? settingsSnap.data() : null,
    collections,
  };
}
