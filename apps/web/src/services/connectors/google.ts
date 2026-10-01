/**
 * Google connectors (Gmail, Calendar, YouTube, Drive backup) using Google
 * Identity Services' token model. Access tokens stay in memory only, are
 * short-lived, and every scope is requested incrementally when first needed.
 * Mail content is processed on the device and never sent to Σ servers.
 */
import { config, isNative } from '../../config';
import { nativeAuthAvailable, nativeGoogle } from '../native-auth';
import type { CalendarEvent, MailAccount } from '../../domain/types';
import {
  guessNeedsReply,
  ingestEvents,
  ingestMail,
  ingestSocial,
  parseSender,
  upsertMailAccount,
} from './ingest';
import { create, snapshot, update } from '../../data/store';

export const GOOGLE_SCOPES = {
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
  youtube: 'https://www.googleapis.com/auth/youtube.force-ssl',
  drive: 'https://www.googleapis.com/auth/drive.appdata',
  profile: 'openid email profile',
} as const;
export type GoogleScope = keyof typeof GOOGLE_SCOPES;

interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  error?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; scope?: string; hint?: string }): void;
  callback: (r: TokenResponse) => void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            include_granted_scopes?: boolean;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string }) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

let gisLoaded: Promise<void> | null = null;
let token: { value: string; expiresAt: number; scopes: Set<string> } | null = null;

// In the Android / iOS app, Google tokens come from the phone's account picker (native-auth.ts).
export const googleAvailable = () => (isNative() ? nativeAuthAvailable() : Boolean(config.google.clientId));

function loadGis(): Promise<void> {
  gisLoaded ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('gis-load-failed'));
    document.head.appendChild(s);
  });
  return gisLoaded;
}

export class GoogleAuthError extends Error {}

/** Returns a valid access token covering `scopes`, prompting the user only if needed. */
export async function googleToken(scopes: GoogleScope[], hint?: string): Promise<string> {
  if (!googleAvailable()) throw new GoogleAuthError('google-not-configured');
  const wanted = scopes.map((s) => GOOGLE_SCOPES[s]);
  if (
    token &&
    token.expiresAt > Date.now() + 60_000 &&
    wanted.every((w) => w.split(' ').every((x) => token!.scopes.has(x)))
  ) {
    return token.value;
  }
  if (isNative()) {
    // Google refuses its web sign-in inside apps: ask Android for the scopes instead.
    const all = [...new Set([...(token?.scopes ?? []), ...wanted.flatMap((w) => w.split(' '))])];
    const r = await nativeGoogle(all);
    if (!r.accessToken) throw new GoogleAuthError('no-token');
    // Android does not report the lifetime: Google access tokens last one hour.
    token = { value: r.accessToken, expiresAt: Date.now() + 55 * 60_000, scopes: new Set(all) };
    return r.accessToken;
  }
  await loadGis();
  const scopeString = [...new Set([...(token?.scopes ?? []), ...wanted.flatMap((w) => w.split(' '))])].join(
    ' ',
  );
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: config.google.clientId,
      scope: scopeString,
      include_granted_scopes: true,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new GoogleAuthError(r.error ?? 'no-token'));
        token = {
          value: r.access_token,
          expiresAt: Date.now() + r.expires_in * 1000,
          scopes: new Set(r.scope.split(' ')),
        };
        const missing = wanted.flatMap((w) => w.split(' ')).filter((x) => !token!.scopes.has(x));
        if (missing.length) return reject(new GoogleAuthError('scope-denied'));
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new GoogleAuthError(e.type)),
    });
    client.requestAccessToken({ prompt: '', hint });
  });
}

export function revokeGoogle(): void {
  if (token && window.google && !isNative()) window.google.accounts.oauth2.revoke(token.value);
  token = null;
}

async function gfetch<T>(url: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) },
  });
  if (res.status === 401) {
    token = null;
    throw new GoogleAuthError('expired');
  }
  if (!res.ok) throw new Error(`google-http-${res.status}`);
  return (await res.json()) as T;
}

/* --------------------------------- Gmail ---------------------------------- */

interface GmailList {
  messages?: { id: string; threadId: string }[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  internalDate: string;
  payload: { headers: { name: string; value: string }[] };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx] as T);
      }
    }),
  );
  return out;
}

export async function connectGmail(): Promise<MailAccount> {
  const t = await googleToken(['gmail']);
  const profile = await gfetch<{ emailAddress: string }>(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    t,
  );
  return upsertMailAccount({
    provider: 'gmail',
    email: profile.emailAddress,
    status: 'connected',
    lastSyncAt: null,
    error: null,
  });
}

export async function syncGmail(
  account: MailAccount,
  maxMessages = 40,
): Promise<{ added: number; updated: number }> {
  const t = await googleToken(['gmail'], account.email);
  const q = encodeURIComponent(
    'in:inbox newer_than:21d -category:promotions -category:social -category:forums',
  );
  const list = await gfetch<GmailList>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxMessages}&q=${q}`,
    t,
  );
  const ids = list.messages ?? [];
  const messages = await mapLimit(ids, 6, (m) =>
    gfetch<GmailMessage>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      t,
    ),
  );
  const own = account.email;
  return ingestMail(
    account,
    messages.map((m) => {
      const h = (n: string) =>
        m.payload.headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? '';
      const sender = parseSender(h('From'));
      const subject = h('Subject') || '(—)';
      const snippet = decodeEntities(m.snippet ?? '');
      return {
        externalId: m.id,
        threadId: m.threadId,
        subject,
        sender: sender.name || sender.email,
        senderEmail: sender.email,
        snippet,
        receivedAt: new Date(Number(m.internalDate)).toISOString(),
        unread: Boolean(m.labelIds?.includes('UNREAD')),
        needsReply: guessNeedsReply(subject, snippet, sender.email, own),
        importance: m.labelIds?.includes('IMPORTANT') ? 'high' : 'normal',
        url: `https://mail.google.com/mail/u/0/#inbox/${m.threadId}`,
      };
    }),
  );
}

