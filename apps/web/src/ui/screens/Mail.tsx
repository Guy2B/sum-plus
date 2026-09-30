import { useState } from 'preact/hooks';
import type { MailAccount, MailMessage, RelationshipType } from '../../domain/types';
import { create, snapshot, update, clock } from '../../data/store';
import { toTask } from '../../data/actions';
import { syncGmail } from '../../services/connectors/google';
import { syncOutlook } from '../../services/connectors/microsoft';
import { syncImap } from '../../services/connectors/remote';
import { t, fmtRelative } from '../../i18n';
import { Badge, Button, Card, Empty, PageHeader, Tabs, attempt, toast } from '../components';
import { navigate } from '../router';

type Filter = 'reply' | 'unread' | 'important' | 'all';

export async function syncMailAccount(a: MailAccount): Promise<void> {
  try {
    const r =
      a.provider === 'gmail'
        ? await syncGmail(a)
        : a.provider === 'outlook'
          ? await syncOutlook(a)
          : await syncImap(a);
    toast(t('mail.synced', { email: a.email, count: r.added }), 'good');
  } catch (err) {
    const code = (err as { code?: string; message?: string }).code ?? (err as Error).message;
    await update('mailAccounts', a.id, {
      status: code === 'expired' || code === 'scope-denied' ? 'needs-auth' : 'error',
      error: String(code).slice(0, 200),
    });
    throw err;
  }
}

function MessageRow({ m }: { m: MailMessage }) {
  const contact = snapshot.value.contacts.find(
    (c) => !c.deletedAt && c.email && m.senderEmail && c.email.toLowerCase() === m.senderEmail.toLowerCase(),
  );
  const markAs = (rel: RelationshipType) =>
    void attempt(async () => {
      if (contact) await update('contacts', contact.id, { relationshipType: rel });
      else await create('contacts', { name: m.sender, email: m.senderEmail, relationshipType: rel });
    }, t('mail.contactSaved'));
  return (
    <li class={`mail-row ${m.unread ? 'unread' : ''}`}>
      <div class="mail-head">
        <strong>{m.sender}</strong>
        {contact && <Badge tone="accent">{t(`relationship.${contact.relationshipType}`)}</Badge>}
        {m.importance === 'high' && <Badge tone="warn">{t('mail.important')}</Badge>}
        {m.needsReply && <Badge tone="bad">{t('mail.needsReply')}</Badge>}
        <time class="muted small">{fmtRelative(m.receivedAt, clock.value)}</time>
      </div>
      <p class="mail-subject">{m.subject}</p>
      <p class="muted small mail-snippet">{m.snippet}</p>
      <div class="row-actions">
        <Button
          size="sm"
          icon="check"
          onClick={() => void attempt(() => toTask('mailMessages', m.id), t('mail.taskCreated'))}
        >
          {t('mail.toTask')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void update('mailMessages', m.id, { resolved: true, unread: false })}
        >
          {t('mail.resolve')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void update('mailMessages', m.id, { needsReply: !m.needsReply })}
        >
          {m.needsReply ? t('mail.noReplyNeeded') : t('mail.replyNeeded')}
        </Button>
        {m.senderEmail && (
          <select
            aria-label={t('mail.markContact')}
            value={contact?.relationshipType ?? ''}
            onChange={(e) => markAs((e.currentTarget as HTMLSelectElement).value as RelationshipType)}
          >
            <option value="" disabled>
              {t('mail.markContact')}
            </option>
            {(
              [
                'strategic_client',
                'client',
                'active_prospect',
                'partner',
                'manager',
                'colleague',
                'vendor',
                'community',
              ] as const
            ).map((r) => (
              <option key={r} value={r}>
                {t(`relationship.${r}`)}
              </option>
            ))}
          </select>
        )}
        {m.url && (
          <a class="btn btn-ghost btn-sm" href={m.url} target="_blank" rel="noopener noreferrer">
            {t('mail.openInProvider')}
          </a>
        )}
      </div>
    </li>
  );
}

export function Mail() {
  const [filter, setFilter] = useState<Filter>('reply');
  const [busy, setBusy] = useState(false);
  const accounts = snapshot.value.mailAccounts.filter((a) => !a.deletedAt);
  const all = snapshot.value.mailMessages
    .filter((m) => !m.deletedAt && !m.resolved)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const lists: Record<Filter, MailMessage[]> = {
    reply: all.filter((m) => m.needsReply),
    unread: all.filter((m) => m.unread),
    important: all.filter((m) => m.importance === 'high'),
    all,
  };
  const syncAll = async () => {
    setBusy(true);
    for (const a of accounts) await attempt(() => syncMailAccount(a));
    setBusy(false);
  };
  return (
    <div class="page">
      <PageHeader
        title={t('nav.mail')}
        subtitle={t('mail.subtitle')}
        actions={
          accounts.length ? (
            <Button icon="refresh" loading={busy} onClick={() => void syncAll()}>
              {t('mail.syncAll')}
            </Button>
          ) : undefined
        }
      />
      {!accounts.length ? (
        <Card>
          <Empty
            icon="mail"
            title={t('mail.noAccount')}
            body={t('mail.noAccountBody')}
            action={
              <Button variant="primary" icon="plug" onClick={() => navigate('sources')}>
                {t('mail.connect')}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <p class="small muted">
            {accounts
              .map(
                (a) =>
                  `${a.email} (${t(`sources.status.${a.status}`)}${a.lastSyncAt ? ` · ${fmtRelative(a.lastSyncAt, clock.value)}` : ''})`,
              )
              .join(' · ')}
          </p>
          <Tabs
            label={t('mail.filter')}
            value={filter}
            onChange={setFilter}
            options={(['reply', 'unread', 'important', 'all'] as Filter[]).map((f) => ({
              value: f,
              label: t(`mail.filterValue.${f}`),
              count: lists[f].length,
            }))}
          />
          <Card>
            {lists[filter].length ? (
              <ul class="mail-list">
                {lists[filter].slice(0, 100).map((m) => (
                  <MessageRow key={m.id} m={m} />
                ))}
              </ul>
            ) : (
              <Empty icon="check" title={t('mail.emptyFilter')} />
            )}
          </Card>
          <p class="small muted">{t('mail.privacy')}</p>
        </>
      )}
    </div>
  );
}
