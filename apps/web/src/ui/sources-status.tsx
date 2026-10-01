/**
 * Today: how fresh the data behind the three decisions is, which source needs
 * a click, and — after an automatic sync broke the plan — what changed.
 */
import { clock } from '../data/store';
import { dayChange, reconnect, sourceStates, syncing, type SourceState } from '../services/autosync';
import { t, fmtTime } from '../i18n';
import { Button } from './components';
import { navigate } from './router';

function ago(iso: string, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  return min < 1
    ? t('sources.now')
    : min < 60
      ? t('sources.minAgo', { count: min })
      : t('sources.hAgo', { count: Math.round(min / 60) });
}

function label(s: SourceState): string {
  if (s.kind === 'calendar') return t(`sources.calendar.${s.provider}`);
  return s.provider === 'imap' ? s.label : t(`sources.mail.${s.provider}`);
}

/** "Calendar 3 min ago · Gmail 12 min ago · Outlook: reconnect" */
export function Freshness() {
  const states = Object.entries(sourceStates.value);
  if (!states.length && !syncing.value) return null;
  const now = clock.value;
  return (
    <p class="small muted freshness" aria-live="polite">
      {syncing.value && <span>{t('sources.syncing')} · </span>}
      {states.map(([key, s], i) => (
        <span key={key}>
          {i > 0 && ' · '}
          {s.state === 'ok' ? (
            `${label(s)} ${ago(s.at, now)}`
          ) : (
            <button type="button" class="link warn-text" onClick={() => void reconnect(key)}>
              {label(s)} : {t(s.state === 'needs-user' ? 'sources.reconnect' : 'sources.retry')}
            </button>
          )}
        </span>
      ))}
    </p>
  );
}

/** Shown only when an automatic sync added events that push planned work out of today. */
export function DayChangeBanner() {
  const change = dayChange.value;
  if (!change) return null;
  const first = change.events[0]!;
  return (
    <aside class="day-change" role="status">
      <p>
        <strong>{t('daychange.title')}</strong>{' '}
        {change.events.length === 1
          ? t('daychange.event', {
              title: first.title,
              time: fmtTime(new Date(first.start)),
              minutes: first.minutes,
            })
          : t('daychange.events', { count: change.events.length })}{' '}
        {t('daychange.dropped', {
          count: change.dropped.length,
          items: change.dropped.slice(0, 2).join(', '),
        })}
      </p>
      <div class="row-actions">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            dayChange.value = null;
            navigate('plan');
          }}
        >
          {t('daychange.seePlan')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => (dayChange.value = null)}>
          {t('daychange.ok')}
        </Button>
      </div>
    </aside>
  );
}
