import { useEffect, useState } from 'preact/hooks';
import { FounderCard } from '../pro';
import { setTelemetry, track } from '../../services/telemetry';
import type { Currency, EditionKey, Locale, Settings } from '../../domain/types';
import { COLLECTIONS, LOCAL_ONLY_COLLECTIONS } from '../../domain/types';
import {
  authUser,
  entitlement,
  eraseDevice,
  settings,
  snapshot,
  syncState,
  updateSettings,
  importDocs,
} from '../../data/store';
import { isPro, can } from '../../domain/entitlements';
import { listEditions } from '../../domain/editions';
import { createBackup, parseBackup, mergeRecords, BackupError } from '../../domain/backup';
import { APP_VERSION, cloudConfigured, config, isNative } from '../../config';
import {
  signInWithEmail,
  signInWithGoogle,
  signInWithMicrosoft,
  signOut,
  sendPasswordReset,
  deleteCloudAccount,
  exportCloudData,
} from '../../services/auth';
import { flush } from '../../services/sync';
import { checkoutConfigured, checkoutUrl } from '../../services/payments';
import { driveBackup, driveRestore, googleAvailable } from '../../services/connectors/google';
import { requestNotificationPermission } from '../../services/reminders';
import { t, fmtDate, fmtRelative } from '../../i18n';
import { Badge, Button, Card, Field, PageHeader, Toggle, attempt, confirmDialog, toast } from '../components';
import { route } from '../router';