/** Decodes HTML entities in Gmail snippets; '<' is escaped first so no markup is ever parsed. */
function decodeEntities(s: string): string {
  return (
    new DOMParser().parseFromString(`<!doctype html><body>${s.replace(/</g, '&lt;')}`, 'text/html').body
      .textContent ?? s
  );
}

/* -------------------------------- Calendar -------------------------------- */

interface GCalEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
}

export async function syncGoogleCalendar(daysAhead = 60): Promise<{ added: number; updated: number }> {
  const t = await googleToken(['calendar']);
  const now = new Date();
  const timeMin = new Date(now.getTime() - 86_400_000).toISOString();
  const timeMax = new Date(now.getTime() + daysAhead * 86_400_000).toISOString();
  const items: GCalEvent[] = [];
  let pageToken = '';
  do {
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const page = await gfetch<{ items?: GCalEvent[]; nextPageToken?: string }>(url, t);
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken && items.length < 1000);

  const events: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>[] = items
    .filter((e) => e.status !== 'cancelled')
    .map((e) => {
      const allDay = Boolean(e.start.date);
      const start = allDay ? new Date(`${e.start.date}T00:00:00`) : new Date(e.start.dateTime as string);
      const end = allDay
        ? new Date(`${e.end.date}T00:00:00`)
        : new Date((e.end.dateTime ?? e.start.dateTime) as string);
      return {
        title: e.summary ?? '(—)',
        start: start.toISOString(),
        end: end.toISOString(),
        allDay,
        location: e.location,
        description: e.description?.slice(0, 2000),
        source: { provider: 'google', ref: e.id, url: e.htmlLink },
      };
    });
  return ingestEvents('google', events);
}

/* --------------------------------- YouTube -------------------------------- */

export async function syncYouTube(): Promise<number> {
  const t = await googleToken(['youtube']);
  const ch = await gfetch<{ items?: { id: string; snippet: { title: string } }[] }>(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    t,
  );
  const channel = ch.items?.[0];
  if (!channel) return 0;
  let account = snapshot.value.socialAccounts.find(
    (a) => !a.deletedAt && a.provider === 'youtube' && a.handle === channel.snippet.title,
  );
  if (!account) {
    account = await create('socialAccounts', {
      provider: 'youtube',
      handle: channel.snippet.title,
      status: 'connected',
      capabilities: ['comments'],
      lastSyncAt: null,
      error: null,
    });
  }
  const threads = await gfetch<{
    items?: {
      id: string;
      snippet: {
        totalReplyCount: number;
        videoId?: string;
        topLevelComment: {
          snippet: {
            authorDisplayName: string;
            textOriginal: string;
            publishedAt: string;
            likeCount: number;
          };
        };
      };
    }[];
  }>(
    `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&allThreadsRelatedToChannelId=${channel.id}&maxResults=50&order=time`,
    t,
  );
  const added = await ingestSocial(
    account.id,
    (threads.items ?? []).map((th) => {
      const c = th.snippet.topLevelComment.snippet;
      return {
        provider: 'youtube' as const,
        externalId: th.id,
        kind: 'comment' as const,
        author: c.authorDisplayName,
        text: c.textOriginal.slice(0, 2000),
        url: th.snippet.videoId
          ? `https://www.youtube.com/watch?v=${th.snippet.videoId}&lc=${th.id}`
          : undefined,
        publishedAt: c.publishedAt,
        needsReply: th.snippet.totalReplyCount === 0,
        metrics: { likes: c.likeCount },
      };
    }),
  );
  await update('socialAccounts', account.id, {
    lastSyncAt: new Date().toISOString(),
    status: 'connected',
    error: null,
  });
  return added;
}

/* ------------------------------ Drive backup ------------------------------ */

const BACKUP_NAME = 'sigma-life-os-backup.json';

export async function driveBackup(json: string): Promise<void> {
  const t = await googleToken(['drive']);
  const existing = await gfetch<{ files?: { id: string }[] }>(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${BACKUP_NAME}'`)}&fields=files(id)`,
    t,
  );
  const id = existing.files?.[0]?.id;
  const boundary = `sigma${Math.random().toString(36).slice(2)}`;
  const meta = id ? {} : { name: BACKUP_NAME, parents: ['appDataFolder'] };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  const url = id
    ? `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  const res = await fetch(url, {
    method: id ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`drive-upload-${res.status}`);
}

export async function driveRestore(): Promise<string | null> {
  const t = await googleToken(['drive']);
  const existing = await gfetch<{ files?: { id: string; modifiedTime: string }[] }>(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${BACKUP_NAME}'`)}&fields=files(id,modifiedTime)`,
    t,
  );
  const id = existing.files?.[0]?.id;
  if (!id) return null;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(`drive-download-${res.status}`);
  return res.text();
}
