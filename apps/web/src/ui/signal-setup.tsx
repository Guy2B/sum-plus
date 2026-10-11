/**
 * Guided signal setup: three plain-language cards (calendar, mail, notes), one
 * button per provider, what NEXT reads and never does. Used in the first-run
 * onboarding, at the top of Sources, and as a checklist on Today until done.
 */
import { useState } from 'preact/hooks';
import { authUser, settings, snapshot, updateSettings } from '../data/store';
import { connectedCalendars } from '../services/autosync';
import { connectGmail, googleAvailable, syncGoogleCalendar } from '../services/connectors/google';
import { connectOutlook, microsoftAvailable, syncOutlookCalendar } from '../services/connectors/microsoft';
import type { ImapPreset } from '../services/connectors/remote';
import { connectorServerAvailable } from '../config';
import { t } from '../i18n';
import { Button, attempt, toast } from './components';
import { navigate } from './router';
import { syncMailAccount } from './screens/Mail';
import { ImapDialog } from './imap-dialog';
import { NotesImport, shareSupported } from './notes-import';

export type SignalKey = 'calendar' | 'mail' | 'notes';
export const SIGNALS: SignalKey[] = ['calendar', 'mail', 'notes'];

export function signalStatus(): Record<SignalKey, boolean> {
  const snap = snapshot.value;
  return {
    calendar:
      connectedCalendars().length > 0 ||
      snap.events.some((e) => !e.deletedAt && e.source?.provider === 'ics'),
    mail: snap.mailAccounts.some((a) => !a.deletedAt),
    notes: Boolean(settings.value.usage.notesLinked),
  };
}

export function signalProgress(): { done: number; total: number } {
  const s = signalStatus();
  return { done: SIGNALS.filter((k) => s[k]).length, total: SIGNALS.length };
}

const MAILBOXES: ImapPreset[] = ['gmx', 'webde', 'tonline', 'yahoo', 'icloud', 'custom'];

function Step({
  n,
  k,
  done,
  open,
  onToggle,
  children,
}: {
  n: number;
  k: SignalKey;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  children: preact.ComponentChildren;
}) {
  return (
    <li class={`signal-step ${done ? 'done' : ''} ${open ? 'open' : ''}`}>
      <button type="button" class="signal-head" aria-expanded={open} onClick={onToggle}>
        <span class="signal-num" aria-hidden="true">
          {done ? '✓' : n}
        </span>
        <span class="signal-title">
          <strong>{t(`signals.${k}.title`)}</strong>
          <small class="muted">{done ? t('signals.connected') : t(`signals.${k}.why`)}</small>
        </span>
      </button>
      {open && <div class="signal-body">{children}</div>}
    </li>
  );
}

/** Reads / never-does line, always visible before the person clicks. */
function ReadsNever({ k }: { k: SignalKey }) {
  return (
    <p class="signal-promise small">
      <span>
        <b>{t('signals.reads')}</b> {t(`signals.${k}.reads`)}
      </span>
      <span>
        <b>{t('signals.never')}</b> {t(`signals.${k}.never`)}
      </span>
    </p>
  );
}

