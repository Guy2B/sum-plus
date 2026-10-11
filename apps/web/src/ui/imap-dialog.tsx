/**
 * Mailbox by IMAP (GMX, WEB.DE, T-Online, Yahoo, iCloud, other): a numbered
 * how-to for the chosen provider, then e-mail + password. The password goes
 * once over HTTPS to the Cloud Function, is encrypted there, never kept here.
 */
import { useEffect, useState } from 'preact/hooks';
import type { MailAccount } from '../domain/types';
import { IMAP_PRESETS, connectImap, type ImapPreset } from '../services/connectors/remote';
import { t } from '../i18n';
import { Button, Field, Modal, attempt } from './components';
import { syncMailAccount } from './screens/Mail';

export function ImapDialog({
  open,
  onClose,
  initial = 'gmx',
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  initial?: ImapPreset;
  onConnected?: (a: MailAccount) => void;
}) {
  const [preset, setPreset] = useState<ImapPreset>(initial);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setPreset(initial);
  }, [open, initial]);

  const p = IMAP_PRESETS[preset];
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
      onConnected?.(account);
      void attempt(() => syncMailAccount(account));
    }
  };

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
              {(Object.keys(IMAP_PRESETS) as ImapPreset[]).map((k) => (
                <option key={k} value={k}>
                  {t(`provider.imap.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>

        {preset !== 'custom' && (
          <ol class="signal-howto small">
            <li>
              {t(p.appPassword ? 'imap.howto.appPassword1' : 'imap.howto.enable1', {
                provider: t(`provider.imap.${preset}`),
              })}{' '}
              <a class="link" href={p.help} target="_blank" rel="noopener noreferrer">
                {t('imap.howto.openHelp')}
              </a>
            </li>
            <li>{t(p.appPassword ? 'imap.howto.appPassword2' : 'imap.howto.enable2')}</li>
            <li>{t('imap.howto.last')}</li>
          </ol>
        )}

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
        <Field
          label={t(p.appPassword ? 'sources.appPassword' : 'imap.password')}
          hint={t(p.appPassword ? 'sources.appPasswordHint' : 'imap.passwordHint')}
        >
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
