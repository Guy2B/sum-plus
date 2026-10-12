/**
 * Guided signal setup. One click on Google or Microsoft connects everything
 * that account offers (calendar + mail); other mailboxes, Apple calendars and
 * phone notes are optional extras. "Finish setup" ends it for good. Used in the
 * first-run onboarding, at the top of Sources, and as a reminder on Today.
 */
import { useState } from 'preact/hooks';
import { authUser, settings, snapshot, updateSettings } from '../data/store';
import { connectedCalendars, rememberCalendar, runAutoSync } from '../services/autosync';
import {
  connectGmail,
  googleAvailable,
  googleToken,
  syncGoogleCalendar,
} from '../services/connectors/google';
import { connectOutlook, microsoftAvailable, syncOutlookCalendar } from '../services/connectors/microsoft';
import type { ImapPreset } from '../services/connectors/remote';
import { connectorServerAvailable } from '../config';
import { t } from '../i18n';
import { Button, toast } from './components';
import { navigate } from './router';
import { syncMailAccount } from './screens/Mail';
import { ImapDialog } from './imap-dialog';
import { NotesImport, shareSupported } from './notes-import';

export interface SignalStatus {
  calendar: boolean;
  mail: boolean;
  notes: boolean;
  /** A calendar or a mailbox is connected: the essentials are there. */
  main: boolean;
}

export function signalStatus(): SignalStatus {
  const snap = snapshot.value;
  const calendar =
    connectedCalendars().length > 0 || snap.events.some((e) => !e.deletedAt && e.source?.provider === 'ics');
  const mail = snap.mailAccounts.some((a) => !a.deletedAt);
  return { calendar, mail, notes: Boolean(settings.value.usage.notesLinked), main: calendar || mail };
}

/** The reminder disappears once the person finished setup or connected a main account. */
export const setupPending = () => !settings.value.usage.signalsHidden && !signalStatus().main;

export const finishSetup = () =>
  updateSettings((cur) => ({ ...cur, usage: { ...cur.usage, signalsHidden: true } }));

/** "Finish setup": the assistant goes away, Σ reads what is connected and Today shows the result. */
async function finishAndShow() {
  const connected = signalStatus().main;
  await updateSettings((cur) => ({
    ...cur,
    usage: { ...cur.usage, signalsHidden: true, firstResultPending: connected },
  }));
  navigate('today');
  if (connected) void runAutoSync(true);
}

const MAILBOXES: ImapPreset[] = ['gmx', 'webde', 'tonline', 'yahoo', 'icloud', 'custom'];

/** One Google consent for calendar + Gmail; whatever the person granted is connected. */
async function connectGoogle(): Promise<string[]> {
  // A single popup asking for both. If one scope is unticked, the token still covers the other.
  await googleToken(['calendar', 'gmail']).catch(() => undefined);
  const done: string[] = [];
  try {
    await syncGoogleCalendar();
    await rememberCalendar('google');
    done.push(t('signals.calendar.title'));
  } catch {
    /* calendar not granted: mail may still work */
  }
  try {
    await syncMailAccount(await connectGmail());
    done.push('Gmail');
  } catch {
    /* mail not granted */
  }
  return done;
}

/** Microsoft asks for mail, calendar and contacts in one sign-in. */
async function connectMicrosoft(): Promise<string[]> {
  const done: string[] = [];
  const account = await connectOutlook();
  try {
    await syncOutlookCalendar();
    await rememberCalendar('microsoft');
    done.push(t('signals.calendar.title'));
  } catch {
    /* calendar unavailable on this account */
  }
  try {
    await syncMailAccount(account);
    done.push('Outlook');
  } catch {
    /* mailbox unavailable */
  }
  return done;
}

