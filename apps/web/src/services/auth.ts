import { authUser, setEntitlement, type AuthUser } from '../data/store';
import { FREE_ENTITLEMENT, type Entitlement } from '../domain/entitlements';
import { cloud, call } from './firebase';
import { cloudConfigured } from '../config';
import { startSync, stopSync } from './sync';
import { reportError } from './monitoring';

let unsubEntitlement: (() => void) | null = null;

/** Wires Firebase Auth state into the store and starts per-user listeners. */
export async function initAuth(): Promise<void> {
  if (!cloudConfigured()) return;
  try {
    const { auth, db } = await cloud();
    const { onIdTokenChanged } = await import('firebase/auth');
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
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/popup-blocked') await signInWithRedirect(auth, provider);
    else throw err;
  }
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

/** Server-side erasure of every cloud record, credential and the auth account. */
export async function deleteCloudAccount(): Promise<void> {
  await call<Record<string, never>, { deleted: true }>('deleteMyAccount', {});
  const { auth } = await cloud();
  const { signOut: fbSignOut } = await import('firebase/auth');
  stopSync();
  await fbSignOut(auth).catch(() => undefined);
}

export async function exportCloudData(): Promise<unknown> {
  return call<Record<string, never>, unknown>('exportMyData', {});
}