export function SignalSetup({ compact = false }: { compact?: boolean }) {
  const status = signalStatus();
  const firstOpen = SIGNALS.find((k) => !status[k]) ?? null;
  const [open, setOpen] = useState<SignalKey | null>(firstOpen);
  const [busy, setBusy] = useState('');
  const [imap, setImap] = useState<ImapPreset | null>(null);
  const [icsHelp, setIcsHelp] = useState(false);
  const signedIn = Boolean(authUser.value);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    await attempt(fn);
    setBusy('');
  };
  const toggle = (k: SignalKey) => setOpen(open === k ? null : k);
  const next = (k: SignalKey) => {
    const after = SIGNALS.slice(SIGNALS.indexOf(k) + 1).find((x) => !signalStatus()[x]);
    setOpen(after ?? null);
  };

  return (
    <div class={`signal-setup ${compact ? 'compact' : ''}`}>
      <ol class="signal-steps">
        <Step
          n={1}
          k="calendar"
          done={status.calendar}
          open={open === 'calendar'}
          onToggle={() => toggle('calendar')}
        >
          <ReadsNever k="calendar" />
          <div class="signal-choices">
            <Button
              icon="calendar"
              loading={busy === 'gcal'}
              disabled={!googleAvailable()}
              onClick={() =>
                void run('gcal', async () => {
                  const r = await syncGoogleCalendar();
                  toast(t('onboarding.calendarConnected', { count: r.added + r.updated }), 'good');
                  next('calendar');
                })
              }
            >
              Google
            </Button>
            <Button
              icon="calendar"
              loading={busy === 'mcal'}
              disabled={!microsoftAvailable()}
              onClick={() =>
                void run('mcal', async () => {
                  const r = await syncOutlookCalendar();
                  toast(t('onboarding.calendarConnected', { count: r.added + r.updated }), 'good');
                  next('calendar');
                })
              }
            >
              Outlook
            </Button>
            <Button icon="calendar" onClick={() => setIcsHelp(!icsHelp)} aria-expanded={icsHelp}>
              {t('signals.calendar.other')}
            </Button>
          </div>
          {icsHelp && (
            <div class="signal-help">
              <ol>
                <li>{t('signals.calendar.ics1')}</li>
                <li>{t('signals.calendar.ics2')}</li>
                <li>{t('signals.calendar.ics3')}</li>
              </ol>
              <Button size="sm" onClick={() => navigate('calendar')}>
                {t('signals.calendar.icsOpen')}
              </Button>
            </div>
          )}
          <p class="small muted">{t('signals.calendar.tip')}</p>
        </Step>

        <Step n={2} k="mail" done={status.mail} open={open === 'mail'} onToggle={() => toggle('mail')}>
          <ReadsNever k="mail" />
          <div class="signal-choices">
            <Button
              icon="mail"
              loading={busy === 'gmail'}
              disabled={!googleAvailable()}
              onClick={() =>
                void run('gmail', async () => {
                  await syncMailAccount(await connectGmail());
                  toast(t('sources.connected'), 'good');
                  next('mail');
                })
              }
            >
              Gmail
            </Button>
            <Button
              icon="mail"
              loading={busy === 'outlook'}
              disabled={!microsoftAvailable()}
              onClick={() =>
                void run('outlook', async () => {
                  await syncMailAccount(await connectOutlook());
                  toast(t('sources.connected'), 'good');
                  next('mail');
                })
              }
            >
              Outlook · Hotmail
            </Button>
          </div>
          <p class="small label">{t('signals.mail.others')}</p>
          <div class="signal-choices">
            {MAILBOXES.map((p) => (
              <Button
                key={p}
                size="sm"
                variant="ghost"
                disabled={!connectorServerAvailable()}
                onClick={() => (signedIn ? setImap(p) : navigate('account'))}
              >
                {t(`provider.imap.${p}`)}
              </Button>
            ))}
          </div>
          {!signedIn && <p class="small muted">{t('signals.mail.needsAccount')}</p>}
        </Step>

        <Step n={3} k="notes" done={status.notes} open={open === 'notes'} onToggle={() => toggle('notes')}>
          <ReadsNever k="notes" />
          <div class="signal-help">
            <p>
              <b>{t('signals.notes.shareTitle')}</b>
            </p>
            <ol>
              <li>{t(shareSupported() ? 'signals.notes.share1' : 'signals.notes.share1Install')}</li>
              <li>{t('signals.notes.share2')}</li>
              <li>{t('signals.notes.share3')}</li>
            </ol>
          </div>
          <NotesImport onDone={() => next('notes')} />
          <p class="small muted">{t('signals.notes.honest')}</p>
        </Step>
      </ol>
      {!compact && <p class="small muted">{t('signals.footer')}</p>}
      <ImapDialog
        open={imap !== null}
        initial={imap ?? 'gmx'}
        onClose={() => setImap(null)}
        onConnected={() => next('mail')}
      />
    </div>
  );
}

/** Today: compact checklist until every signal is connected or the person hides it. */
export function SignalChecklist() {
  const s = settings.value;
  const { done, total } = signalProgress();
  if (done >= total || s.usage.signalsHidden) return null;
  const status = signalStatus();
  return (
    <section class="card signal-checklist" aria-labelledby="signal-checklist-title">
      <div class="card-head">
        <h2 id="signal-checklist-title">{t('signals.checklistTitle', { done, total })}</h2>
        <button
          type="button"
          class="link small muted"
          onClick={() =>
            void updateSettings((cur) => ({ ...cur, usage: { ...cur.usage, signalsHidden: true } }))
          }
        >
          {t('signals.hide')}
        </button>
      </div>
      <p class="small muted">{t('signals.checklistBody')}</p>
      <ul class="signal-mini">
        {SIGNALS.map((k) => (
          <li key={k} class={status[k] ? 'done' : ''}>
            <span aria-hidden="true">{status[k] ? '✓' : '○'}</span> {t(`signals.${k}.title`)}
          </li>
        ))}
      </ul>
      <Button size="sm" variant="primary" onClick={() => navigate('sources')}>
        {t('signals.continue')}
      </Button>
    </section>
  );
}
