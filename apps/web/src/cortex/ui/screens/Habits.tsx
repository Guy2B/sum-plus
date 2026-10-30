/** Habits: the day's list by moment, streaks, 20-week history, trends. */
import { useEffect } from 'preact/hooks';
import type { Habit } from '../../../domain/types';
import { clock, entitlement, update } from '../../../data/store';
import { withinLimit } from '../../../domain/entitlements';
import { addDays, isoDay, startOfWeek } from '../../../domain/dates';
import {
  bestStreak,
  doneOn,
  habitTarget,
  habitsOnDay,
  isHabitDue,
  logOn,
  perfectDays,
  skippedOn,
  streak,
  successRate,
  valueOn,
} from '../../../domain/habits';
import { fmtDate } from '../../../i18n';
import { Icon } from '../../../ui/icons';
import { ct, type CortexKey } from '../../i18n';
import { parseDay, shiftDay } from '../../model';
import { habitIndex, liveHabits, setHabitSkipped, today } from '../../data';
import { HabitRow, Panel, Ring, WeekStrip, dayTitle, habitsByMoment, momentOf, projectColor } from '../parts';
import { focusedHabit, habitDay, sheet } from '../state';
import { openUpgrade } from '../pro';

export function Habits() {
  const k = habitDay.value;
  const tk = today.value;
  const habits = liveHabits.value;
  const r = habitsOnDay(habits, habitIndex.value, parseDay(k));
  const ordered = habitsByMoment(habits).flatMap(([, l]) => l);
  if (!focusedHabit.value && habits[0]) focusedHabit.value = habits[0].id;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? '') ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        sheet.value
      )
        return;
      if (/^[1-9]$/.test(e.key)) {
        const h = habitsByMoment(liveHabits.value).flatMap(([, l]) => l)[Number(e.key) - 1];
        if (h) document.querySelector<HTMLButtonElement>(`[data-habit="${h.id}"] .cx-hcheck`)?.click();
      } else if (e.key === 'ArrowLeft') habitDay.value = shiftDay(habitDay.value, -1);
      else if (e.key === 'ArrowRight' && habitDay.value < today.value)
        habitDay.value = shiftDay(habitDay.value, 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  let title: string;
  let sub: string;
  if (!habits.length) {
    title = ct('habits.heroStart');
    sub = ct('habits.heroStartHint');
  } else if (!r.due) {
    title = ct('habits.heroRest');
    sub = ct('habits.heroRestHint');
  } else if (r.done === r.due) {
    title = ct('habits.heroDone');
    const p = perfectDays(habits, habitIndex.value, clock.value);
    sub = p > 1 ? ct('habits.heroPerfect', { count: p }) : ct('habits.heroDoneHint');
  } else if (k !== tk) {
    title = ct('habits.heroPast', { done: r.done, due: r.due });
    sub = ct('habits.heroPastHint');
  } else if (!r.done) {
    title = ct('habits.heroGo');
    sub = ct('habits.heroGoHint', { count: r.due });
  } else {
    title = ct('habits.heroLeft', { count: r.due - r.done });
    sub = ct('habits.heroLeftHint', { done: r.done, due: r.due });
  }

  const add = () => {
    if (!withinLimit('habits', habits.length, entitlement.value)) openUpgrade('habits');
    else sheet.value = { kind: 'habit', id: null };
  };

  let n = 0;
  return (
    <div class="cx-page">
      <header class="page-header">
        <div>
          <p class="eyebrow">{ct('nav.habits')}</p>
          <h1>
            {dayTitle(k)} <em class="cx-date">{fmtDate(parseDay(k), { day: 'numeric', month: 'long' })}</em>
          </h1>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-primary btn-md" onClick={add}>
            <Icon name="plus" size={16} />
            <span>{ct('habits.add')}</span>
          </button>
        </div>
      </header>

      <section class="card cx-hero">
        <Ring done={r.done} total={r.due} />
        <div class="cx-hero-body">
          <p class="cx-hero-title">
            {title}
            <small>{sub}</small>
          </p>
          <WeekStrip
            date={k}
            allowFuture={false}
            onPick={(x) => (habitDay.value = x)}
            measure={(x) => {
              const h = habitsOnDay(habits, habitIndex.value, parseDay(x));
              return {
                pct: h.due ? Math.round((h.done / h.due) * 100) : 0,
                label: h.due ? `${h.done}/${h.due}` : '',
              };
            }}
          />
        </div>
      </section>

      <div class="cx-grid2">
        <Panel title={ct('habits.list')}>
          {habits.length ? (
            <>
              {habitsByMoment(habits).map(([m, list]) => {
                const due = list.filter(
                  (h) => isHabitDue(h, parseDay(k)) && !skippedOn(habitIndex.value, h, k),
                );
                const done = due.filter((h) => doneOn(habitIndex.value, h, k)).length;
                return (
                  <div key={m}>
                    <p class="cx-group">
                      {ct(`moment.${m}` as CortexKey)}{' '}
                      {due.length > 0 && (
                        <span class="num">
                          {done}/{due.length}
                        </span>
                      )}
                    </p>
                    <ul class="cx-habits">
                      {list.map((h) => {
                        n++;
                        return (
                          <HabitRow
                            key={h.id}
                            h={h}
                            date={k}
                            active={focusedHabit.value === h.id}
                            hotkey={n}
                          />
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
              <p class="cx-hint">{ct('habits.longPress')}</p>
            </>
          ) : (
            <div class="cx-emptybox">
              <Icon name="repeat" size={28} />
              <p>
                <b>{ct('habits.none')}</b>
              </p>
              <p class="muted">{ct('habits.noneHint')}</p>
              <button type="button" class="btn btn-primary btn-md" onClick={add}>
                {ct('habits.add')}
              </button>
            </div>
          )}
        </Panel>
        <div class="cx-stack">
          <Detail h={habits.find((h) => h.id === focusedHabit.value) ?? null} ordered={ordered} />
          {habits.length > 0 && <Trends habits={habits} />}
        </div>
      </div>
    </div>
  );
}

function Detail({ h, ordered }: { h: Habit | null; ordered: Habit[] }) {
  if (!h)
    return (
      <Panel title={ct('habits.details')}>
        <p class="cx-empty">{ct('habits.detailsEmpty')}</p>
      </Panel>
    );
  const idx = habitIndex.value;
  const now = clock.value;
  const tk = today.value;
  const start = addDays(startOfWeek(now), -7 * 19);
  const cells = [];
  for (let i = 0; i < 140; i++) {
    const d = addDays(start, i);
    const k = isoDay(d);
    const v = valueOn(idx, h, k);
    const since = h.createdAt.slice(0, 10);
    let c = 'miss';
    if (k > tk) c = 'fut';
    else if (k < since && !v) c = 'pre';
    else if (v >= habitTarget(h)) c = 'done';
    else if (v > 0) c = 'part';
    else if (skippedOn(idx, h, k)) c = 'skip';
    else if (!isHabitDue(h, d)) c = 'rest';
    else if (k === tk) c = 'fut';
    cells.push(
      <i
        key={k}
        class={`${c} ${k === habitDay.value ? 'now' : ''}`}
        title={`${fmtDate(d)}${v ? ` : ${v}` : ''}`}
      />,
    );
  }
  const rate = successRate(h, idx, now);
  const i = ordered.indexOf(h);
  const passed = skippedOn(idx, h, habitDay.value);
  const move = async (dir: -1 | 1) => {
    const other = ordered[i + dir];
    if (!other) return;
    await update('habits', h.id, { order: other.order ?? i + dir });
    await update('habits', other.id, { order: h.order ?? i });
  };
  const days = h.days?.length ? h.days : h.cadence === 'weekdays' ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6];
  return (
    <Panel
      title={
        <span class="cx-detail-title" style={{ '--c': projectColor(h.color) }}>
          <span class="cx-tile">
            <Icon name={h.icon || 'target'} size={18} />
          </span>
          {h.name}
        </span>
      }
    >
      <p class="cx-hint">
        {days.length === 7
          ? ct('habits.everyDay')
          : days.map((d) => ct(`weekday.${d}` as CortexKey)).join(' · ')}{' '}
        · {ct(`moment.${momentOf(h)}` as CortexKey)}
        {habitTarget(h) > 1 ? ` · ${ct('habits.goal', { n: habitTarget(h), unit: h.unit ?? '' })}` : ''}
      </p>
      <div class="cx-stats4">
        <div>
          <b class="num">{ct('unit.days', { count: streak(h, idx, now) })}</b>
          <span>{ct('habits.streak')}</span>
        </div>
        <div>
          <b class="num">{ct('unit.days', { count: bestStreak(h, idx, now) })}</b>
          <span>{ct('habits.best')}</span>
        </div>
        <div>
          <b class="num">{rate == null ? '–' : `${rate} %`}</b>
          <span>{ct('habits.rate30')}</span>
        </div>
        <div>
          <b class="num">
            {[...idx.values()].filter((l) => l.habitId === h.id && doneOn(idx, h, l.date)).length}
          </b>
          <span>{ct('habits.total')}</span>
        </div>
      </div>
      <div class="cx-heat-wrap">
        <div
          class="cx-heat"
          style={{ '--c': projectColor(h.color) }}
          role="img"
          aria-label={ct('habits.history')}
        >
          {cells}
        </div>
      </div>
      <div class="cx-legend">
        <span>
          <i style={{ background: projectColor(h.color) }} />
          {ct('legend.done')}
        </span>
        {habitTarget(h) > 1 && (
          <span>
            <i class="part" style={{ '--c': projectColor(h.color) }} />
            {ct('legend.partial')}
          </span>
        )}
        <span>
          <i class="miss" />
          {ct('legend.missed')}
        </span>
        <span>
          <i class="skip" />
          {ct('legend.passed')}
        </span>
        <span>
          <i class="rest" />
          {ct('legend.rest')}
        </span>
      </div>
      <div class="cx-row">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          onClick={() => (sheet.value = { kind: 'habit', id: h.id })}
        >
          <Icon name="edit" size={16} />
          <span>{ct('common.edit')}</span>
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          onClick={() => void setHabitSkipped(h, habitDay.value, !passed)}
        >
          {ct(passed ? 'habits.unpass' : 'habits.pass')}
        </button>
        <button
          type="button"
          class="icon-btn"
          disabled={i <= 0}
          aria-label={ct('common.moveUp')}
          onClick={() => void move(-1)}
        >
          <Icon name="arrowUp" />
        </button>
        <button
          type="button"
          class="icon-btn cx-flip"
          disabled={i < 0 || i >= ordered.length - 1}
          aria-label={ct('common.moveDown')}
          onClick={() => void move(1)}
        >
          <Icon name="arrowUp" />
        </button>
      </div>
      {logOn(idx, h, habitDay.value)?.skipped && <p class="cx-hint">{ct('habits.passedNote')}</p>}
    </Panel>
  );
}

function Trends({ habits }: { habits: Habit[] }) {
  const idx = habitIndex.value;
  const now = clock.value;
  const monday = startOfWeek(now);
  const weeks: { label: string; pct: number | null }[] = [];
  for (let w = 11; w >= 0; w--) {
    const m = addDays(monday, -7 * w);
    let due = 0;
    let done = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(m, i);
      if (isoDay(d) > isoDay(now)) break;
      const r = habitsOnDay(habits, idx, d);
      if (isoDay(d) === isoDay(now)) {
        due += r.done;
        done += r.done;
      } else {
        due += r.due;
        done += r.done;
      }
    }
    weeks.push({
      label: fmtDate(m, { day: 'numeric', month: 'short' }),
      pct: due ? Math.round((done / due) * 100) : null,
    });
  }
  const byDay = [0, 1, 2, 3, 4, 5, 6].map(() => ({ due: 0, done: 0 }));
  for (let i = 1; i <= 84; i++) {
    const d = addDays(now, -i);
    const r = habitsOnDay(habits, idx, d);
    const w = (d.getDay() + 6) % 7;
    byDay[w]!.due += r.due;
    byDay[w]!.done += r.done;
  }
  const rates = byDay.map((x) => (x.due ? Math.round((x.done / x.due) * 100) : null));
  let best = -1;
  let worst = -1;
  rates.forEach((v, i) => {
    if (v == null) return;
    if (best < 0 || v > (rates[best] ?? -1)) best = i;
    if (worst < 0 || v < (rates[worst] ?? 101)) worst = i;
  });
  return (
    <Panel title={ct('habits.trends')} count={ct('habits.weeks12')}>
      <Bars values={weeks.map((w) => w.pct)} labels={weeks.map((w) => w.label)} />
      <p class="cx-insight">
        {best >= 0
          ? ct(worst >= 0 && worst !== best ? 'habits.insight' : 'habits.insightBest', {
              best: ct(`weekdayLong.${best}` as CortexKey),
              bestPct: rates[best] ?? 0,
              worst: ct(`weekdayLong.${Math.max(0, worst)}` as CortexKey),
              worstPct: rates[worst] ?? 0,
            })
          : ct('habits.insightNone')}
      </p>
    </Panel>
  );
}

export function Bars({
  values,
  labels,
  height = 170,
}: {
  values: (number | null)[];
  labels: string[];
  height?: number;
}) {
  const W = 620;
  const pl = 36;
  const pr = 8;
  const pt = 18;
  const pb = 26;
  const cw = (W - pl - pr) / values.length;
  const bw = Math.min(30, cw * 0.6);
  const y = (v: number) => pt + (height - pt - pb) * (1 - v / 100);
  const last = values.length - 1;
  return (
    <svg class="cx-chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={ct('chart.rate')}>
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line class="gl" x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} />
          <text x={pl - 8} y={y(v) + 4} text-anchor="end">
            {v}%
          </text>
        </g>
      ))}
      {values.map((v, i) => {
        const cx = pl + cw * i + cw / 2;
        return (
          <g key={i}>
            {v != null ? (
              <>
                <rect
                  x={cx - bw / 2}
                  y={y(Math.max(v, 1.5))}
                  width={bw}
                  height={y(0) - y(Math.max(v, 1.5))}
                  rx="5"
                  class={i === last ? 'hi' : ''}
                >
                  <title>{`${labels[i]} : ${v} %`}</title>
                </rect>
                {i === last && (
                  <text x={cx} y={y(Math.max(v, 1.5)) - 6} text-anchor="middle" class="val">
                    {v}%
                  </text>
                )}
              </>
            ) : (
              <rect x={cx - bw / 2} y={y(0) - 2} width={bw} height="2" rx="1" class="none" />
            )}
            {(values.length <= 7 || i % 2 === last % 2) && (
              <text x={cx} y={height - 8} text-anchor="middle">
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
