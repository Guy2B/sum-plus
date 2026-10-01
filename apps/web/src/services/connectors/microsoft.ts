/**
 * Microsoft 365 / Outlook.com via MSAL (Authorization Code + PKCE, SPA).
 * Tokens are cached by MSAL in this browser's localStorage only; Graph calls happen on the
 * device and mail content never transits through Σ servers.
 */
import type { IPublicClientApplication, AccountInfo } from '@azure/msal-browser';
import { config, isNative } from '../../config';
import { nativeAuthAvailable, nativeMicrosoft } from '../native-auth';
import { NeedsUserError, isSilent } from './mode';
import type { CalendarEvent, MailAccount } from '../../domain/types';
import { guessNeedsReply, ingestEvents, ingestMail, upsertMailAccount } from './ingest';

const SCOPES = ['User.Read', 'Mail.Read', 'Calendars.Read', 'Contacts.Read'];

let msal: Promise<IPublicClientApplication> | null = null;

// In the Android / iOS app, the Graph token comes from a native browser-tab sign-in (native-auth.ts).
export const microsoftAvailable = () =>
  isNative() ? nativeAuthAvailable() : Boolean(config.microsoft.clientId);

/** Native app: Graph tokens per account, kept in memory only (one hour). */
const nativeTokens = new Map<string, { token: string; expiresAt: number }>();

async function client(): Promise<IPublicClientApplication> {
  if (!microsoftAvailable()) throw new Error('microsoft-not-configured');
  msal ??= (async () => {
    const { PublicClientApplication } = await import('@azure/msal-browser');
    const app = await PublicClientApplication.createPublicClientApplication({
      auth: {
        clientId: config.microsoft.clientId,
        authority: `https://login.microsoftonline.com/${config.microsoft.tenant}`,
        redirectUri: new URL('app.html', location.href).toString().replace(/#.*$/, ''),
      },
      // Kept on this device across restarts so automatic syncs stay silent (never sent anywhere).
      cache: { cacheLocation: 'localStorage' },
    });
    await app.handleRedirectPromise().catch(() => null);
    return app;
  })();
  return msal;
}

async function tokenFor(
  account?: AccountInfo | null,
  hint?: string,
): Promise<{ token: string; account: AccountInfo }> {
  if (isNative()) {
    const asAccount = (email: string) =>
      ({
        username: email,
        homeAccountId: email,
        environment: 'native',
        tenantId: '',
        localAccountId: email,
      }) as AccountInfo;
    const key = (account?.username ?? hint ?? '').toLowerCase();
    const cached = key ? nativeTokens.get(key) : undefined;
    if (cached && cached.expiresAt > Date.now() + 60_000)
      return { token: cached.token, account: asAccount(key) };
    if (isSilent()) throw new NeedsUserError('microsoft');
    const r = await nativeMicrosoft(SCOPES);
    if (!r.accessToken) throw new Error('microsoft-no-token');
    const email = (r.email ?? hint ?? 'outlook').toLowerCase();
    nativeTokens.set(email, { token: r.accessToken, expiresAt: Date.now() + 55 * 60_000 });
    return { token: r.accessToken, account: asAccount(email) };
  }
  const app = await client();
  const acc =
    account ??
    app.getAllAccounts().find((a) => !hint || a.username.toLowerCase() === hint.toLowerCase()) ??
    null;
  if (acc) {
    try {
      const r = await app.acquireTokenSilent({ scopes: SCOPES, account: acc });
      return { token: r.accessToken, account: r.account };
    } catch {
      /* fall through to interactive */
    }
  }
  if (isSilent()) throw new NeedsUserError('microsoft');
  const r = await app.acquireTokenPopup({
    scopes: SCOPES,
    loginHint: hint,
    prompt: acc ? undefined : 'select_account',
  });
  return { token: r.accessToken, account: r.account };
}

async function graph<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' },
  });
  if (!res.ok) throw new Error(`graph-http-${res.status}`);
  return (await res.json()) as T;
}

export async function connectOutlook(): Promise<MailAccount> {
  const { token } = await tokenFor(null);
  const me = await graph<{ mail?: string; userPrincipalName: string; displayName?: string }>(
    '/me?$select=mail,userPrincipalName,displayName',
    token,
  );
  return upsertMailAccount({
    provider: 'outlook',
    email: me.mail ?? me.userPrincipalName,
    displayName: me.displayName,
    status: 'connected',
    lastSyncAt: null,
    error: null,
  });
}

