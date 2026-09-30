/**
 * Idempotent ingestion of provider data into the local store: records are
 * matched on (account, external id) so repeated syncs update rather than
 * duplicate, and user-side state (resolved, task created) is preserved.
 */
import type { CalendarEvent, MailAccount, MailMessage, SocialItem } from '../../domain/types';
import { create, createMany, snapshot, update } from '../../data/store';
import { includesAny } from '../../domain/text';

const REQUEST_HINTS = [
  '?',
  'please',
  'could you',
  'can you',
  'merci de',
  'pouvez-vous',
  'pourriez-vous',
  'besoin',
  'confirm',
  'valider',
  'bitte',
  'könnten',
  'por favor',
  'puede',
  'action required',
  'urgent',
];
const NO_REPLY = /no-?reply|donotreply|notification|mailer-daemon|newsletter|news@|info@|marketing/i;

/** Heuristic, clearly labelled in the UI as "probably needs a reply"; users can correct it. */
export function guessNeedsReply(
  subject: string,
  snippet: string,
  senderEmail: string,
  ownEmail: string,
): boolean {
  if (!senderEmail || NO_REPLY.test(senderEmail)) return false;
  if (ownEmail && senderEmail.toLowerCase() === ownEmail.toLowerCase()) return false;
  return includesAny(`${subject} ${snippet}`, REQUEST_HINTS);
}

export function parseSender(from: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (m) return { name: (m[1] || m[2] || '').trim(), email: (m[2] ?? '').trim() };
  return { name: from.trim(), email: from.includes('@') ? from.trim() : '' };
}

export async function upsertMailAccount(
  fields: Omit<MailAccount, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
): Promise<MailAccount> {
  const existing = snapshot.value.mailAccounts.find(
    (a) =>
      !a.deletedAt && a.provider === fields.provider && a.email.toLowerCase() === fields.email.toLowerCase(),
  );
  if (existing) {
    await update('mailAccounts', existing.id, fields);
    return { ...existing, ...fields };
  }
  return create('mailAccounts', fields);
}

export async function ingestMail(
  account: MailAccount,
  messages: Omit<MailMessage, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'accountId' | 'provider'>[],
): Promise<{ added: number; updated: number }> {
  const existing = new Map(
    snapshot.value.mailMessages.filter((m) => m.accountId === account.id).map((m) => [m.externalId, m]),
  );
  const fresh: Parameters<typeof createMany<'mailMessages'>>[1] = [];
  let updated = 0;
  for (const msg of messages) {
    const prev = existing.get(msg.externalId);
    if (prev) {
      if (prev.unread !== msg.unread || prev.importance !== msg.importance) {
        await update('mailMessages', prev.id, { unread: msg.unread, importance: msg.importance });
        updated += 1;
      }
      continue;
    }
    fresh.push({ ...msg, accountId: account.id, provider: account.provider });
  }
  if (fresh.length) await createMany('mailMessages', fresh);
  await update('mailAccounts', account.id, {
    lastSyncAt: new Date().toISOString(),
    status: 'connected',
    error: null,
  });
  return { added: fresh.length, updated };
}

export async function ingestEvents(
  provider: string,
  events: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>[],
): Promise<{ added: number; updated: number }> {
  const existing = new Map(
    snapshot.value.events
      .filter((e) => e.source?.provider === provider && e.source.ref)
      .map((e) => [e.source!.ref as string, e]),
  );
  const fresh: Parameters<typeof createMany<'events'>>[1] = [];
  let updated = 0;
  for (const ev of events) {
    const ref = ev.source?.ref;
    const prev = ref ? existing.get(ref) : undefined;
    if (prev) {
      if (prev.title !== ev.title || prev.start !== ev.start || prev.end !== ev.end || prev.deletedAt) {
        await update('events', prev.id, { ...ev, deletedAt: null });
        updated += 1;
      }
      continue;
    }
    fresh.push(ev);
  }
  if (fresh.length) await createMany('events', fresh);
  return { added: fresh.length, updated };
}

export async function ingestSocial(
  accountId: string,
  items: Omit<SocialItem, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'accountId'>[],
): Promise<number> {
  const existing = new Set(
    snapshot.value.socialItems.filter((s) => s.accountId === accountId).map((s) => s.externalId),
  );
  const fresh = items.filter((i) => !existing.has(i.externalId)).map((i) => ({ ...i, accountId }));
  if (fresh.length) await createMany('socialItems', fresh);
  return fresh.length;
}
