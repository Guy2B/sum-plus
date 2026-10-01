/**
 * Native sign-in for the Android / iOS app (Capacitor plugin
 * @capacitor-firebase/authentication, configured with skipNativeAuth).
 * Google and Microsoft refuse sign-in inside embedded WebViews, so the app uses
 * the phone's own account picker / browser tab and receives the tokens:
 *  - an ID token to open the Σ session with the Firebase JavaScript SDK (Google);
 *  - access tokens for Gmail / Google Calendar / Microsoft Graph connectors.
 * Tokens stay on the device, exactly like on the web.
 */
interface NativeCredential {
  idToken?: string;
  accessToken?: string;
}
interface NativeResult {
  user?: { email?: string | null } | null;
  credential?: NativeCredential | null;
  additionalUserInfo?: { profile?: Record<string, unknown> } | null;
}
interface FirebaseAuthenticationPlugin {
  signInWithGoogle(options?: { scopes?: string[]; skipNativeAuth?: boolean }): Promise<NativeResult>;
  signInWithMicrosoft(options?: {
    scopes?: string[];
    skipNativeAuth?: boolean;
    customParameters?: { key: string; value: string }[];
  }): Promise<NativeResult>;
  signOut(): Promise<void>;
}

function plugin(): FirebaseAuthenticationPlugin | null {
  const cap = (
    window as { Capacitor?: { Plugins?: { FirebaseAuthentication?: FirebaseAuthenticationPlugin } } }
  ).Capacitor;
  return cap?.Plugins?.FirebaseAuthentication ?? null;
}

export const nativeAuthAvailable = () => plugin() !== null;

/** Email claim of an ID token (no signature check needed: it only labels the account). */
export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split('.')[1] ?? '';
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      email?: string;
      preferred_username?: string;
    };
    return json.email ?? json.preferred_username ?? null;
  } catch {
    return null;
  }
}

export interface NativeTokens {
  idToken?: string;
  accessToken?: string;
  email: string | null;
}

function tokens(r: NativeResult): NativeTokens {
  const profile = r.additionalUserInfo?.profile ?? {};
  const email =
    r.user?.email ??
    emailFromIdToken(r.credential?.idToken) ??
    (typeof profile.mail === 'string' ? profile.mail : null) ??
    (typeof profile.userPrincipalName === 'string' ? profile.userPrincipalName : null);
  return { idToken: r.credential?.idToken, accessToken: r.credential?.accessToken, email };
}

/** Google account picker of the phone; extra scopes go through Android's authorization screen. */
export async function nativeGoogle(scopes: string[] = []): Promise<NativeTokens> {
  const p = plugin();
  if (!p) throw Object.assign(new Error('native-auth-unavailable'), { code: 'native-auth-unavailable' });
  return tokens(await p.signInWithGoogle({ scopes, skipNativeAuth: true }));
}

/** Microsoft sign-in in a browser tab; returns a Microsoft Graph access token for the scopes. */
export async function nativeMicrosoft(scopes: string[]): Promise<NativeTokens> {
  const p = plugin();
  if (!p) throw Object.assign(new Error('native-auth-unavailable'), { code: 'native-auth-unavailable' });
  const r = tokens(
    await p.signInWithMicrosoft({
      scopes,
      skipNativeAuth: true,
      customParameters: [{ key: 'prompt', value: 'select_account' }],
    }),
  );
  // Only the Graph token is used: never keep a separate native session around.
  await p.signOut().catch(() => undefined);
  return r;
}
