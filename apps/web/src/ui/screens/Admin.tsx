import { useState } from 'preact/hooks';
import type { EditionKey } from '../../domain/types';
import { COLLECTIONS } from '../../domain/types';
import { authUser, settings, snapshot } from '../../data/store';
import { seedDemo, clearDemo } from '../../data/seed';
import { EDITION_KEYS } from '../../domain/editions';
import { APP_VERSION, config, cloudConfigured } from '../../config';
import { call } from '../../services/firebase';
import { t } from '../../i18n';
import { Badge, Button, Card, Field, PageHeader, attempt, toast } from '../components';

interface Check {
  id: string;
  ok: boolean;
  blocking: boolean;
  detail?: string;
}

export function clientChecks(): Check[] {
  const https =
    location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return [
    { id: 'https', ok: https, blocking: true },
    { id: 'serviceWorker', ok: 'serviceWorker' in navigator, blocking: false },
    { id: 'indexedDb', ok: 'indexedDB' in window, blocking: true },
    { id: 'firebase', ok: cloudConfigured(), blocking: true },
    { id: 'appCheck', ok: Boolean(config.appCheckSiteKey), blocking: true },
    { id: 'googleClient', ok: Boolean(config.google.clientId), blocking: false },
    { id: 'microsoftClient', ok: Boolean(config.microsoft.clientId), blocking: false },
    {
      id: 'checkout',
      ok: Boolean(config.payments.monthlyCheckoutUrl && config.payments.annualCheckoutUrl),
      blocking: true,
    },
    { id: 'paymentLive', ok: config.payments.mode === 'live', blocking: true },
    { id: 'legalEntity', ok: Boolean(config.legal.entity && config.legal.address), blocking: true },
    { id: 'supportEmail', ok: Boolean(config.legal.supportEmail), blocking: true },
    { id: 'emulatorsOff', ok: !config.useEmulators, blocking: true },
  ];
}

export function Admin() {
  const [server, setServer] = useState<Record<string, boolean | number | string> | null>(null);
  const [email, setEmail] = useState('');
  const [edition, setEdition] = useState<EditionKey>('solo');
  const [busy, setBusy] = useState('');
  if (!authUser.value?.isAdmin) return <p class="page muted">{t('admin.forbidden')}</p>;
  const checks = clientChecks();
  const blocking = checks.filter((c) => c.blocking && !c.ok);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    await attempt(fn, ok);
    setBusy('');
  };

  const report = () => {
    const data = {
      generatedAt: new Date().toISOString(),
      version: APP_VERSION,
      userAgent: navigator.userAgent,
      clientChecks: checks,
      serverChecks: server,
      localCounts: Object.fromEntries(COLLECTIONS.map((c) => [c, snapshot.value[c].length])),
      edition: settings.value.edition,
      locale: settings.value.locale,
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `sigma-qa-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div class="page">
      <PageHeader
        title={t('nav.admin')}
        subtitle={t('admin.subtitle')}
        actions={
          <Button icon="download" onClick={report}>
            {t('admin.report')}
          </Button>
        }
      />

      <Card title={t('admin.readiness')}>
        <p>
          {blocking.length ? (
            <Badge tone="bad">{t('admin.blocked', { count: blocking.length })}</Badge>
          ) : (
            <Badge tone="good">{t('admin.ready')}</Badge>
          )}
        </p>
        <ul class="plain-list">
          {checks.map((c) => (
            <li key={c.id} class="ledger-row">
              <span>{t(`admin.check.${c.id}`)}</span>
              <Badge tone={c.ok ? 'good' : c.blocking ? 'bad' : 'warn'}>
                {c.ok ? 'OK' : c.blocking ? t('admin.blocking') : t('admin.optional')}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      {config.functionsEnabled && (
      <Card title={t('admin.server')}>
        <Button
          icon="refresh"
          loading={busy === 'diag'}
          onClick={() =>
            void run('diag', async () =>
              setServer(
                await call<Record<string, never>, Record<string, boolean | number | string>>(
                  'adminDiagnostics',
                  {},
                ),
              ),
            )
          }
        >
          {t('admin.runServer')}
        </Button>
        {server && (
          <ul class="plain-list">
            {Object.entries(server).map(([k, v]) => (
              <li key={k} class="ledger-row">
                <span>{k}</span>
                {typeof v === 'boolean' ? (
                  <Badge tone={v ? 'good' : 'bad'}>{v ? 'OK' : '✗'}</Badge>
                ) : (
                  <strong>{String(v)}</strong>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      )}

      <Card title={t('admin.scenarios')}>
        <p class="small muted">{t('admin.scenariosHint')}</p>
        <div class="inline-form">
          <select
            aria-label={t('account.edition')}
            value={edition}
            onChange={(e) => setEdition((e.currentTarget as HTMLSelectElement).value as EditionKey)}
          >
            {EDITION_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <Button
            loading={busy === 'seed'}
            onClick={() =>
              void run('seed', () => seedDemo(edition, settings.value.locale), t('admin.seeded'))
            }
          >
            {t('admin.seed')}
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              void run('clear', async () => toast(t('admin.cleared', { count: await clearDemo() }), 'good'))
            }
          >
            {t('today.clearDemo')}
          </Button>
        </div>
      </Card>

      {config.functionsEnabled && (
      <Card title={t('admin.grant')}>
        <p class="small muted">{t('admin.grantHint')}</p>
        <form
          class="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              'grant',
              () => call('adminSetEntitlement', { email: email.trim(), plan: 'pro' }),
              t('admin.granted'),
            );
          }}
        >
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
          <Button type="submit" loading={busy === 'grant'}>
            {t('admin.grantPro')}
          </Button>
          <Button
            variant="ghost"
            loading={busy === 'revoke'}
            onClick={() =>
              void run(
                'revoke',
                () => call('adminSetEntitlement', { email: email.trim(), plan: 'free' }),
                t('admin.revoked'),
              )
            }
          >
            {t('admin.revoke')}
          </Button>
        </form>
      </Card>
      )}
    </div>
  );
}
