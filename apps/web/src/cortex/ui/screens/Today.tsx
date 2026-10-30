/** Today: the dashboard where NEXT's decisions, the plan, habits and tasks meet. */
import { clock } from '../../../data/store';
import { habitsOnDay, isHabitDue } from '../../../domain/habits';
import { fmtDate } from '../../../i18n';
import { Icon } from '../../../ui/icons';
import { ct, fmtDuration } from '../../i18n';
import { completedOn, dayStats, isForDay, isLate, parseDay, sortTasks } from '../../model';
import { getDay, habitIndex, liveHabits, liveNotes, liveProjects, liveTasks, today } from '../../data';
import { go } from '../../router';
import {
  AddTask,
  Agenda,
  EveningReview,
  HabitRow,
  Kpi,
  NowCard,
  Panel,
  PrioritiesPanel,
  TaskRow,
  habitsByMoment,
  isBlank,
  projectColor,
} from '../parts';
import { sheet } from '../state';
import { SigmaPanel } from './SigmaPanel';

function greeting(h: number): string {
  return ct(h < 12 ? 'today.morning' : h < 18 ? 'today.afternoon' : 'today.evening');
}

export function Today() {
  const k = today.value;
  const now = clock.value;
  const d = getDay(k);
  const s = dayStats(d);
  const tp = d.priorities.filter((p) => p.title.trim());
  const h = habitsOnDay(liveHabits.value, habitIndex.value, parseDay(k));
  const tasks = liveTasks.value;
  const forToday = tasks.filter((x) => isForDay(x, k, k)).sort(sortTasks);
  const late = forToday.filter((x) => isLate(x, k));
  const rest = forToday.filter((x) => !isLate(x, k));
  const doneToday = tasks.filter((x) => completedOn(x, k));
  const habits = liveHabits.value.filter((x) => isHabitDue(x, parseDay(k)));
  const recent = [...liveNotes.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  const blank = isBlank();
  return (
    <div class="cx-page">
      <header class="page-header">
        <div>
          <p class="eyebrow">{fmtDate(now, { weekday: 'long' })}</p>
          <h1>
            {greeting(now.getHours())}{' '}
            <em class="cx-date">{fmtDate(now, { day: 'numeric', month: 'long' })}</em>
          </h1>
          <p class="muted">
            {ct('today.blocks', { count: s.count })} · {ct('today.taskCount', { count: forToday.length })}
          </p>
        </div>
      </header>

      {blank && <Welcome />}

      <NowCard />

      <div class="cx-kpis">
        <Kpi
          label={ct('day.priorities')}
          value={
            <>
              {tp.filter((p) => p.done).length}
              <small>/{tp.length || 3}</small>
            </>
          }
          pct={tp.length ? (tp.filter((p) => p.done).length / tp.length) * 100 : 0}
          onClick={() =>
            document.getElementById('today-pri')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        />
        <Kpi
          label={ct('nav.habits')}
          value={
            <>
              {h.done}
              <small>/{h.due}</small>
            </>
          }
          pct={h.due ? (h.done / h.due) * 100 : 0}
          tone="good"
          onClick={() => go('habits')}
        />
        <Kpi
          label={ct('kpi.focus')}
          value={fmtDuration(s.deepDone)}
          detail={ct('kpi.focusPlanned', { d: fmtDuration(s.deep) })}
          onClick={() => go('planning')}
        />
        <Kpi
          label={ct('kpi.tasksDone')}
          value={
            <>
              {doneToday.length}
              <small>/{doneToday.length + forToday.length}</small>
            </>
          }
          detail={late.length ? ct('kpi.late', { count: late.length }) : ct('kpi.noLate')}
          onClick={() => go('tasks')}
        />
      </div>

      <div class="cx-dash">
        <div class="cx-stack">
          <PrioritiesPanel date={k} id="today-pri" />
          <SigmaPanel />
          <Panel title={ct('today.tasks')} count={forToday.length}>
            {late.length > 0 && (
              <>
                <p class="cx-group late">{ct('tasks.late')}</p>
                <ul class="cx-tasks">
                  {late.map((x) => (
                    <TaskRow key={x.id} t={x} date={k} />
                  ))}
                </ul>
              </>
            )}
            {rest.length > 0 ? (
              <>
                {late.length > 0 && <p class="cx-group">{ct('tasks.planned')}</p>}
                <ul class="cx-tasks">
                  {rest.map((x) => (
                    <TaskRow key={x.id} t={x} date={k} />
                  ))}
                </ul>
              </>
            ) : (
              !late.length && <p class="cx-empty">{ct('today.tasksEmpty')}</p>
            )}
            <AddTask id="add-today" star />
            {doneToday.length > 0 && (
              <>
                <p class="cx-group">{ct('tasks.doneToday', { count: doneToday.length })}</p>
                <ul class="cx-tasks">
                  {doneToday.map((x) => (
                    <TaskRow key={x.id} t={x} date={k} />
                  ))}
                </ul>
              </>
            )}
          </Panel>
        </div>

        <div class="cx-stack">
          <Panel
            title={ct('today.agenda')}
            actions={
              <button type="button" class="btn btn-ghost btn-sm" onClick={() => go('planning')}>
                {ct('today.openPlanning')}
              </button>
            }
          >
            {d.blocks.length ? (
              <Agenda date={k} />
            ) : (
              <>
                <p class="cx-empty">{ct('today.agendaEmpty')}</p>
                <div class="cx-row">
                  <button type="button" class="btn btn-primary btn-sm" onClick={() => go('planning')}>
                    <Icon name="calendar" size={16} />
                    <span>{ct('today.planMyDay')}</span>
                  </button>
                </div>
              </>
            )}
          </Panel>
          <EveningReview date={k} />
        </div>

        <div class="cx-stack">
          <Panel title={ct('nav.habits')} count={`${h.done}/${h.due}`}>
            {habits.length ? (
              <>
                {habitsByMoment(habits).map(([m, list]) => (
                  <div key={m}>
                    <p class="cx-group">{ct(`moment.${m}`)}</p>
                    <ul class="cx-habits">
                      {list.map((x) => (
                        <HabitRow key={x.id} h={x} date={k} compact />
                      ))}
                    </ul>
                  </div>
                ))}
                <p class="cx-hint">{ct('habits.longPress')}</p>
              </>
            ) : (
              <>
                <p class="cx-empty">{liveHabits.value.length ? ct('habits.noneToday') : ct('habits.none')}</p>
                <div class="cx-row">
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    onClick={() => (sheet.value = { kind: 'habit', id: null })}
                  >
                    {ct('habits.add')}
                  </button>
                </div>
              </>
            )}
          </Panel>
          <Panel
            title={ct('today.recentNotes')}
            actions={
              <button type="button" class="btn btn-ghost btn-sm" onClick={() => go('notes')}>
                {ct('common.seeAll')}
              </button>
            }
          >
            {recent.length ? (
              <ul class="cx-notelist">
                {recent.map((n) => {
                  const p = n.projectId ? liveProjects.value.find((x) => x.id === n.projectId) : null;
                  return (
                    <li key={n.id}>
                      <a href={`#notes/${encodeURIComponent(n.id)}`}>
                        <b>{n.title || ct('note.untitled')}</b>
                        <span class="cx-meta">
                          {n.kind === 'idea' && <span class="cx-kind idea">{ct('note.idea')}</span>}
                          {p && (
                            <span class="cx-tag" style={{ '--c': projectColor(p.color) }}>
                              <i />
                              {p.name}
                            </span>
                          )}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p class="cx-empty">{ct('notes.emptyShort')}</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** First visit: three concrete first steps (no fake data). */
function Welcome() {
  return (
    <section class="card cx-welcome" aria-labelledby="cx-welcome-t">
      <div>
        <h2 id="cx-welcome-t">{ct('welcome.title')}</h2>
        <p class="muted">{ct('welcome.body')}</p>
      </div>
      <ol class="cx-steps">
        <li>
          <button type="button" onClick={() => document.getElementById('top-' + today.value + '-0')?.focus()}>
            <b>{ct('welcome.step1')}</b>
            <span>{ct('welcome.step1Hint')}</span>
          </button>
        </li>
        <li>
          <button type="button" onClick={() => go('planning')}>
            <b>{ct('welcome.step2')}</b>
            <span>{ct('welcome.step2Hint')}</span>
          </button>
        </li>
        <li>
          <button type="button" onClick={() => (sheet.value = { kind: 'habit', id: null })}>
            <b>{ct('welcome.step3')}</b>
            <span>{ct('welcome.step3Hint')}</span>
          </button>
        </li>
      </ol>
    </section>
  );
}
