/**
 * Lazy Firebase bootstrap: the SDK is only downloaded once cloud features are
 * used, so the local-first app starts fast and works without any backend.
 */
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import { config, cloudConfigured } from '../config';

export interface Cloud {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
}

let cloudPromise: Promise<Cloud> | null = null;

export class CloudUnavailableError extends Error {
  constructor() {
    super('cloud-not-configured');
  }
}

export function cloud(): Promise<Cloud> {
  if (!cloudConfigured()) return Promise.reject(new CloudUnavailableError());
  cloudPromise ??= (async () => {
    const [{ initializeApp }, authMod, fsMod, fnMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
      import('firebase/functions'),
    ]);
    const app = initializeApp(config.firebase);

    if (config.appCheckSiteKey && !config.useEmulators) {
      const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(config.appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    }

    const auth = authMod.initializeAuth(app, {
      persistence: [authMod.indexedDBLocalPersistence, authMod.browserLocalPersistence],
      popupRedirectResolver: authMod.browserPopupRedirectResolver,
    });
    // IndexedDB is already our offline store: keep Firestore's cache in memory.
    const db = fsMod.initializeFirestore(app, {
      localCache: fsMod.memoryLocalCache(),
      ignoreUndefinedProperties: true,
    });
    const functions = fnMod.getFunctions(app, config.functionsUrl || config.functionsRegion);

    if (config.useEmulators) {
      authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      fsMod.connectFirestoreEmulator(db, '127.0.0.1', 8080);
      fnMod.connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    }
    return { app, auth, db, functions };
  })();
  return cloudPromise;
}

/** Typed callable helper with a uniform error shape. */
export async function call<Req, Res>(name: string, data: Req): Promise<Res> {
  const { functions } = await cloud();
  const { httpsCallable } = await import('firebase/functions');
  const fn = httpsCallable<Req, Res>(functions, name, { timeout: 60_000 });
  const res = await fn(data);
  return res.data;
}
