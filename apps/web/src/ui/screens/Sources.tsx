import { useEffect, useState } from 'preact/hooks';
import type { MailAccount, RelationshipType, SocialAccount, SocialProvider } from '../../domain/types';
import { authUser, create, entitlement, snapshot, update, clock, remove } from '../../data/store';
import { can, withinLimit } from '../../domain/entitlements';
import { config, connectorServerAvailable, isNative } from '../../config';
import {
  connectGmail,
  googleAvailable,
  syncYouTube,
  revokeGoogle,
  syncGoogleCalendar,
} from '../../services/connectors/google';
import {
  connectOutlook,
  microsoftAvailable,
  outlookContacts,
  signOutMicrosoft,
  syncOutlookCalendar,
} from '../../services/connectors/microsoft';
import {
  IMAP_PRESETS,
  connectImap,
  disconnectImap,
  disconnectSocial,
  startSocialAuth,
  syncSocial,
  type ImapPreset,
} from '../../services/connectors/remote';
import { t, fmtRelative } from '../../i18n';
import {
  Badge,
  Button,
  Card,
  Field,
  IconButton,
  Modal,
  PageHeader,
  attempt,
  confirmDialog,
  toast,
} from '../components';
import { navigate } from '../router';
import { syncMailAccount } from './Mail';

type Status = 'ready' | 'notConfigured' | 'needsPro' | 'needsSignIn' | 'approval';

function StatusBadge({ s }: { s: Status }) {
  const tone = s === 'ready' ? 'good' : s === 'approval' || s === 'notConfigured' ? 'neutral' : 'warn';
  return <Badge tone={tone}>{t(`sources.availability.${s}`)}</Badge>;
}

async function purgeAccountData(account: MailAccount) {
  for (const m of snapshot.value.mailMessages)
    if (!m.deletedAt && m.accountId === account.id) await remove('mailMessages', m.id);
  await remove('mailAccounts', account.id);
}

async function purgeSocial(a: SocialAccount) {
  for (const s of snapshot.value.socialItems)
    if (!s.deletedAt && s.accountId === a.id) await remove('socialItems', s.id);
  await remove('socialAccounts', a.id);
}

function ImapDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [preset, setPreset] = useState<ImapPreset>('yahoo');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const account = await attempt(
      () =>
        connectImap({
          preset,
          email: email.trim(),
          password,
          host: preset === 'custom' ? host.trim() : undefined,
        }),
      t('sources.connected'),
    );
    setPassword('');
    setBusy(false);
    if (account) {
      onClose();
      void attempt(() => syncMailAccount(account));
    }
  };
  const help = IMAP_PRESETS[preset].help;
  return (
    <Modal open={open} onClose={onClose} title={t('sources.imapTitle')}>
      <form class="form" onSubmit={submit} autoComplete="off">
        <Field label={t('sources.imapProvider')}>
          {(id) => (
            <select
              id={id}
              value={preset}
              onChange={(e) => setPreset((e.currentTarget as HTMLSelectElement).value as ImapPreset)}
            >
              {(Object.keys(IMAP_PRESETS) as ImapPreset[]).map((p) => (
                <option key={p} value={p}>
                  {t(`provider.imap.${p}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('sources.email')}>
          {(id) => (
            <input
              id={id}
              type="email"
              required
              value={email}
              onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)}
            />
          )}
        </Field>
        {preset === 'custom' && (
          <Field label={t('sources.imapHost')}>
            {(id) => (
              <input
                id={id}
                required
                placeholder="imap.example.com"
                value={host}
                onInput={(e) => setHost((e.currentTarget as HTMLInputElement).value)}
              />
            )}
          </Field>
        )}
        <Field label={t('sources.appPassword')} hint={t('sources.appPasswordHint')}>
          {(id) => (
            <input
              id={id}
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)}
            />
          )}
        </Field>
        {help && (
          <a class="link small" href={help} target="_blank" rel="noopener noreferrer">
            {t('sources.appPasswordHelp')}
          </a>
        )}
        <p class="small muted">{t('sources.imapSecurity')}</p>
        <div class="modal-actions">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {t('sources.connect')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Contacts() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [rel, setRel] = useState<RelationshipType>('client');
  const contacts = snapshot.value.contacts
    .filter((c) => !c.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
  const REL: RelationshipType[] = [
    'strategic_client',
    'client',
    'active_prospect',
    'partner',
    'manager',
    'colleague',
    'candidate',
    'community',
    'vendor',
  ];
  return (
    <Card title={t('sources.contacts')} id="contacts">
      <p class="small muted">{t('sources.contactsHint')}</p>
      <ul class="plain-list">
        {contacts.map((c) => (
          <li key={c.id} class="ledger-row">
            <span>
              <strong>{c.name}</strong> <small class="muted">{c.email}</small>
            </span>
            <select
              aria-label={t('sources.relationship')}
              value={c.relationshipType}
              onChange={(e) =>
                void update('contacts', c.id, {
                  relationshipType: (e.currentTarget as HTMLSelectElement).value as RelationshipType,
                })
              }
            >
              {REL.map((r) => (
                <option key={r} value={r}>
                  {t(`relationship.${r}`)}
                </option>
              ))}
            </select>
            <IconButton
              icon="trash"
              label={t('common.delete')}
              onClick={() => void remove('contacts', c.id)}
            />
          </li>
        ))}
      </ul>
      <form
        class="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void create('contacts', {
            name: name.trim().slice(0, 120),
            email: email.trim().toLowerCase().slice(0, 200) || undefined,
            relationshipType: rel,
          }).then(() => {
            setName('');
            setEmail('');
          });
        }}
      >
        <input
          aria-label={t('sources.contactName')}
          placeholder={t('sources.contactName')}
          maxLength={120}
          value={name}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
        <input
          type="email"
          aria-label={t('sources.email')}
          placeholder={t('sources.email')}
          value={email}
          onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)}
        />
        <select
          aria-label={t('sources.relationship')}
          value={rel}
          onChange={(e) => setRel((e.currentTarget as HTMLSelectElement).value as RelationshipType)}
        >
          {REL.map((r) => (
            <option key={r} value={r}>
              {t(`relationship.${r}`)}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" icon="plus">
          {t('common.add')}
        </Button>
      </form>
      {microsoftAvailable() &&
        snapshot.value.mailAccounts.some((a) => !a.deletedAt && a.provider === 'outlook') && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void attempt(async () => {
                const list = await outlookContacts();
                const known = new Set(contacts.map((c) => c.email));
                let n = 0;
                for (const c of list) {
                  if (known.has(c.email.toLowerCase())) continue;
                  await create('contacts', {
                    name: c.name,
                    email: c.email.toLowerCase(),
                    relationshipType: 'unknown',
                  });
                  n += 1;
                }
                toast(t('sources.contactsImported', { count: n }), 'good');
              })
            }
          >
            {t('sources.importOutlookContacts')}
          </Button>
        )}
    </Card>
  );
}

export function Sources() {
  const [imapOpen, setImapOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const user = authUser.value;
  const ent = entitlement.value;
  const accounts = snapshot.value.mailAccounts.filter((a) => !a.deletedAt);
  const socials = snapshot.value.socialAccounts.filter((a) => !a.deletedAt);
  const canMail = withinLimit('mailAccounts', accounts.length, ent);

  // Return from a social OAuth flow handled by Cloud Functions.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const status = params.get('sigmaSocial');
    const provider = params.get('provider') as SocialProvider | null;
    if (!status || !provider) return;
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
    if (status === 'connected') {
      toast(t('sources.socialConnected', { provider: t(`provider.${provider}`) }), 'good');
      if (provider !== 'youtube') void attempt(() => syncSocial(provider));
    } else toast(t('sources.socialFailed', { provider: t(`provider.${provider}`) }), 'bad');
  }, []);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    await attempt(fn, ok);
    setBusy('');
  };

  const mailStatus = (needsServer: boolean, available: boolean): Status => {
    if (!available) return 'notConfigured';
    if (needsServer && !connectorServerAvailable()) return 'notConfigured';
    if (needsServer && !user) return 'needsSignIn';
    if (needsServer && !can('imap', ent)) return 'needsPro';
    if (!canMail) return 'needsPro';
    return 'ready';
  };
  const socialStatus = (p: 'linkedin' | 'x' | 'tiktok' | 'meta'): Status => {
    if (p === 'meta')
      return config.social.meta
        ? user
          ? can('social', ent)
            ? 'ready'
            : 'needsPro'
          : 'needsSignIn'
        : 'approval';
    // OAuth redirects leave the app: social accounts are connected from the web version for now.
    if (!config.social[p] || !connectorServerAvailable() || isNative()) return 'notConfigured';
    if (!user) return 'needsSignIn';
    if (!can('social', ent)) return 'needsPro';
    return 'ready';
  };
  const act = (s: Status, fn: () => void) => () => {
    if (s === 'needsPro') navigate('account', 'plan');
    else if (s === 'needsSignIn') navigate('account');
    else if (s === 'ready') fn();
  };

  const gmailS = mailStatus(false, googleAvailable());
  const outlookS = mailStatus(false, microsoftAvailable());
  const imapS = mailStatus(true, true);

  return (
    <div class="page">
      <PageHeader title={t('nav.sources')} subtitle={t('sources.subtitle')} />
      {isNative() && <p class="notice small">{t('native.sourcesWeb')}</p>}

      <Card title={t('sources.connected')}>
        {accounts.length || socials.length ? (
          <ul class="plain-list">
            {accounts.map((a) => (
              <li key={a.id} class="ledger-row">
                <span>
                  <strong>{a.email}</strong> <small class="muted">{t(`provider.${a.provider}`)}</small>
                </span>
                <Badge tone={a.status === 'connected' ? 'good' : a.status === 'error' ? 'bad' : 'warn'}>
                  {t(`sources.status.${a.status}`)}
                </Badge>
                <span class="muted small">
                  {a.lastSyncAt ? fmtRelative(a.lastSyncAt, clock.value) : t('sources.neverSynced')}
                </span>
                <Button
                  size="sm"
                  icon="refresh"
                  loading={busy === a.id}
                  onClick={() => void run(a.id, () => syncMailAccount(a))}
                >
                  {t('sources.sync')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (
                      !(await confirmDialog({
                        title: t('sources.disconnectTitle'),
                        body: t('sources.disconnectBody', { name: a.email }),
                        danger: true,
                      }))
                    )
                      return;
                    await attempt(async () => {
                      if (a.provider === 'imap') await disconnectImap(a);
                      if (a.provider === 'outlook') await signOutMicrosoft(a.email);
                      if (a.provider === 'gmail') revokeGoogle();
                      await purgeAccountData(a);
                    }, t('sources.disconnected'));
                  }}
                >
                  {t('sources.disconnect')}
                </Button>
              </li>
            ))}
            {socials.map((a) => (
              <li key={a.id} class="ledger-row">
                <span>
                  <strong>{a.handle}</strong> <small class="muted">{t(`provider.${a.provider}`)}</small>
                </span>
                <Badge tone={a.status === 'connected' ? 'good' : 'warn'}>
                  {t(`sources.status.${a.status}`)}
                </Badge>
                <span class="muted small">
                  {a.lastSyncAt ? fmtRelative(a.lastSyncAt, clock.value) : t('sources.neverSynced')}
                </span>
                <Button
                  size="sm"
                  icon="refresh"
                  loading={busy === a.id}
                  onClick={() =>
                    void run(a.id, () =>
                      a.provider === 'youtube'
                        ? syncYouTube()
                        : syncSocial(a.provider as 'linkedin' | 'x' | 'tiktok'),
                    )
                  }
                >
                  {t('sources.sync')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (
                      !(await confirmDialog({
                        title: t('sources.disconnectTitle'),
                        body: t('sources.disconnectBody', { name: a.handle }),
                        danger: true,
                      }))
                    )
                      return;
                    await attempt(async () => {
                      await disconnectSocial(a.provider);
                      await purgeSocial(a);
                    }, t('sources.disconnected'));
                  }}
                >
                  {t('sources.disconnect')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted">{t('sources.none')}</p>
        )}
      </Card>

      <div class="grid grid-2">
        <Card title={t('sources.mailTitle')}>
          <ul class="source-list">
            <li>
              <span>
                <strong>Gmail</strong>
                <small class="muted">{t('sources.gmailScope')}</small>
              </span>
              <StatusBadge s={gmailS} />
              <Button
                size="sm"
                loading={busy === 'gmail'}
                disabled={gmailS === 'notConfigured'}
                onClick={act(
                  gmailS,
                  () =>
                    void run(
                      'gmail',
                      async () => syncMailAccount(await connectGmail()),
                      t('sources.connected'),
                    ),
                )}
              >
                {t('sources.connect')}
              </Button>
            </li>
            <li>
              <span>
                <strong>Outlook / Microsoft 365</strong>
                <small class="muted">{t('sources.outlookScope')}</small>
              </span>
              <StatusBadge s={outlookS} />
              <Button
                size="sm"
                loading={busy === 'outlook'}
                disabled={outlookS === 'notConfigured'}
                onClick={act(
                  outlookS,
                  () =>
                    void run(
                      'outlook',
                      async () => syncMailAccount(await connectOutlook()),
                      t('sources.connected'),
                    ),
                )}
              >
                {t('sources.connect')}
              </Button>
            </li>
            <li>
              <span>
                <strong>Yahoo · GMX · iCloud · IMAP</strong>
                <small class="muted">{t('sources.imapScope')}</small>
              </span>
              <StatusBadge s={imapS} />
              <Button
                size="sm"
                disabled={imapS === 'notConfigured'}
                onClick={act(imapS, () => setImapOpen(true))}
              >
                {t('sources.connect')}
              </Button>
            </li>
          </ul>
        </Card>

        <Card title={t('sources.calendarTitle')}>
          <ul class="source-list">
            <li>
              <span>
                <strong>Google Agenda</strong>
                <small class="muted">{t('sources.readOnly')}</small>
              </span>
              <StatusBadge
                s={!googleAvailable() ? 'notConfigured' : can('calendarSync', ent) ? 'ready' : 'needsPro'}
              />
              <Button
                size="sm"
                loading={busy === 'gcal'}
                disabled={!googleAvailable()}
                onClick={act(
                  !can('calendarSync', ent) ? 'needsPro' : 'ready',
                  () => void run('gcal', syncGoogleCalendar, t('sources.connected')),
                )}
              >
                {t('sources.sync')}
              </Button>
            </li>
            <li>
              <span>
                <strong>Outlook Calendar</strong>
                <small class="muted">{t('sources.readOnly')}</small>
              </span>
              <StatusBadge
                s={!microsoftAvailable() ? 'notConfigured' : can('calendarSync', ent) ? 'ready' : 'needsPro'}
              />
              <Button
                size="sm"
                loading={busy === 'mcal'}
                disabled={!microsoftAvailable()}
                onClick={act(
                  !can('calendarSync', ent) ? 'needsPro' : 'ready',
                  () => void run('mcal', () => syncOutlookCalendar(), t('sources.connected')),
                )}
              >
                {t('sources.sync')}
              </Button>
            </li>
            <li>
              <span>
                <strong>iCalendar (.ics)</strong>
                <small class="muted">{t('sources.icsScope')}</small>
              </span>
              <StatusBadge s="ready" />
              <Button size="sm" onClick={() => navigate('calendar')}>
                {t('sources.open')}
              </Button>
            </li>
          </ul>
        </Card>

        <Card title={t('sources.socialTitle')}>
          <ul class="source-list">
            <li>
              <span>
                <strong>YouTube</strong>
                <small class="muted">{t('sources.youtubeScope')}</small>
              </span>
              <StatusBadge
                s={!googleAvailable() ? 'notConfigured' : can('social', ent) ? 'ready' : 'needsPro'}
              />
              <Button
                size="sm"
                loading={busy === 'yt'}
                disabled={!googleAvailable()}
                onClick={act(
                  can('social', ent) ? 'ready' : 'needsPro',
                  () => void run('yt', syncYouTube, t('sources.connected')),
                )}
              >
                {t('sources.connect')}
              </Button>
            </li>
            {(['linkedin', 'x', 'tiktok', 'meta'] as const).map((p) => {
              const s = socialStatus(p);
              return (
                <li key={p}>
                  <span>
                    <strong>{t(`provider.${p}`)}</strong>
                    <small class="muted">{t(`sources.scope.${p}`)}</small>
                  </span>
                  <StatusBadge s={s} />
                  <Button
                    size="sm"
                    disabled={s === 'notConfigured' || s === 'approval'}
                    onClick={act(
                      s,
                      () => void run(p, () => startSocialAuth(p as 'linkedin' | 'x' | 'tiktok' | 'meta')),
                    )}
                  >
                    {t('sources.connect')}
                  </Button>
                </li>
              );
            })}
          </ul>
          <p class="small muted">{t('social.honesty')}</p>
        </Card>

        <Card title={t('sources.otherTitle')}>
          <ul class="source-list">
            <li>
              <span>
                <strong>{t('sources.health')}</strong>
                <small class="muted">{t('sources.healthScope')}</small>
              </span>
              <Button size="sm" onClick={() => navigate('health')}>
                {t('sources.open')}
              </Button>
            </li>
            <li>
              <span>
                <strong>{t('sources.backup')}</strong>
                <small class="muted">{t('sources.backupScope')}</small>
              </span>
              <Button size="sm" onClick={() => navigate('account', 'data')}>
                {t('sources.open')}
              </Button>
            </li>
          </ul>
        </Card>
      </div>

      <Contacts />
      <p class="small muted">{t('sources.principles')}</p>
      <ImapDialog open={imapOpen} onClose={() => setImapOpen(false)} />
    </div>
  );
}