function download(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Profile() {
  const s = settings.value;
  const [name, setName] = useState(s.name);
  const set = (patch: Partial<Settings>) => void updateSettings(patch);
  return (
    <Card title={t('account.profile')} id="profile">
      <div class="row">
        <Field label={t('onboarding.name')}>
          {(id) => (
            <input
              id={id}
              maxLength={60}
              value={name}
              onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
              onBlur={() => name !== s.name && set({ name: name.trim() })}
            />
          )}
        </Field>
        <Field label={t('settings.language')}>
          {(id) => (
            <select
              id={id}
              value={s.locale}
              onChange={(e) => set({ locale: (e.currentTarget as HTMLSelectElement).value as Locale })}
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
              <option value="de">Deutsch</option>
              <option value="es">Español</option>
            </select>
          )}
        </Field>
        <Field label={t('settings.currency')}>
          {(id) => (
            <select
              id={id}
              value={s.currency}
              onChange={(e) => set({ currency: (e.currentTarget as HTMLSelectElement).value as Currency })}
            >
              {['EUR', 'USD', 'GBP', 'CHF', 'CAD'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('settings.theme')}>
          {(id) => (
            <select
              id={id}
              value={s.theme}
              onChange={(e) =>
                set({ theme: (e.currentTarget as HTMLSelectElement).value as Settings['theme'] })
              }
            >
              {(['system', 'light', 'dark'] as const).map((x) => (
                <option key={x} value={x}>
                  {t(`settings.themeValue.${x}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <p class="label">{t('account.edition')}</p>
      <div class="edition-grid compact" role="radiogroup" aria-label={t('account.edition')}>
        {listEditions(s.locale).map((ed) => (
          <button
            key={ed.key}
            type="button"
            role="radio"
            aria-checked={s.edition === ed.key}
            class={`edition-card ${s.edition === ed.key ? 'selected' : ''}`}
            style={{ '--edition-accent': ed.accent } as never}
            onClick={() => set({ edition: ed.key as EditionKey })}
          >
            <span class="edition-icon" aria-hidden="true">
              {ed.icon}
            </span>
            <strong>{ed.name}</strong>
          </button>
        ))}
      </div>
      <p class="small muted">{t('account.editionHint')}</p>
      <Toggle
        label={t('account.notifications')}
        hint={t('account.notificationsHint')}
        checked={s.notifications}
        onChange={async (v) => {
          if (v && !(await requestNotificationPermission()))
            return toast(t('account.notificationsDenied'), 'bad');
          set({ notifications: v });
        }}
      />
    </Card>
  );
}

function Plan() {
  const ent = entitlement.value;
  const pro = isPro(ent);
  const user = authUser.value;
  const go = (billing: 'monthly' | 'annual') => {
    const url = checkoutUrl(billing);
    if (!url) return;
    void track('checkout_started', { from: 'account' });
    location.assign(url);
  };
  return (
    <Card title={t('account.plan')} id="plan">
      <div class="plan-head">
        <Badge tone={pro ? 'good' : 'neutral'}>{pro ? t('plan.pro') : t('plan.free')}</Badge>
        {pro && ent.status !== 'active' && <span class="muted small">{t(`plan.sub.${ent.status}`)}</span>}
        {ent.validUntil && (
          <span class="muted small">{t('plan.validUntil', { date: fmtDate(ent.validUntil) })}</span>
        )}
      </div>
      <FounderCard />
      {!pro && (
        <>
          <ul class="plan-features">
            {(
              [
                'finance',
                'health',
                'household',
                'cloudSync',
                'social',
                'calendarSync',
                'unlimitedCoach',
              ] as const
            ).map((f) => (
              <li key={f}>✓ {t(`pro.feature.${f}`)}</li>
            ))}
          </ul>
          {!cloudConfigured() || !checkoutConfigured() ? (
            <p class="muted small">{t('plan.notAvailable')}</p>
          ) : !user ? (
            <p class="notice small">{t('plan.signInFirst')}</p>
          ) : (
            <div class="row-actions">
              <Button variant="primary" onClick={() => go('monthly')}>
                {t('plan.monthly', { price: config.payments.monthlyPrice })}
              </Button>
              <Button onClick={() => go('annual')}>
                {t('plan.annual', { price: config.payments.annualPrice })}
              </Button>
            </div>
          )}
          {config.payments.mode === 'test' && checkoutConfigured() && (
            <p class="small warn-text">{t('plan.testMode')}</p>
          )}
        </>
      )}
      {pro && ent.customerPortalUrl && (
        <a
          class="btn btn-secondary btn-md"
          href={ent.customerPortalUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('plan.manage')}
        </a>
      )}
      <p class="small muted">{t('plan.legal')}</p>
    </Card>
  );
}

function CloudAccount() {
  const user = authUser.value;
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  if (!cloudConfigured()) {
    return (
      <Card title={t('account.cloud')} id="cloud">
        <p class="muted">{t('account.cloudNotConfigured')}</p>
      </Card>
    );
  }
  if (user) {
    return (
      <Card title={t('account.cloud')} id="cloud">
        <p>
          {t('account.signedInAs')} <strong>{user.email ?? user.displayName}</strong>{' '}
          {user.isAdmin && <Badge tone="accent">admin</Badge>}
        </p>
        <Button onClick={() => void attempt(signOut, t('account.signedOut'))}>{t('account.signOut')}</Button>
      </Card>
    );
  }
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    await attempt(
      () => signInWithEmail(email.trim(), password, mode),
      mode === 'signup' ? t('account.verifyEmail') : t('account.signedIn'),
    );
    setPassword('');
    setBusy(false);
  };
  return (
    <Card title={t('account.cloud')} id="cloud">
      <p class="small muted">{t('account.cloudWhy')}</p>
      {isNative() ? (
        <p class="small muted">{t('native.signInEmail')}</p>
      ) : (
        <div class="row-actions">
          <Button icon="user" onClick={() => void attempt(signInWithGoogle, t('account.signedIn'))}>
            {t('account.withGoogle')}
          </Button>
          <Button icon="user" onClick={() => void attempt(signInWithMicrosoft, t('account.signedIn'))}>
            {t('account.withMicrosoft')}
          </Button>
        </div>
      )}
      <form class="form" onSubmit={submit}>
        <div class="row">
          <Field label={t('sources.email')}>
            {(id) => (
              <input
                id={id}
                type="email"
                required
                autoComplete="email"
                value={email}
                onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)}
              />
            )}
          </Field>
          <Field
            label={t('account.password')}
            hint={mode === 'signup' ? t('account.passwordHint') : undefined}
          >
            {(id) => (
              <input
                id={id}
                type="password"
                required
                minLength={mode === 'signup' ? 10 : 1}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)}
              />
            )}
          </Field>
        </div>
        <div class="row-actions">
          <Button type="submit" variant="primary" loading={busy}>
            {mode === 'signin' ? t('account.signIn') : t('account.signUp')}
          </Button>
          <button type="button" class="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? t('account.needAccount') : t('account.haveAccount')}
          </button>
          {mode === 'signin' && (
            <button
              type="button"
              class="link"
              disabled={!email}
              onClick={() => void attempt(() => sendPasswordReset(email.trim()), t('account.resetSent'))}
            >
              {t('account.forgot')}
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}

function Sync() {
  const s = settings.value;
  const sync = syncState.value;
  const user = authUser.value;
  const allowed = can('cloudSync', entitlement.value);
  if (!cloudConfigured()) return null;
  return (
    <Card title={t('account.sync')} id="sync">
      <Toggle
        label={t('account.syncToggle')}
        hint={!user ? t('plan.signInFirst') : !allowed ? t('pro.gateBody') : t('account.syncHint')}
        disabled={!user || !allowed}
        checked={Boolean(s.consent.cloudSync) && allowed}
        onChange={(v) =>
          void updateSettings({ consent: { ...s.consent, cloudSync: v ? new Date().toISOString() : null } })
        }
      />
      <p class="small">
        {t(`sync.${sync.status}`)}
        {sync.lastSyncAt && ` · ${t('account.lastSync', { when: fmtRelative(sync.lastSyncAt) })}`}
        {sync.error && <span class="bad-text"> · {sync.error}</span>}
      </p>
      {s.consent.cloudSync && user && allowed && (
        <Button size="sm" icon="refresh" onClick={() => void attempt(flush, t('account.synced'))}>
          {t('account.syncNow')}
        </Button>
      )}
      <p class="small muted">{s.consent.health ? t('account.syncHealthOn') : t('account.syncHealthOff')}</p>
      <p class="small muted">{t('account.syncLocalOnly')}</p>
    </Card>
  );
}

function Ai() {
  return (
    <Card title={t('account.ai')} id="ai">
      <p class="small muted">{t('account.aiPrinciple')}</p>
      <a class="btn btn-secondary btn-md" href="#intelligence">
        {t('ai.open')}
      </a>
    </Card>
  );
}

function Data() {
  const s = settings.value;
  const user = authUser.value;
  const [busy, setBusy] = useState('');
  const counts = COLLECTIONS.map(
    (c) => [c, snapshot.value[c].filter((d) => !d.deletedAt).length] as const,
  ).filter(([, n]) => n > 0);

  const exportJson = () =>
    download(
      `sigma-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(createBackup(s, snapshot.value, APP_VERSION), null, 2),
    );

  const importJson = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) return toast(t('error.fileTooLarge'), 'bad');
    let backup;
    try {
      backup = parseBackup(await file.text());
    } catch (err) {
      return toast(t(`backup.error.${err instanceof BackupError ? err.code : 'invalid-json'}`), 'bad');
    }
    const replace = await confirmDialog({
      title: t('backup.importTitle'),
      body: t('backup.importBody', { date: fmtDate(backup.exportedAt) }),
      confirmLabel: t('backup.merge'),
    });
    if (!replace) return;
    for (const c of COLLECTIONS) {
      const rows = backup.collections[c];
      if (!rows?.length) continue;
      const { changed } = mergeRecords(snapshot.value[c] as never[], rows as never[]);
      if (changed.length) await importDocs(c, changed as never);
    }
    await updateSettings({ ...backup.settings, onboardingComplete: true });
    toast(t('backup.imported'), 'good');
  };

  const driveSave = () =>
    run(
      'drive',
      () => driveBackup(JSON.stringify(createBackup(s, snapshot.value, APP_VERSION))),
      t('backup.driveSaved'),
    );
  const driveLoad = () =>
    run('drive', async () => {
      const text = await driveRestore();
      if (!text) return toast(t('backup.driveEmpty'), 'info');
      await importJson(new File([text], 'drive.json', { type: 'application/json' }));
    });

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    await attempt(fn, ok);
    setBusy('');
  };

  const erase = async () => {
    if (
      !(await confirmDialog({
        title: t('data.eraseTitle'),
        body: t('data.eraseBody'),
        confirmLabel: t('data.eraseConfirm'),
        danger: true,
      }))
    )
      return;
    await eraseDevice();
    location.hash = '#today';
    location.reload();
  };

  const deleteAccount = async () => {
    if (
      !(await confirmDialog({
        title: t('data.deleteAccountTitle'),
        body: t('data.deleteAccountBody'),
        confirmLabel: t('data.deleteAccountConfirm'),
        danger: true,
      }))
    )
      return;
    await run('delete', async () => {
      await deleteCloudAccount();
      await eraseDevice();
      location.hash = '#today';
      location.reload();
    });
  };

  return (
    <Card title={t('account.data')} id="data">
      <Toggle
        label={t('telemetry.toggle')}
        hint={t('telemetry.hint')}
        checked={Boolean(settings.value.usage.telemetry)}
        onChange={(v) => void setTelemetry(v)}
      />
      <p class="small muted">
        {t('data.summary', {
          list: counts.map(([c, n]) => `${t(`collection.${c}`)} ${n}`).join(' · ') || '—',
        })}
      </p>
      <div class="row-actions">
        <Button icon="download" onClick={exportJson}>
          {t('data.export')}
        </Button>
        <label class="btn btn-secondary btn-md file-btn">
          <input
            type="file"
            accept="application/json,.json"
            class="sr-only"
            onChange={(e) => {
              const f = (e.currentTarget as HTMLInputElement).files?.[0];
              (e.currentTarget as HTMLInputElement).value = '';
              if (f) void attempt(() => importJson(f));
            }}
          />
          <span>{t('data.import')}</span>
        </label>
        {googleAvailable() && can('driveBackup', entitlement.value) && (
          <>
            <Button icon="upload" loading={busy === 'drive'} onClick={() => void driveSave()}>
              {t('data.driveSave')}
            </Button>
            <Button variant="ghost" loading={busy === 'drive'} onClick={() => void driveLoad()}>
              {t('data.driveRestore')}
            </Button>
          </>
        )}
        {user && (
          <Button
            variant="ghost"
            icon="download"
            loading={busy === 'cloudExport'}
            onClick={() =>
              void run('cloudExport', async () =>
                download(
                  `sigma-cloud-export-${new Date().toISOString().slice(0, 10)}.json`,
                  JSON.stringify(await exportCloudData(), null, 2),
                ),
              )
            }
          >
            {t('data.cloudExport')}
          </Button>
        )}
      </div>
      <p class="small muted">
        {t('data.localOnly', {
          list: [...LOCAL_ONLY_COLLECTIONS].map((c) => t(`collection.${c}`)).join(', '),
        })}
      </p>
      <hr />
      <div class="danger-zone">
        <Button variant="danger" onClick={() => void erase()}>
          {t('data.erase')}
        </Button>
        {user && (
          <Button variant="danger" loading={busy === 'delete'} onClick={() => void deleteAccount()}>
            {t('data.deleteAccount')}
          </Button>
        )}
      </div>
    </Card>
  );
}

export function Account() {
  useEffect(() => {
    const p = route.value.param;
    if (p)
      setTimeout(
        () => document.getElementById(p)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        50,
      );
  }, [route.value.param]);
  return (
    <div class="page">
      <PageHeader title={t('nav.account')} subtitle={t('account.subtitle')} />
      <Profile />
      <Plan />
      <CloudAccount />
      <Sync />
      <Ai />
      <Data />
      <Card title={t('account.about')}>
        <p class="small muted">
          Σ Life OS {APP_VERSION} ·{' '}
          <a href="legal/privacy.html" target="_blank" rel="noopener">
            {t('legal.privacy')}
          </a>{' '}
          ·{' '}
          <a href="legal/terms.html" target="_blank" rel="noopener">
            {t('legal.terms')}
          </a>{' '}
          ·{' '}
          <a href="legal/support.html" target="_blank" rel="noopener">
            {t('legal.support')}
          </a>
        </p>
      </Card>
    </div>
  );
}