function ReadsNever({ k }: { k: 'main' | 'notes' }) {
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

function Step({
  n,
  title,
  sub,
  done,
  optional,
  open,
  onToggle,
  children,
}: {
  n: number;
  title: string;
  sub: string;
  done: boolean;
  optional?: boolean;
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
          <strong>
            {title} {optional && <span class="signal-optional">{t('signals.optional')}</span>}
          </strong>
          <small class="muted">{sub}</small>
        </span>
      </button>
      {open && <div class="signal-body">{children}</div>}
    </li>
  );
}

type Card = 'main' | 'more' | 'notes';

export function SignalSetup({ compact = false, onFinish }: { compact?: boolean; onFinish?: () => void }) {
  const status = signalStatus();
  const [open, setOpen] = useState<Card | null>(status.main ? null : 'main');
  const [busy, setBusy] = useState('');
  const [imap, setImap] = useState<ImapPreset | null>(null);
  const [icsHelp, setIcsHelp] = useState(false);
  const signedIn = Boolean(authUser.value);

  const connect = async (key: string, fn: () => Promise<string[]>) => {
    setBusy(key);
    try {
      const done = await fn();
      if (done.length) {
        toast(t('signals.connectedList', { list: done.join(' + ') }), 'good');
        setOpen(null);
      } else toast(t('signals.nothingGranted'), 'bad');
    } catch {
      toast(t('signals.nothingGranted'), 'bad');
    }
    setBusy('');
  };
  const toggle = (k: Card) => setOpen(open === k ? null : k);
  const mainSub = status.main
    ? `${[status.calendar && t('signals.calendar.title'), status.mail && t('signals.mail.title')]
        .filter(Boolean)
        .join(' · ')} ✓`
    : t('signals.main.why');

  const finish = async () => {
    if (onFinish) {
      await finishSetup();
      onFinish();
    } else await finishAndShow();
  };

  return (
    <div class={`signal-setup ${compact ? 'compact' : ''}`}>
      <ol class="signal-steps">
        <Step
          n={1}
          title={t('signals.main.title')}
          sub={mainSub}
          done={status.main}
          open={open === 'main'}
          onToggle={() => toggle('main')}
        >
          <ReadsNever k="main" />
          <div class="signal-choices">
            <Button
              variant="primary"
              loading={busy === 'google'}
              disabled={!googleAvailable()}
              onClick={() => void connect('google', connectGoogle)}
            >
              {t('signals.main.google')}
            </Button>
            <Button
              loading={busy === 'microsoft'}
              disabled={!microsoftAvailable()}
              onClick={() => void connect('microsoft', connectMicrosoft)}
            >
              {t('signals.main.microsoft')}
            </Button>
          </div>
          <p class="small muted">{t('signals.main.oneClick')}</p>
        </Step>

        <Step
          n={2}
          title={t('signals.more.title')}
          sub={t('signals.more.why')}
          done={false}
          optional
          open={open === 'more'}
          onToggle={() => toggle('more')}
        >
          <p class="small label">{t('signals.mail.others')}</p>
          <div class="signal-choices">
            {MAILBOXES.map((p) => (
              <Button
                key={p}
                size="sm"
                disabled={!connectorServerAvailable()}
                onClick={() => (signedIn ? setImap(p) : navigate('account'))}
              >
                {t(`provider.imap.${p}`)}
              </Button>
            ))}
          </div>
          {!signedIn && <p class="small muted">{t('signals.mail.needsAccount')}</p>}
          <p class="small label">{t('signals.calendar.otherLabel')}</p>
          <div class="signal-choices">
            <Button size="sm" onClick={() => setIcsHelp(!icsHelp)} aria-expanded={icsHelp}>
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
              <p class="small muted">{t('signals.calendar.tip')}</p>
            </div>
          )}
        </Step>

        <Step
          n={3}
          title={t('signals.notes.title')}
          sub={status.notes ? t('signals.connected') : t('signals.notes.why')}
          done={status.notes}
          optional
          open={open === 'notes'}
          onToggle={() => toggle('notes')}
        >
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
          <NotesImport onDone={() => setOpen(null)} />
          <p class="small muted">{t('signals.notes.honest')}</p>
        </Step>
      </ol>

      {!onFinish && (
        <div class="signal-actions">
          <Button variant="ghost" onClick={() => navigate('sources', 'all')}>
            {t('signals.addMore')}
          </Button>
          <Button variant={status.main ? 'primary' : 'secondary'} onClick={() => void finish()}>
            {t('signals.finish')}
          </Button>
        </div>
      )}
      {!compact && <p class="small muted">{t('signals.footer')}</p>}
      <ImapDialog open={imap !== null} initial={imap ?? 'gmx'} onClose={() => setImap(null)} />
    </div>
  );
}

/** Today: a short reminder until a calendar or mailbox is connected, or setup is finished. */
export function SignalChecklist() {
  if (!setupPending()) return null;
  return (
    <section class="card signal-checklist" aria-labelledby="signal-checklist-title">
      <h2 id="signal-checklist-title">{t('signals.checklistTitle')}</h2>
      <p class="small muted">{t('signals.checklistBody')}</p>
      <div class="signal-actions">
        <Button size="sm" variant="primary" onClick={() => navigate('sources')}>
          {t('signals.continue')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void finishSetup()}>
          {t('signals.notNow')}
        </Button>
      </div>
    </section>
  );
}