interface GraphMessage {
  id: string;
  conversationId: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime: string;
  isRead: boolean;
  importance: 'low' | 'normal' | 'high';
  webLink?: string;
  from?: { emailAddress: { name?: string; address?: string } };
  inferenceClassification?: 'focused' | 'other';
}

export async function syncOutlook(
  account: MailAccount,
  maxMessages = 40,
): Promise<{ added: number; updated: number }> {
  const { token } = await tokenFor(null, account.email);
  const since = new Date(Date.now() - 21 * 86_400_000).toISOString();
  const res = await graph<{ value: GraphMessage[] }>(
    `/me/mailFolders/inbox/messages?$top=${maxMessages}&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${since}&$select=id,conversationId,subject,bodyPreview,receivedDateTime,isRead,importance,webLink,from,inferenceClassification`,
    token,
  );
  return ingestMail(
    account,
    res.value
      .filter((m) => m.inferenceClassification !== 'other')
      .map((m) => {
        const email = m.from?.emailAddress.address ?? '';
        const subject = m.subject || '(—)';
        const snippet = (m.bodyPreview ?? '').slice(0, 300);
        return {
          externalId: m.id,
          threadId: m.conversationId,
          subject,
          sender: m.from?.emailAddress.name || email,
          senderEmail: email,
          snippet,
          receivedAt: m.receivedDateTime,
          unread: !m.isRead,
          needsReply: guessNeedsReply(subject, snippet, email, account.email),
          importance: m.importance === 'high' ? 'high' : m.importance === 'low' ? 'low' : 'normal',
          url: m.webLink,
        };
      }),
  );
}

interface GraphEvent {
  id: string;
  subject?: string;
  isAllDay: boolean;
  isCancelled?: boolean;
  webLink?: string;
  location?: { displayName?: string };
  bodyPreview?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

export async function syncOutlookCalendar(
  account?: MailAccount,
  daysAhead = 60,
): Promise<{ added: number; updated: number }> {
  const { token } = await tokenFor(null, account?.email);
  const start = new Date(Date.now() - 86_400_000).toISOString();
  const end = new Date(Date.now() + daysAhead * 86_400_000).toISOString();
  // Ask Graph for UTC so the stored ISO strings are unambiguous.
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start}&endDateTime=${end}&$top=500&$select=id,subject,isAllDay,isCancelled,webLink,location,bodyPreview,start,end`,
    {
      headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
    },
  );
  if (!res.ok) throw new Error(`graph-http-${res.status}`);
  const data = (await res.json()) as { value: GraphEvent[] };
  const events: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>[] = data.value
    .filter((e) => !e.isCancelled)
    .map((e) => ({
      title: e.subject ?? '(—)',
      start: new Date(`${e.start.dateTime.replace(/\.\d+$/, '')}Z`).toISOString(),
      end: new Date(`${e.end.dateTime.replace(/\.\d+$/, '')}Z`).toISOString(),
      allDay: e.isAllDay,
      location: e.location?.displayName,
      description: e.bodyPreview?.slice(0, 2000),
      source: { provider: 'microsoft', ref: e.id, url: e.webLink },
    }));
  return ingestEvents('microsoft', events);
}

export async function outlookContacts(): Promise<{ name: string; email: string }[]> {
  const { token } = await tokenFor(null);
  const res = await graph<{ value: { displayName?: string; emailAddresses?: { address?: string }[] }[] }>(
    '/me/contacts?$top=200&$select=displayName,emailAddresses',
    token,
  );
  return res.value.flatMap((c) =>
    c.emailAddresses?.[0]?.address
      ? [{ name: c.displayName ?? c.emailAddresses[0].address, email: c.emailAddresses[0].address }]
      : [],
  );
}

export async function signOutMicrosoft(email: string): Promise<void> {
  if (isNative()) {
    nativeTokens.delete(email.toLowerCase());
    return;
  }
  const app = await client();
  const acc = app.getAllAccounts().find((a) => a.username.toLowerCase() === email.toLowerCase());
  if (acc) await app.clearCache({ account: acc });
}
