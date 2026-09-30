import { settings, snapshot, capacity, clock, create, remove } from '../../data/store';
import { visibleTop, visibleDecisions } from '../../data/actions';
import { hasDemoData, clearDemo } from '../../data/seed';
import { getEdition } from '../../domain/editions';
import { eventsOn, isTodayTask } from '../../domain/planning';
import { summarizeMonth } from '../../domain/finance';
import { habitDueOn } from '../../domain/wellbeing';
import { monthKey, isoDay } from '../../domain/dates';
import { domainEnabled } from '../../domain/signals';
import { t, fmtLongDate, fmtTime, fmtMinutes, fmtMoney } from '../../i18n';
import { Button, Empty, Stat, attempt, Progress } from '../components';
import { Composer } from '../composer';
import { DecisionCard } from '../decision-card';
import { navigate } from '../router';
import type { EditionKey } from '../../domain/types';

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? t('today.morning') : h < 18 ? t('today.afternoon') : t('today.evening');
}

function kpis(edition: EditionKey) {
  const s = snapshot.value;
  const now = clock.value;
  const alive = <T extends { deletedAt?: string | null }>(r: T[]) => r.filter((x) => !x.deletedAt);
  const open = alive(s.tasks).filter((x) => x.status !== 'done').length;
  const inbox = alive(s.tasks).filter((x) => x.status === 'inbox').length;
  const projects = alive(s.projects).filter((p) => p.status === 'active').length;
  const month = summarizeMonth(s.finance, monthKey(now));
  const hasFinance = alive(s.finance).length > 0 && domainEnabled(settings.value.context, 'finance');
  const today = isoDay(now);
  const due = alive(s.habits).filter((h) => habitDueOn(h, now));
  const doneHabits = due.filter((h) =>
    s.habitLogs.some((l) => !l.deletedAt && l.habitId === h.id && l.date === today),
  ).length;
  const upcoming = alive(s.events).filter((e) => e.start >= now.toISOString()).length;
  const skills = alive(s.skills);
  const learning = skills.length
    ? Math.round(skills.reduce((a, k) => a + k.progress, 0) / skills.length)
    : null;
  // Health data only counts after explicit consent (GDPR art. 9).
  const latest =
    settings.value.consent.health && domainEnabled(settings.value.context, 'health')
      ? alive(s.health).filter((h) => h.date === today && h.energy != null)[0]
      : undefined;
  const energy = latest?.energy != null ? `${latest.energy}/5` : '—';
  const balance = hasFinance ? fmtMoney(month.balance) : '—';
  const habits = due.length ? `${doneHabits}/${due.length}` : '—';
  const pct = learning == null ? '—' : `${learning}%`;
  const values: Record<EditionKey, (string | number)[]> = {
    student: [open, upcoming, habits, pct],
    solo: [open, projects, balance, energy],
    creator: [inbox, projects, habits, balance],
    life: [open, habits, balance, energy],
    nomad: [open, upcoming, balance, pct],
  };
  return values[edition];
}

export function Today() {
  const s = settings.value;
  const ed = getEdition(s.edition, s.locale);
  const now = clock.value;
  const top = visibleTop.value;
  const cap = capacity.value;
  const events = domainEnabled(s.context, 'calendar')
    ? eventsOn(snapshot.value.events, now).filter((e) => !e.allDay && e.end >= now.toISOString())
    : [];
  const values = kpis(s.edition);
  const todayTasks = snapshot.value.tasks.filter((x) => isTodayTask(x, now));
  const sources = new Set(visibleDecisions.value.map((d) => d.signal.sourceType));
  const today = isoDay(now);
  const habits = snapshot.value.habits.filter((h) => habitDueOn(h, now));

  return (
    <div class="page page-narrow">
      <header class="home-head">
        <p class="eyebrow">{fmtLongDate(now)}</p>
        <h1 class="display">{`${greeting(now)}${s.name ? `, ${s.name}` : ''}`}</h1>
        <p class="muted">{ed.hero}</p>
      </header>

      <Composer prompts={ed.prompts} />

      <section id="top3" class="section" aria-labelledby="top3-title">
        <div class="section-head">
          <h2 id="top3-title">{ed.labels.essentials}</h2>
          <a href="#attention" class="link">
            {t('today.seeAll')}
          </a>
        </div>
        {hasDemoData() && (
          <div class="notice">
            <span>{t('today.demoNotice')}</span>
            <Button size="sm" variant="ghost" onClick={() => void attempt(clearDemo, t('today.demoCleared'))}>
              {t('today.clearDemo')}
            </Button>
          </div>
        )}
        {top.selected.length ? (
          <div class="decision-list">
            {top.selected.map((d, i) => (
              <DecisionCard key={d.signal.id} d={d} rank={i + 1} />
            ))}
          </div>
        ) : (
          <div class="tile">
            <Empty
              title={t('today.emptyTitle')}
              body={t('today.emptyBody')}
              action={
                <div class="row-actions">
                  <Button variant="primary" icon="plus" onClick={() => navigate('tasks')}>
                    {t('today.addTask')}
                  </Button>
                  <Button icon="plug" onClick={() => navigate('sources')}>
                    {t('today.connect')}
                  </Button>
                </div>
              }
            />
          </div>
        )}
        <p class="small muted sources-line">
          {sources.size
            ? t('today.basedOn', { sources: [...sources].map((x) => t(`source.${x}`)).join(', ') })
            : t('today.noSources')}
        </p>
      </section>

      <div class="section tiles">
        <section id="capacity" class="tile" aria-labelledby="capacity-title">
          <div class="tile-head">
            <h2 id="capacity-title">{t('today.capacity')}</h2>
            <a href="#plan" class="link">
              {t('today.openPlan')}
            </a>
          </div>
          <p class={`tile-value ${cap.status === 'overloaded' ? 'bad-text' : ''}`}>
            {fmtMinutes(cap.plannedMinutes)}
            <span class="muted small"> / {fmtMinutes(cap.capacityMinutes)}</span>
          </p>
          <Progress value={Math.min(100, cap.loadPct)} label={t('plan.load')} />
          <p class="small muted">
            {t('plan.tasksToday', { count: todayTasks.length })} ·{' '}
            {cap.isWorkDay ? t('plan.workday') : t('plan.restday')}
            {cap.meetingMinutes > 0 && ` · ${t('plan.meetings', { time: fmtMinutes(cap.meetingMinutes) })}`}
          </p>
          <p class="small muted">
            {t(`plan.status.${cap.status}`, { pct: cap.loadPct })}
            {cap.energyMeasured
              ? ` · ${t('plan.energyFactor', { pct: Math.round(cap.energyFactor * 100) })}`
              : ` · ${t('plan.energyUnknown')}`}
          </p>
        </section>

        <section id="agenda" class="tile" aria-labelledby="agenda-title">
          <div class="tile-head">
            <h2 id="agenda-title">{t('today.agenda')}</h2>
            <a href="#calendar" class="link">
              {t('today.openCalendar')}
            </a>
          </div>
          {events.length ? (
            <ul class="timeline">
              {events.slice(0, 5).map((e) => (
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
              <a href="#goals" class="link">
                {t('today.manage')}
              </a>
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

      <section id="kpis" class="section" aria-labelledby="kpis-title">
        <div class="section-head">
          <h2 id="kpis-title">{ed.labels.focus}</h2>
        </div>
        <div class="stats">
          {ed.kpis.map((label, i) => (
            <Stat key={label} label={label} value={values[i] ?? '—'} />
          ))}
        </div>
      </section>
    </div>
  );
}
