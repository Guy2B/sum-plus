import { settings, snapshot, capacity, clock, create, remove, updateSettings } from '../../data/store';
import { visibleTop, visibleDecisions } from '../../data/actions';
import { hasDemoData, clearDemo } from '../../data/seed';
import { getEdition } from '../../domain/editions';
import { eventsOn, isTodayTask } from '../../domain/planning';
import { habitDueOn } from '../../domain/wellbeing';
import { isoDay } from '../../domain/dates';
import { domainEnabled } from '../../domain/signals';
import { pickToday } from '../../domain/today';
import { whyNot } from '../../domain/whynot';
import { daySummary } from '../../domain/review';
import type { Decision } from '../../domain/decision';
import { t, fmtLongDate, fmtTime, fmtMinutes } from '../../i18n';
import { Button, Empty, attempt, Progress } from '../components';
import { Composer, composerFocus, enginePrompts } from '../composer';
import { TodayCard } from '../today-card';
import { navigate } from '../router';

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? t('today.morning') : h < 18 ? t('today.afternoon') : t('today.evening');
}

export function Today() {
  const s = settings.value;
  const ed = getEdition(s.edition, s.locale);
  const now = clock.value;
  const cap = capacity.value;
  const events = domainEnabled(s.context, 'calendar')
    ? snapshot.value.events.filter((e) => !e.deletedAt)
    : [];

  // Arbitrated picks first (merged, capacity-aware), then the rest of the ranking.
  const top = visibleTop.value.selected;
  const ranked = [...top, ...visibleDecisions.value.filter((d) => !top.includes(d))];
  const pick = pickToday(ranked, events, s.context, now);
  const shown = [pick.now, pick.watch, pick.protect?.decision].filter(Boolean);
  const sources = new Set(shown.map((d) => d!.signal.sourceType));
  // "Why not something else?": what was set aside, with the arbitration reason when there is one.
  const rejected = new Map(visibleTop.value.rejected.map((r) => [r.decision.signal.id, r.reason]));
  const setAside = ranked.filter((d) => !shown.includes(d) && d.action !== 'ignore');
  const alternatives = (chosen: Decision | null | undefined, n: number) =>
    chosen ? setAside.slice(0, n).map((alt) => whyNot(chosen, alt, rejected.get(alt.signal.id))) : [];

  // Evening ritual (10 seconds): what happened today, anything important changed?
  const endHour = Number((s.context.workEnd || '18:00').slice(0, 2));
  const evening = now.getHours() >= Math.min(endHour, 18) && s.usage.eveningDone !== isoDay(now);
  const summary = daySummary(snapshot.value, now);
  const closeEvening = (note: boolean) =>
    void updateSettings({ usage: { ...s.usage, eveningDone: isoDay(now) } }).then(() => {
      if (note) composerFocus.value++;
    });

  const upcoming = eventsOn(events, now).filter((e) => !e.allDay && e.end >= now.toISOString());
  const todayTasks = snapshot.value.tasks.filter((x) => isTodayTask(x, now));
  const today = isoDay(now);
  const habits = snapshot.value.habits.filter((h) => !h.deletedAt && habitDueOn(h, now));

  return (
    <div class="page page-narrow">
      <header class="home-head">
        <p class="eyebrow">{fmtLongDate(now)}</p>
        <h1 class="display">{`${greeting(now)}${s.name ? `, ${s.name}` : ''}`}</h1>
        <p class="muted">{shown.length ? t('today.lead') : t('today.leadEmpty')}</p>
      </header>

      {hasDemoData() && (
        <div class="notice">
          <span>{t('today.demoNotice')}</span>
          <Button size="sm" variant="ghost" onClick={() => void attempt(clearDemo, t('today.demoCleared'))}>
            {t('today.clearDemo')}
          </Button>
        </div>
      )}

      {evening && (
        <div class="ritual" role="status">
          <p>
            <strong>{t('today.ritual.title')}</strong>{' '}
            {t('today.ritual.summary', { done: summary.done, deferred: summary.deferred })}{' '}
            {t('today.ritual.question')}
          </p>
          <div class="row-actions">
            <Button size="sm" onClick={() => closeEvening(false)}>
              {t('today.ritual.nothing')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => closeEvening(true)}>
              {t('today.ritual.note')}
            </Button>
          </div>
        </div>
      )}

      <section id="top3" class="today-cards" aria-label={t('today.cardsLabel')}>
        {shown.length ? (
          <>
            {pick.now && <TodayCard role="now" d={pick.now} alternatives={alternatives(pick.now, 2)} />}
            {pick.watch && (
              <TodayCard role="watch" d={pick.watch} alternatives={alternatives(pick.watch, 1)} />
            )}
            {pick.protect && (
              <TodayCard
                role="protect"
                d={pick.protect.decision}
                slot={pick.protect.slot}
                alternatives={alternatives(pick.protect.decision, 1)}
              />
            )}
          </>
        ) : (
          <div class="tile">
            <Empty
              title={t('today.emptyTitle')}
              body={t('today.emptyBody')}
              action={
                <div class="row-actions">
                  <Button variant="primary" icon="plus" onClick={() => navigate('missions')}>
                    {t('mission.new')}
                  </Button>
                  <Button icon="plug" onClick={() => navigate('sources')}>
                    {t('today.connect')}
                  </Button>
                </div>
              }
            />
          </div>
        )}
      </section>
      <p class="small muted sources-line">
        {sources.size
          ? t('today.basedOn', { sources: [...sources].map((x) => t(`source.${x}`)).join(', ') })
          : t('today.noSources')}
        {' · '}
        <a href="#attention" class="link">
          {t('today.seeAll')}
        </a>
        {' · '}
        <a href="#plan" class="link">
          {t('today.whatIf')}
        </a>
      </p>

      <section class="section" aria-label={t('capture.label')}>
        <Composer prompts={enginePrompts()} />
      </section>

      <details class="section day-details">
        <summary>
          {t('today.myDay')}
          <span class="muted small">
            {' · '}
            {t('plan.tasksToday', { count: todayTasks.length })} · {fmtMinutes(cap.plannedMinutes)} /{' '}
            {fmtMinutes(cap.capacityMinutes)}
          </span>
        </summary>
        <div class="tiles">
          <section id="capacity" class="tile" aria-labelledby="capacity-title">
            <div class="tile-head">
              <h2 id="capacity-title">{t('today.capacity')}</h2>
              <a href="#plan" class="link">
                {t('today.openPlan')}
              </a>
            </div>
            <Progress value={Math.min(100, cap.loadPct)} label={t('plan.load')} />
            <p class="small muted">{t(`plan.status.${cap.status}`, { pct: cap.loadPct })}</p>
          </section>
          <section id="agenda" class="tile" aria-labelledby="agenda-title">
            <div class="tile-head">
              <h2 id="agenda-title">{t('today.agenda')}</h2>
              <a href="#calendar" class="link">
                {t('today.openCalendar')}
              </a>
            </div>
            {upcoming.length ? (
              <ul class="timeline">
                {upcoming.slice(0, 5).map((e) => (
                  <li key={e.id}>
                    <time>{fmtTime(e.start)}</time>
                    <span>{e.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="muted small">{t('today.noEvents')}</p>
            )}
          </section>
          {habits.length > 0 && (
            <section id="habits" class="tile" aria-labelledby="habits-title">
              <div class="tile-head">
                <h2 id="habits-title">{ed.labels.habits}</h2>
              </div>
              <ul class="check-list">
                {habits.map((h) => {
                  const log = snapshot.value.habitLogs.find(
                    (l) => !l.deletedAt && l.habitId === h.id && l.date === today,
                  );
                  return (
                    <li key={h.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={Boolean(log)}
                          onChange={() =>
                            void (log
                              ? remove('habitLogs', log.id)
                              : create('habitLogs', { habitId: h.id, date: today }))
                          }
                        />
                        <span>{h.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </details>
    </div>
  );
}
