/**
 * Server-side connectors (Pro): IMAP mailboxes that browsers cannot reach
 * directly, and social networks whose OAuth requires a client secret.
 * Credentials are sent once over HTTPS to Cloud Functions, encrypted there,
 * and never stored in the browser.
 */
import { call } from '../firebase';
import type { MailAccount, SocialProvider } from '../../domain/types';
import { create, snapshot, update } from '../../data/store';
import { guessNeedsReply, ingestMail, ingestSocial } from './ingest';

/**
 * `server`: the preset the Cloud Function knows. Web.de and T-Online are sent as
 * "custom" with their host, so adding a mailbox provider needs no server deploy.
 * `appPassword`: the provider requires a separate password for mail apps.
 */
export const IMAP_PRESETS = {
  gmx: {
    host: 'imap.gmx.net',
    port: 993,
    server: 'gmx',
    appPassword: false,
    help: 'https://hilfe.gmx.net/pop-imap/einschalten.html',
  },
  webde: {
    host: 'imap.web.de',
    port: 993,
    server: 'custom',
    appPassword: false,
    help: 'https://hilfe.web.de/pop-imap/einschalten.html',
  },
  tonline: {
    host: 'secureimap.t-online.de',
    port: 993,
    server: 'custom',
    appPassword: true,
    help: 'https://www.telekom.de/hilfe/festnetz-internet-tv/e-mail/e-mail-adresse-passwoerter-und-sicherheit/passwort-fuer-e-mail-programme-einrichten',
  },
  yahoo: {
    host: 'imap.mail.yahoo.com',
    port: 993,
    server: 'yahoo',
    appPassword: true,
    help: 'https://help.yahoo.com/kb/SLN15241.html',
  },
  icloud: {
    host: 'imap.mail.me.com',
    port: 993,
    server: 'icloud',
    appPassword: true,
    help: 'https://support.apple.com/102654',
  },
  custom: { host: '', port: 993, server: 'custom', appPassword: false, help: '' },
} as const;
export type ImapPreset = keyof typeof IMAP_PRESETS;
type ServerPreset = 'yahoo' | 'gmx' | 'icloud' | 'custom';

interface ImapConnectReq {
  preset: ImapPreset;
  email: string;
  password: string;
  host?: string;
  port?: number;
}
interface ImapServerReq extends Omit<ImapConnectReq, 'preset'> {
  preset: ServerPreset;
}

/** What the Cloud Function receives: known presets as is, the others as "custom" + host. */
export function imapServerRequest(req: ImapConnectReq): ImapServerReq {
  const p = IMAP_PRESETS[req.preset];
  if (p.server !== 'custom') return { ...req, preset: p.server };
  if (req.preset === 'custom') return { ...req, preset: 'custom' };
  // Shown in groups ("abcd efgh ..."), pasted with spaces: the server only strips them for named presets.
  return { ...req, preset: 'custom', host: p.host, port: p.port, password: req.password.replace(/\s+/g, '') };
}
interface RemoteMail {
  externalId: string;
  subject: string;
  sender: string;
  senderEmail: string;
  snippet: string;
  receivedAt: string;
  unread: boolean;
}

export async function connectImap(req: ImapConnectReq): Promise<MailAccount> {
  const res = await call<ImapServerReq, { accountId: string }>('imapConnect', imapServerRequest(req));
  const existing = snapshot.value.mailAccounts.find(
    (a) => !a.deletedAt && a.provider === 'imap' && a.email.toLowerCase() === req.email.toLowerCase(),
  );
  if (existing) {
    await update('mailAccounts', existing.id, { status: 'connected', error: null, imapPreset: req.preset });
    return { ...existing, status: 'connected' };
  }
  return create('mailAccounts', {
    id: res.accountId,
    provider: 'imap',
    email: req.email,
    imapPreset: req.preset,
    status: 'connected',
    lastSyncAt: null,
    error: null,
  });
}

export async function syncImap(account: MailAccount): Promise<{ added: number; updated: number }> {
  const res = await call<{ accountId: string }, { messages: RemoteMail[] }>('imapSync', {
    accountId: account.id,
  });
  return ingestMail(
    account,
    res.messages.map((m) => ({
      ...m,
      needsReply: guessNeedsReply(m.subject, m.snippet, m.senderEmail, account.email),
      importance: 'normal' as const,
    })),
  );
}

export async function disconnectImap(account: MailAccount): Promise<void> {
  await call('imapDisconnect', { accountId: account.id });
}

/* -------------------------------- social ---------------------------------- */

export async function startSocialAuth(provider: Exclude<SocialProvider, 'youtube'>): Promise<void> {
  const returnUrl = new URL('app.html#sources', location.href).toString();
  const res = await call<{ provider: string; returnUrl: string }, { authUrl: string }>('socialStartAuth', {
    provider,
    returnUrl,
  });
  location.assign(res.authUrl);
}

interface RemoteSocialItem {
  externalId: string;
  kind: 'comment' | 'mention' | 'message' | 'post' | 'video';
  author: string;
  text: string;
  url?: string;
  publishedAt: string;
  needsReply: boolean;
  metrics?: Record<string, number>;
}

export async function syncSocial(provider: Exclude<SocialProvider, 'youtube'>): Promise<number> {
  const res = await call<
    { provider: string },
    { handle: string; capabilities: string[]; items: RemoteSocialItem[] }
  >('socialSync', { provider });
  let account = snapshot.value.socialAccounts.find((a) => !a.deletedAt && a.provider === provider);
  if (!account) {
    account = await create('socialAccounts', {
      provider,
      handle: res.handle,
      status: 'connected',
      capabilities: res.capabilities,
      lastSyncAt: null,
      error: null,
    });
  }
  const added = await ingestSocial(
    account.id,
    res.items.map((i) => ({
      ...i,
      provider,
      needsReply: i.needsReply || guessNeedsReply('', i.text, 'x@x', ''),
    })),
  );
  await update('socialAccounts', account.id, {
    handle: res.handle,
    capabilities: res.capabilities,
    status: 'connected',
    lastSyncAt: new Date().toISOString(),
    error: null,
  });
  return added;
}

export async function disconnectSocial(provider: SocialProvider): Promise<void> {
  if (provider !== 'youtube') await call('socialDisconnect', { provider });
}
