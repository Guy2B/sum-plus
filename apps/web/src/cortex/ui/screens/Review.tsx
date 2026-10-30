/** Weekly review: what actually happened, day by day, and what moved forward. */
import { clock, entitlement, snapshot } from '../../../data/store';
import { addDays } from '../../../domain/dates';
import { can } from '../../../domain/entitlements';
import { fmtDate } from '../../../i18n';
import { Icon } from '../../../ui/icons';
import { ct, fmtDuration, type CortexKey } from '../../i18n';
import { parseDay, weekReview } from '../../model';
import { liveProjects } from '../../data';
import { go, href } from '../../router';
import { Kpi, Panel, projectColor } from '../parts';
import { planDay, reviewWeek } from '../state';
import { openUpgrade } from '../pro';

export function Review() {
  const back = reviewWeek.value;
  const now = clock.value;
  const r = weekReview(snapshot.value, addDays(now, -7 * back), now);
  const monday = parseDay(r.start);
  const label =
    back === 0
      ? ct('review.thisWeek')
      : back === 1
        ? ct('review.lastWeek')
        : ct('review.weeksAgo', { n: back });
  const max = r.projects[0]?.count ?? 1;
  const wins = r.days.filter((d) => d.wins);
  const older = () => {
    if (back >= 1 && !can('reviewHistory', entitlement.value)) {
      openUpgrade('review');
      return;
    }
    reviewWeek.value = back + 1;
  };
  return (
    <div class="cx-page">
      <header class="page-header">
        <div>
          <p class="eyebrow">{ct('nav.review')}</p>
          <h1>{label}</h1>
          <p class="muted">
            {ct('review.range', {
              from: fmtDate(monday, { day: 'numeric', month: 'long' }),
              to: fmtDate(addDays(monday, 6), { day: 'numeric', month: 'long' }),
            })}
          </p>
        </div>
        <div class="page-actions">
          <button type="button" class="icon-btn" aria-label={ct('review.prev')} onClick={older}>
            <Icon name="chevronLeft" />
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-md"
            disabled={back === 0}
            onClick={() => (reviewWeek.value = 0)}
          >
            {ct('review.thisWeek')}
          </button>
          <button
            type="button"
            class="icon-btn"
            aria-label={ct('review.next')}
            disabled={back === 0}
            onClick={() => (reviewWeek.value = Math.max(0, back - 1))}
          >
            <Icon name="chevronRight" />
          </button>
        </div>
      </header>
      <div class="cx-kpis">
        <Kpi
          label={ct('nav.habits')}
          value={r.habitsAvg == null ? '–' : `${r.habitsAvg} %`}
          detail={ct('review.habitsDetail')}
          pct={r.habitsAvg}
          tone="good"
        />
        <Kpi label={ct('kpi.focus')} value={fmtDuration(r.deepDone)} detail={ct('review.focusDetail')} />
        <Kpi
          label={ct('kpi.tasksDone')}
          value={r.tasksDone}
          detail={ct('review.projectsMoved', { count: r.projects.length })}
        />
        <Kpi
          label={ct('review.energy')}
          value={r.energyAvg == null ? '–' : `${r.energyAvg.toFixed(1)}/5`}
          detail={ct('review.energyDays', { count: r.days.filter((d) => d.energy).length })}
        />
      </div>
      <div class="cx-grid2">
        <Panel title={ct('review.byDay')}>
          <div class="cx-rv">
            <div class="cx-rv-row head">
              <span>{ct('review.day')}</span>
              <span>{ct('nav.habits')}</span>
              <span class="r">{ct('kpi.focus')}</span>
              <span class="r">{ct('nav.tasks')}</span>
              <span class="r">{ct('review.energy')}</span>
            </div>
            {r.days.map((d, i) => (
              <button
                type="button"

                key={d.date}
                class="cx-rv-row"
                disabled={d.future}
                onClick={() => {
                  planDay.value = d.date;
                  go('planning');
                }}
              >
                <span class="cx-rv-day">
                  {ct(`weekday.${i}` as CortexKey)}
                  <small class="num">{parseDay(d.date).getDate()}</small>
                </span>
                <span class="cx-rv-bar">
                  <span class="cx-bar good">
                    <b style={{ width: `${d.habitsPct ?? 0}%` }} />
                  </span>
                  <small class="num">{d.habitsPct == null ? '–' : `${d.habitsPct} %`}</small>
                </span>
                <span class="r num">{d.deepDone ? fmtDuration(d.deepDone) : '–'}</span>
                <span class="r num">{d.tasksDone || '–'}</span>
                <span class="r cx-dots" aria-label={d.energy ? `${d.energy}/5` : '–'}>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <i key={v} class={d.energy && d.energy >= v ? 'on' : ''} />
                  ))}
                </span>
              </button>
            ))}
          </div>
          <p class="cx-hint">{ct('review.openDay')}</p>
        </Panel>
        <div class="cx-stack">
          <Panel title={ct('review.wins')}>
            {wins.length ? (
              <ul class="cx-wins">
                {wins.map((d) => (
                  <li key={d.date}>
                    <small>{ct(`weekdayLong.${(parseDay(d.date).getDay() + 6) % 7}` as CortexKey)}</small>
                    {d.wins}
                  </li>
                ))}
              </ul>
            ) : (
              <p class="cx-empty">{ct('review.noWins')}</p>
            )}
          </Panel>
          <Panel title={ct('review.projects')}>
            {r.projects.length ? (
              <ul class="cx-rank">
                {r.projects.map(({ id, count }) => {
                  const p = liveProjects.value.find((x) => x.id === id);
                  if (!p) return null;
                  return (
                    <li key={id}>
                      <a href={href('project', id)} style={{ '--c': projectColor(p.color) }}>
                        <b>{p.name}</b>
                        <span class="num muted">{ct('review.tasksCount', { count })}</span>
                        <span class="cx-bar">
                          <b style={{ width: `${(count / max) * 100}%` }} />
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p class="cx-empty">{ct('review.noProjects')}</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
