/**
 * Shown once on Today right after "Finish setup": what Σ just read from the
 * connected signals and that the three cards below are the result.
 */
import { settings, snapshot, updateSettings } from '../data/store';
import { syncing } from '../services/autosync';
import { t } from '../i18n';
import { Button } from './components';

export function firstResultCounts(now: Date = new Date()) {
  const snap = snapshot.value;
  const week = now.getTime() + 7 * 86_400_000;
  return {
    mails: snap.mailMessages.filter((m) => !m.deletedAt).length,
    events: snap.events.filter((e) => {
      if (e.deletedAt) return false;
      const start = new Date(e.start).getTime();
      return start >= now.getTime() - 86_400_000 && start <= week;
    }).length,
    tasks: snap.tasks.filter((x) => !x.deletedAt && x.status !== 'done').length,
  };
}

export function FirstResult() {
  if (!settings.value.usage.firstResultPending) return null;
  const c = firstResultCounts();
  const total = c.mails + c.events + c.tasks;
  const close = () =>
    void updateSettings((cur) => ({ ...cur, usage: { ...cur.usage, firstResultPending: false } }));
  return (
    <section class="card first-result" aria-live="polite">
      {syncing.value ? (
        <p class="first-result-line">{t('first.reading')}</p>
      ) : (
        <>
          <p class="first-result-line">
            {t('first.read', { mails: c.mails, events: c.events, tasks: c.tasks })}
          </p>
          <p class="first-result-big">
            <span>{total}</span> → <strong>3</strong>
          </p>
          <p class="small muted">{t('first.below')}</p>
          <Button size="sm" variant="ghost" onClick={close}>
            {t('first.ok')}
          </Button>
        </>
      )}
    </section>
  );
}
