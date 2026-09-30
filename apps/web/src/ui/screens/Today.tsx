import { settings, snapshot, capacity, clock, create, remove, updateSettings } from '../../data/store';
import { setTelemetry, track } from '../../services/telemetry';
import { rememberShown, visibleTop, visibleDecisions } from '../../data/actions';
import { hasDemoData, clearDemo } from '../../data/seed';
import { getEdition } from '../../domain/editions';
import { eventsOn, isTodayTask } from '../../domain/planning';
import { habitDueOn } from '../../domain/wellbeing';
import { isoDay } from '../../domain/dates';
import { domainEnabled } from '../../domain/signals';
import { dayOverride, freeMinutesNow, pickToday, setAside as groupSetAside } from '../../domain/today';
import { overloadAvoided, scheduleDay } from '../../domain/scheduler';
import { calibration } from '../../domain/calibration';
import { useEffect, useState } from 'preact/hooks';
import { whyNot } from '../../domain/whynot';
import { daySummary } from '../../domain/review';
import type { Decision } from '../../domain/decision';
import { t, fmtDate, fmtLongDate, fmtTime, fmtMinutes } from '../../i18n';
import { Button, Empty, attempt, Progress } from '../components';
import { Composer, composerFocus, enginePrompts } from '../composer';
import { TodayCard, type TodayRole } from '../today-card';
import { decisionTitle } from '../decision-card';
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
  const allRanked = [...top, ...visibleDecisions.value.filter((d) => !top.includes(d))];
  const factors = calibration(snapshot.value.feedback.filter((f) => !f.deletedAt));

  // "My day has changed": keep only what the planner can fit under today's constraints.
  const override = dayOverride(s.usage, now);
  let ranked = allRanked;
  if (override) {
    const fitted = scheduleDay(allRanked, events, s.context, now, override, factors);
    const order = [...new Set(fitted.blocks.map((b) => b.decision))];
    const atRisk = fitted.left.filter((l) => l.atRisk).map((l) => l.decision);
    ranked = [...order, ...atRisk.filter((d) => !order.includes(d))];
    // High energy: tackle the demanding work first.
    if (override.energy === 'high') ranked.sort((a, b) => b.facts.effortMinutes - a.facts.effortMinutes);
  }
  const pick = pickToday(ranked, events, s.context, now);
  const [dayOpen, setDayOpen] = useState(false);
  const setDay = (patch: NonNullable<typeof s.usage.day>) => {
    void track('day_replanned');
    void updateSettings({
      usage: {
        ...s.usage,
        day: { ...(s.usage.day?.date === isoDay(now) ? s.usage.day : {}), ...patch, date: isoDay(now) },
      },
    });
  };
  const shown = [pick.now, pick.watch, pick.protect?.decision].filter(Boolean);
  const sources = new Set(shown.map((d) => d!.signal.sourceType));
  // "Why not something else?": what was set aside, with the arbitration reason when there is one.
  const rejected = new Map(visibleTop.value.rejected.map((r) => [r.decision.signal.id, r.reason]));
  const setAside = allRanked.filter((d) => !shown.includes(d) && d.action !== 'ignore');
  const removed = groupSetAside(pick.now ?? null, setAside, rejected);
  const dayPlan = scheduleDay(allRanked, events, s.context, now, override ?? {}, factors);
  // After work hours the planner looks at tomorrow: that is not today's overload.
  const avoided = dayPlan.tomorrow ? 0 : overloadAvoided(dayPlan, factors);
  const alternatives = (chosen: Decision | null | undefined, n: number) =>
    chosen ? setAside.slice(0, n).map((alt) => whyNot(chosen, alt, rejected.get(alt.signal.id))) : [];

  // Evening ritual (10 seconds): what happened today, anything important changed?
  const endHour = Number((s.context.workEnd || '18:00').slice(0, 2));
  const evening = now.getHours() >= Math.min(endHour, 18) && s.usage.eveningDone !== isoDay(now);
  const summary = daySummary(snapshot.value, now);
  // Remember the day's overload avoided: after work hours the planner already looks at tomorrow.
  const avoidedToday = s.usage.avoided?.date === isoDay(now) ? s.usage.avoided.minutes : 0;
  useEffect(() => {
    if (avoided > avoidedToday)
      void updateSettings((cur) => ({
        ...cur,
        usage: { ...cur.usage, avoided: { date: isoDay(now), minutes: avoided } },
      }));
  }, [avoided, avoidedToday]);
  const closedToday = s.usage.eveningDone === isoDay(now);
  const closeEvening = (note: boolean) =>
    void updateSettings({ usage: { ...s.usage, eveningDone: isoDay(now) } }).then(() => {
      if (note) composerFocus.value++;
    });

  // Decision memory: what Σ proposed today, why, what it set aside and in which context.
  const freeNow = freeMinutesNow(events, s.context, now);
  const shownKey = shown.map((d) => d!.signal.id).join('|');
  useEffect(() => {
    const roles: [TodayRole, Decision | null | undefined][] = [
      ['now', pick.now],
      ['watch', pick.watch],
      ['protect', pick.protect?.decision],
    ];
    if (shown.length) void track('first_plan');
    void rememberShown(
      roles
        .filter((x): x is [TodayRole, Decision] => Boolean(x[1]))
        .map(([role, d]) => ({
          id: `${isoDay(now)}:${d.signal.id}`,
          signalId: d.signal.id,
          date: isoDay(now),
          title: decisionTitle(d),
          role,
          reasons: d.reasons.slice(0, 4),
          setAside: alternatives(d, 3).map((w) => ({
            title: decisionTitle(w.decision),
            key: w.key,
            params: { ...w.params, when: w.until ? fmtDate(w.until) : '' },
          })),
          context: {
            freeMinutes: freeNow,
            capacityMinutes: cap.capacityMinutes,
            energy: override?.energy ?? null,
            minutesLeft: override?.maxMinutes ?? null,
          },
          category: d.signal.category ?? null,
          sourceType: d.signal.sourceType,
          estimate: d.facts.effortMinutes,
          outcome: 'shown' as const,
        })),
    );
  }, [shownKey]);

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
      {removed.total > 0 && (
        <details class="set-aside">
          <summary>
            {t('today.removed.summary', { count: removed.total })}
            {avoided > 0 && ` · ${t('today.removed.avoided', { time: fmtMinutes(avoided) })}`}
          </summary>
          <ul>
            {removed.groups.map((g) => (
              <li key={g.key}>
                <strong>
                  {t(`today.removed.group.${g.key.replace('whynot.', '')}`, { count: g.items.length })}
                </strong>
                <span class="muted small">
                  {' '}
                  {g.items
                    .slice(0, 4)
                    .map((w) => decisionTitle(w.decision))
                    .join(' · ')}
                  {g.items.length > 4 ? ' …' : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

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
        {' · '}
        <button type="button" class="link" aria-expanded={dayOpen} onClick={() => setDayOpen(!dayOpen)}>
          {override ? t('today.day.active') : t('today.day.changed')}
        </button>
      </p>

      {(dayOpen || override) && (
        <section class="day-panel" aria-label={t('today.day.changed')}>
          <div class="day-row">
            <span class="small muted">{t('today.day.energy')}</span>
            {(['low', 'normal', 'high'] as const).map((e) => (
              <button
                key={e}
                type="button"
                class={`chip ${override?.energy === e ? 'chip-on' : ''}`}
                aria-pressed={override?.energy === e}
                onClick={() => setDay({ date: isoDay(now), energy: e })}
              >
                {t(`today.day.energy.${e}`)}
              </button>
            ))}
          </div>
          <div class="day-row">
            <span class="small muted">{t('today.day.left')}</span>
            {[30, 60, 120, 240].map((m) => (
              <button
                key={m}
                type="button"
                class={`chip ${override?.maxMinutes === m ? 'chip-on' : ''}`}
                aria-pressed={override?.maxMinutes === m}
                onClick={() => setDay({ date: isoDay(now), minutesLeft: m })}
              >
                {fmtMinutes(m)}
              </button>
            ))}
            <label class="day-end">
              <span class="small muted">{t('today.day.endAt')}</span>
              <input
                type="time"
                value={override?.endAt ?? ''}
                onChange={(e) =>
                  setDay({ date: isoDay(now), endAt: (e.currentTarget as HTMLInputElement).value || null })
                }
              />
            </label>
          </div>
          {override && (
            <button
              type="button"
              class="link"
              onClick={() => void updateSettings({ usage: { ...s.usage, day: null } })}
            >
              {t('today.day.reset')}
            </button>
          )}
        </section>
      )}

      {evening && (
        <section class="day-end" aria-labelledby="day-end-title">
          <h2 id="day-end-title">{t('today.end.title')}</h2>
          <ul class="day-end-facts">
            <li>{t('today.end.done', { count: summary.done })}</li>
            <li>{t('today.end.moved', { count: summary.deferred })}</li>
            {Math.max(avoided, avoidedToday) > 0 && (
              <li>{t('today.end.avoided', { time: fmtMinutes(Math.max(avoided, avoidedToday)) })}</li>
            )}
          </ul>
          <p class="day-end-permission">{t('today.end.permission')}</p>
          <div class="row-actions">
            <Button size="sm" variant="primary" onClick={() => closeEvening(false)}>
              {t('today.end.close')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => closeEvening(true)}>
              {t('today.end.note')}
            </Button>
          </div>
        </section>
      )}
      {closedToday && <p class="day-closed small muted">{t('today.end.closed')}</p>}

      {s.usage.telemetry === undefined && s.onboardingComplete && shown.length > 0 && (
        <aside class="consent-note" aria-labelledby="consent-title">
          <p>
            <strong id="consent-title">{t('telemetry.askTitle')}</strong> {t('telemetry.askBody')}{' '}
            <a href="legal/privacy.html#telemetry" target="_blank" rel="noopener">
              {t('telemetry.details')}
            </a>
          </p>
          <div class="row-actions">
            <Button size="sm" onClick={() => void setTelemetry(true)}>
              {t('telemetry.yes')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void setTelemetry(false)}>
              {t('telemetry.no')}
            </Button>
          </div>
        </aside>
      )}

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
