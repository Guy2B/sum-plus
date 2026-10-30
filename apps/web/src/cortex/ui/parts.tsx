/** Building blocks shared by Cortex screens. */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { BlockCategory, Habit, ISODate, Task } from '../../domain/types';
import { clock, create, entitlement, snapshot, update } from '../../data/store';
import { isoDay } from '../../domain/dates';
import { withinLimit } from '../../domain/entitlements';
import {
  doneThisWeek,
  habitTarget,
  habitsOnDay,
  isHabitDue,
  isWeekly,
  skippedOn,
  streak,
  valueOn,
} from '../../domain/habits';
import { Icon } from '../../ui/icons';
import { fmtDate, fmtLongDate } from '../../i18n';
import { toast } from '../../ui/components';
import { ct, fmtDuration, type CortexKey } from '../i18n';
import {
  busyOn,
  currentBlock,
  isForDay,
  dayStats,
  freeSlot,
  hhmm,
  isLate,
  minutesOfDay,
  nextBlock,
  parseDay,
  shiftDay,
  sortBlocks,
} from '../model';
import {
  captureTask,
  dayWindow,
  editDay,
  getDay,
  habitIndex,
  liveHabits,
  liveProjects,
  liveTasks,
  logHabit,
  setBlockDone,
  setHabitSkipped,
  setTaskDone,
  today,
} from '../data';
import { go } from '../router';
import { estimatePick, focusBlock, focusedHabit, planDay, sheet } from './state';
import { sigmaPriorities } from './sigma';
import { celebrate } from './fx';

export const catVar = (c: BlockCategory): string => `var(--cx-${c})`;
export const projectColor = (i: number | undefined): string => `var(--cx-p${(i ?? 0) % 6})`;

/* --------------------------------- basics --------------------------------- */

export function Check({
  on,
  label,
  onToggle,
  color,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
  color?: string;
}) {
  return (
    <button
      type="button"
      class="cx-check"
      aria-pressed={on}
      aria-label={label}
      style={color ? { '--c': color } : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <svg viewBox="0 0 14 14" aria-hidden="true">
        <path d="M3 7.5 6 10.5 11 4" />
      </svg>
    </button>
  );
}

export function Panel({
  title,
  count,
  actions,
  children,
  id,
  class: cls = '',
}: {
  title: ComponentChildren;
  count?: ComponentChildren;
  actions?: ComponentChildren;
  children: ComponentChildren;
  id?: string;
  class?: string;
}) {
  return (
    <section class={`card cx-panel ${cls}`} id={id} aria-labelledby={id ? `${id}-t` : undefined}>
      <div class="card-head">
        <h2 id={id ? `${id}-t` : undefined}>
          {title}
          {count != null && <span class="cx-count">{count}</span>}
        </h2>
        {actions && <div class="card-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  detail,
  pct,
  tone,
  onClick,
}: {
  label: string;
  value: ComponentChildren;
  detail?: string;
  pct?: number | null;
  tone?: 'good';
  onClick?: () => void;
}) {
  const body = (
    <>
      <span class="cx-kpi-label">{label}</span>
      <strong class="cx-kpi-value">{value}</strong>
      {pct != null && (
        <span class={`cx-bar ${tone === 'good' ? 'good' : ''}`} aria-hidden="true">
          <b style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </span>
      )}
      {detail && <span class="cx-kpi-detail">{detail}</span>}
    </>
  );
  return onClick ? (
    <button type="button" class="cx-kpi" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div class="cx-kpi">{body}</div>
  );
}

export function Ring({ done, total, size = 80 }: { done: number; total: number; size?: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <div
      class={`cx-ring ${total && done === total ? 'full' : ''}`}
      style={{ width: `${size}px`, height: `${size}px` }}
      role="img"
      aria-label={ct('habits.ringLabel', { done, total })}
    >
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle class="bg" cx="40" cy="40" r={r} />
        <circle class="fg" cx="40" cy="40" r={r} stroke-dasharray={c} stroke-dashoffset={c * (1 - pct)} />
      </svg>
      <div class="cx-ring-in">
        <b>{Math.round(pct * 100)}%</b>
        <span>
          {done}/{total}
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------- tasks --------------------------------- */

export function dueLabel(t: Task, todayKey: ISODate): { text: string; tone: '' | 'late' | 'today' } | null {
  if (!t.dueDate) return null;
  const due = String(t.dueDate).slice(0, 10);
  if (due === todayKey) return { text: ct('date.today'), tone: 'today' };
  if (due === shiftDay(todayKey, 1)) return { text: ct('date.tomorrow'), tone: '' };
  const text = fmtDate(due);
  return isLate(t, todayKey) ? { text: ct('date.late', { date: text }), tone: 'late' } : { text, tone: '' };
}

/** Block of a day linked to this task, if any. */
export function blockFor(taskId: string, date: ISODate) {
  return getDay(date).blocks.find((b) => b.taskId === taskId) ?? null;
}

export function TaskRow({
  t,
  date,
  showProject = true,
  plan = false,
  estimate = false,
}: {
  t: Task;
  date?: ISODate;
  showProject?: boolean;
  plan?: boolean;
  estimate?: boolean;
}) {
  const tk = today.value;
  const p = t.projectId ? liveProjects.value.find((x) => x.id === t.projectId) : null;
  const due = dueLabel(t, tk);
  const bk = date ? blockFor(t.id, date) : null;
  const done = t.status === 'done';
  const draggable =
    plan && !done && !bk && typeof matchMedia !== 'undefined' && matchMedia('(hover: hover)').matches;
  return (
    <li
      class={`cx-task ${done ? 'done' : ''}`}
      style={{ '--c': p ? projectColor(p.color) : 'var(--muted)' }}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer?.setData('text/plain', `task:${t.id}`);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <Check
        on={done}
        color={p ? projectColor(p.color) : undefined}
        label={ct(done ? 'task.reopen' : 'task.complete', { title: t.title })}
        onToggle={() => void setTaskDone(t, !done)}
      />
      <button type="button" class="cx-task-body" onClick={() => (sheet.value = { kind: 'task', id: t.id })}>
        <span class="cx-task-title">{t.title}</span>
        <span class="cx-meta">
          {t.priority === 'high' && <span class="cx-prio">!</span>}
          {bk && <span class="cx-sched">{ct('task.at', { time: hhmm(bk.start) })}</span>}
          {estimate && <span class="num">{fmtDuration(t.estimateMinutes || 30)}</span>}
          {due && <span class={`cx-due ${due.tone}`}>{due.text}</span>}
          {showProject && p && (
            <span class="cx-tag" style={{ '--c': projectColor(p.color) }}>
              <i />
              {p.name}
            </span>
          )}
          {t.status === 'inbox' && <span class="cx-tag">{ct('nav.inbox')}</span>}
        </span>
      </button>
      <span class="cx-task-actions">
        {plan && !done && !bk && date && (
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            onClick={() => (sheet.value = { kind: 'plan', date, taskId: t.id })}
          >
            {ct('task.plan')}
          </button>
        )}
        <button
          type="button"
          class={`icon-btn ${t.scheduledFor === 'today' ? 'on' : ''}`}
          aria-pressed={t.scheduledFor === 'today'}
          aria-label={ct(t.scheduledFor === 'today' ? 'task.unstar' : 'task.star')}
          title={ct('task.starHint')}
          onClick={() => void toggleStar(t)}
        >
          <Icon name="star" size={16} />
        </button>
      </span>
    </li>
  );
}

async function toggleStar(t: Task) {
  const on = t.scheduledFor !== 'today';
  await update('tasks', t.id, {
    scheduledFor: on ? 'today' : null,
    status: t.status === 'inbox' ? 'todo' : t.status,
  });
}

/** Writing projects get writing blocks; everything else is focus time. */
export function defaultCategory(t: Task): BlockCategory {
  const p = t.projectId ? liveProjects.value.find((x) => x.id === t.projectId) : null;
  return p?.area === 'writing' ? 'writing' : 'focus';
}

/** Places a task in the first free slot of the day (or at `start`). */
export async function planTask(
  t: Task,
  date: ISODate,
  start?: number,
  opts: { len?: number; category?: BlockCategory } = {},
): Promise<void> {
  const d = getDay(date);
  const win = dayWindow.value;
  const len = opts.len ?? (t.estimateMinutes || 30);
  const from = date === today.value ? Math.max(win.start, minutesOfDay(clock.value)) : win.start;
  const s = start ?? freeSlot(busyOn(d, snapshot.value.events, date), len, from, win.end);
  if (s == null) {
    toast(ct('plan.noSlot'), 'info');
    return;
  }
  await editDay(date, (x) => {
    x.blocks.push({
      id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: t.title,
      start: s,
      end: Math.min(24 * 60, s + len),
      category: opts.category ?? defaultCategory(t),
      done: false,
      taskId: t.id,
    });
  });
  const patch: Partial<Task> = {};
  if (t.status === 'inbox') patch.status = 'todo';
  if (opts.len && opts.len !== t.estimateMinutes) patch.estimateMinutes = opts.len;
  if (Object.keys(patch).length) await update('tasks', t.id, patch);
  toast(ct('plan.placedAt', { time: hhmm(s) }), 'good');
}

export function AddTask({
  projectId,
  date,
  star,
  withEstimate,
  id,
}: {
  projectId?: string | null;
  date?: ISODate | null;
  star?: boolean;
  withEstimate?: boolean;
  id: string;
}) {
  const [text, setText] = useState('');
  return (
    <form
      class="cx-add"
      onSubmit={(e) => {
        e.preventDefault();
        const v = text.trim();
        if (!v) return;
        setText('');
        void captureTask({
          text: v,
          projectId: projectId ?? null,
          today: star,
          due: date ?? null,
          estimate: withEstimate ? estimatePick.value : null,
          inbox: false,
        });
      }}
    >
      <input
        id={id}
        value={text}
        maxLength={200}
        autoComplete="off"
        placeholder={ct('task.addPlaceholder')}
        aria-label={ct('task.add')}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
      />
      {withEstimate && (
        <div class="cx-est" role="group" aria-label={ct('task.estimate')}>
          {[15, 30, 60, 90].map((m) => (
            <button
              type="button"
              key={m}
              aria-pressed={estimatePick.value === m}
              onClick={() => (estimatePick.value = m)}
            >
              {fmtDuration(m)}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

/* --------------------------------- habits --------------------------------- */

const MOMENTS = ['am', 'mid', 'pm', 'any'] as const;
export const momentOf = (h: Habit) => h.moment ?? 'any';

export function habitsByMoment(habits: Habit[]): [(typeof MOMENTS)[number], Habit[]][] {
  return MOMENTS.map(
    (m) => [m, habits.filter((h) => momentOf(h) === m)] as [(typeof MOMENTS)[number], Habit[]],
  ).filter(([, l]) => l.length);
}

let pressTimer: ReturnType<typeof setTimeout> | null = null;
let pressFired = false;

export function HabitRow({
  h,
  date,
  compact,
  active,
  hotkey,
}: {
  h: Habit;
  date: ISODate;
  compact?: boolean;
  active?: boolean;
  hotkey?: number;
}) {
  const idx = habitIndex.value;
  const day = parseDay(date);
  const v = valueOn(idx, h, date);
  const target = habitTarget(h);
  const weekly = isWeekly(h);
  // A weekly habit is open all week and done once it was done any day of it.
  const done = v >= target || (weekly && doneThisWeek(idx, h, day));
  const due = weekly || isHabitDue(h, day);
  const passed = skippedOn(idx, h, date);
  const st = streak(h, idx, clock.value);
  const counter = target > 1;
  const r = 19.5;
  const c = 2 * Math.PI * r;
  const color = projectColor(h.color);
  const toggle = async () => {
    const before = habitsOnDay(liveHabits.value, habitIndex.value, day);
    const { completed } = await logHabit(h, date);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* not supported */
    }
    if (!completed) return;
    const after = habitsOnDay(liveHabits.value, habitIndex.value, day);
    if (after.due && after.done === after.due && before.done < before.due) {
      celebrate();
      toast(ct(date === today.value ? 'habits.allDone' : 'habits.dayCompleted'), 'good');
    } else if (date === today.value) {
      const s = streak(h, habitIndex.value, new Date());
      if ([3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365].includes(s))
        toast(ct('habits.milestone', { count: s, name: h.name }), 'good');
    }
  };
  return (
    <li
      class={`cx-habit ${active ? 'active' : ''} ${due ? '' : 'off'} ${done ? 'done' : ''}`}
      style={{ '--c': color }}
      data-habit={h.id}
    >
      <span class="cx-tile" aria-hidden="true">
        <Icon name={h.icon || 'target'} size={18} />
      </span>
      <button
        type="button"
        class="cx-habit-body"
        onClick={() => {
          focusedHabit.value = h.id;
          if (compact) go('habits');
        }}
      >
        <span class="cx-habit-name">{h.name}</span>
        <span class="cx-meta">
          {counter && (
            <span class="num">
              {v}/{target}
              {h.unit ? ` ${h.unit}` : ''}
            </span>
          )}
          {weekly && <span class="cx-pill">{ct('habits.weekly')}</span>}
          {passed ? (
            <span class="cx-pill">{ct('habits.passed')}</span>
          ) : (
            !due && <span class="cx-pill">{ct('habits.rest')}</span>
          )}
          <span class={`cx-flame ${st >= 3 ? 'hot' : ''}`} title={ct('habits.streak')}>
            <Icon name="flame" size={12} />
            <span class="num">{ct('unit.days', { count: st })}</span>
          </span>
        </span>
      </button>
      <span class="cx-habit-side">
        {hotkey != null && hotkey < 10 && (
          <kbd class="cx-hotkey" aria-hidden="true">
            {hotkey}
          </kbd>
        )}
        {counter && v > 0 && (
          <button
            type="button"
            class="icon-btn cx-minus"
            aria-label={ct('habits.minus')}
            onClick={() => void logHabit(h, date, -1)}
          >
            <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
              <path d="M3 7h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        )}
        <button
          type="button"
          class={`cx-hcheck ${done ? 'done' : ''} ${passed && !done ? 'passed' : ''}`}
          aria-pressed={done}
          aria-label={ct(
            passed
              ? 'habits.a11yPassed'
              : counter
                ? 'habits.a11yCount'
                : done
                  ? 'habits.a11yDone'
                  : 'habits.a11yTodo',
            {
              name: h.name,
              v,
              target,
            },
          )}
          onPointerDown={() => {
            pressFired = false;
            pressTimer = setTimeout(() => {
              pressFired = true;
              void setHabitSkipped(h, date, !passed).then(() =>
                toast(ct(passed ? 'habits.unpassedToast' : 'habits.passedToast', { name: h.name }), 'info'),
              );
            }, 550);
          }}
          onPointerUp={() => pressTimer && clearTimeout(pressTimer)}
          onPointerLeave={() => pressTimer && clearTimeout(pressTimer)}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => {
            if (pressFired) {
              pressFired = false;
              return;
            }
            void toggle();
          }}
        >
          {counter && !passed && (
            <>
              <svg class="arc" viewBox="0 0 42 42" aria-hidden="true">
                <circle
                  cx="21"
                  cy="21"
                  r={r}
                  stroke-dasharray={c}
                  stroke-dashoffset={c * (1 - Math.min(1, v / target))}
                />
              </svg>
              <span class="cnt num">{v}</span>
            </>
          )}
          <svg class="tick" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4.5 10.5 8.3 14 15.5 6.5" />
          </svg>
        </button>
      </span>
    </li>
  );
}

export function canAddHabit(): boolean {
  return withinLimit('habits', liveHabits.value.length, entitlement.value);
}

/* ------------------------------- the day ---------------------------------- */

export function WeekStrip({
  date,
  onPick,
  measure,
  allowFuture = true,
}: {
  date: ISODate;
  onPick: (d: ISODate) => void;
  measure: (d: ISODate) => { pct: number; label?: string };
  allowFuture?: boolean;
}) {
  const tk = today.value;
  const d = parseDay(date);
  const monday = shiftDay(date, -((d.getDay() + 6) % 7));
  return (
    <nav class="cx-week" aria-label={ct('week.label')}>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const k = shiftDay(monday, i);
        const fut = k > tk;
        const m = measure(k);
        return (
          <button
            type="button"
            key={k}
            class={`cx-wd ${k === tk ? 'today' : ''} ${k === date ? 'sel' : ''}`}
            aria-pressed={k === date}
            aria-label={fmtLongDate(parseDay(k))}
            disabled={fut && !allowFuture}
            onClick={() => onPick(k)}
          >
            <span class="a">{ct(`weekday.${i}` as CortexKey)}</span>
            <span class="b num">{parseDay(k).getDate()}</span>
            <span class="c num">{m.label ?? ''}</span>
            <span class={`cx-bar ${m.pct === 100 ? 'good' : ''}`}>
              <b style={{ width: `${fut && !allowFuture ? 0 : m.pct}%` }} />
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export function PrioritiesPanel({ date, id }: { date: ISODate; id?: string }) {
  const d = getDay(date);
  const filled = d.priorities.filter((p) => p.title.trim());
  const unplaced = d.priorities.some(
    (p) => p.title.trim() && !p.done && !d.blocks.some((b) => b.title === p.title.trim()),
  );
  return (
    <Panel
      id={id}
      title={ct('day.priorities')}
      count={`${filled.filter((p) => p.done).length}/${filled.length || 3}`}
    >
      <input
        class="cx-intent"
        id={`intent-${date}`}
        maxLength={140}
        value={d.intention}
        placeholder={ct('day.intentionPlaceholder')}
        aria-label={ct('day.intention')}
        onInput={(e) => void editDay(date, (x) => (x.intention = (e.target as HTMLInputElement).value), 600)}
      />
      <ol class="cx-top3">
        {d.priorities.map((p, i) => (
          <li key={i} class={p.done ? 'done' : ''}>
            <span class="n">{i + 1}</span>
            <Check
              on={p.done}
              label={ct('day.priorityDone', { n: i + 1 })}
              onToggle={() => void togglePriority(date, i)}
            />
            <input
              id={`top-${date}-${i}`}
              maxLength={120}
              value={p.title}
              placeholder={ct(`day.priority${i}` as CortexKey)}
              aria-label={ct('day.priorityN', { n: i + 1 })}
              onInput={(e) =>
                void editDay(
                  date,
                  (x) => {
                    // A retyped priority is no longer linked: ticking it must never complete another task.
                    x.priorities[i]!.title = (e.target as HTMLInputElement).value;
                    x.priorities[i]!.taskId = null;
                  },
                  600,
                )
              }
            />
          </li>
        ))}
      </ol>
      <div class="cx-row">
        {!filled.length && <SigmaSuggest date={date} />}
        {unplaced && (
          <button type="button" class="btn btn-secondary btn-sm" onClick={() => void placePriorities(date)}>
            <Icon name="calendar" size={16} />
            <span>{ct('day.placePriorities')}</span>
          </button>
        )}
      </div>
    </Panel>
  );
}

async function togglePriority(date: ISODate, i: number) {
  const p = getDay(date).priorities[i];
  if (!p?.title.trim()) {
    document.getElementById(`top-${date}-${i}`)?.focus();
    return;
  }
  const next = !p.done;
  await editDay(date, (x) => (x.priorities[i]!.done = next));
  if (p.taskId) {
    const t = liveTasks.value.find((x) => x.id === p.taskId);
    if (t && (t.status === 'done') !== next) await setTaskDone(t, next);
  }
}

async function placePriorities(date: ISODate) {
  const win = dayWindow.value;
  let n = 0;
  await editDay(date, (x) => {
    for (const p of x.priorities) {
      const title = p.title.trim();
      if (!title || p.done || x.blocks.some((b) => b.title === title)) continue;
      const from = date === today.value ? Math.max(win.start, minutesOfDay(new Date())) : win.start;
      const s = freeSlot(busyOn(x, snapshot.value.events, date), 60, from, win.end);
      if (s == null) break;
      x.blocks.push({
        id: `b${Date.now().toString(36)}${n}`,
        title,
        start: s,
        end: s + 60,
        category: 'focus',
        done: false,
        taskId: p.taskId ?? null,
      });
      n++;
    }
  });
  toast(n ? ct('day.placed', { count: n }) : ct('plan.noSlot'), n ? 'good' : 'info');
}

/** Σ's three decisions offered as the day's priorities (with their explanation). */
function SigmaSuggest({ date }: { date: ISODate }) {
  if (date !== today.value) return null;
  return (
    <button
      type="button"
      class="btn btn-secondary btn-sm"
      onClick={() =>
        void (async () => {
          const items = sigmaPriorities();
          if (!items.length) {
            toast(ct('sigma.nothing'), 'info');
            return;
          }
          await editDay(date, (x) => {
            x.priorities = [0, 1, 2].map((i) => items[i] ?? { title: '', done: false });
          });
          toast(ct('sigma.prioritiesTaken'), 'good');
        })()
      }
    >
      <Icon name="sigma" size={16} />
      <span>{ct('sigma.takePriorities')}</span>
    </button>
  );
}

export function EveningReview({ date, id }: { date: ISODate; id?: string }) {
  const d = getDay(date);
  const s = dayStats(d);
  const tp = d.priorities.filter((p) => p.title.trim());
  const h = habitsOnDay(liveHabits.value, habitIndex.value, parseDay(date));
  const carry =
    tp.filter((p) => !p.done && !p.taskId).length +
    liveTasks.value.filter((t) => isForDay(t, date, today.value)).length;
  return (
    <Panel id={id} title={ct('review.evening')}>
      <p class="cx-sum">
        <span>
          {ct('review.blocks')}{' '}
          <b class="num">
            {s.done}/{s.count}
          </b>
        </span>
        <span>
          {ct('day.priorities')}{' '}
          <b class="num">
            {tp.filter((p) => p.done).length}/{tp.length}
          </b>
        </span>
        <span>
          {ct('nav.habits')}{' '}
          <b class="num">
            {h.done}/{h.due}
          </b>
        </span>
      </p>
      <div class="field">
        <span class="cx-label" id={`en-${date}`}>
          {ct('review.energy')}
        </span>
        <div class="cx-energy" role="group" aria-labelledby={`en-${date}`}>
          {[1, 2, 3, 4, 5].map((v) => (
            <button
              type="button"
              key={v}
              aria-pressed={d.review.energy === v}
              onClick={() => void editDay(date, (x) => (x.review.energy = x.review.energy === v ? null : v))}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <div class="field">
        <label class="cx-label" for={`wins-${date}`}>
          {ct('review.wins')}
        </label>
        <textarea
          id={`wins-${date}`}
          class="cx-text"
          maxLength={1000}
          value={d.review.wins}
          placeholder={ct('review.winsPlaceholder')}
          onInput={(e) =>
            void editDay(date, (x) => (x.review.wins = (e.target as HTMLTextAreaElement).value), 600)
          }
        />
      </div>
      <div class="field">
        <label class="cx-label" for={`next-${date}`}>
          {ct('review.next')}
        </label>
        <textarea
          id={`next-${date}`}
          class="cx-text"
          maxLength={1000}
          value={d.review.next}
          placeholder={ct('review.nextPlaceholder')}
          onInput={(e) =>
            void editDay(date, (x) => (x.review.next = (e.target as HTMLTextAreaElement).value), 600)
          }
        />
      </div>
      <button type="button" class="btn btn-primary btn-md" onClick={() => void prepareTomorrow(date)}>
        <Icon name="chevronRight" size={16} />
        <span>{carry ? ct('review.prepareCarry', { count: carry }) : ct('review.prepare')}</span>
      </button>
    </Panel>
  );
}

/** Carries what is left to the next day and opens its plan. */
export async function prepareTomorrow(date: ISODate): Promise<void> {
  const next = shiftDay(date, 1);
  const d = getDay(date);
  let n = 0;
  const openTitles = new Set(
    liveTasks.value.filter((t) => t.status !== 'done').map((t) => t.title.trim().toLowerCase()),
  );
  for (const p of d.priorities) {
    const title = p.title.trim();
    if (!title || p.done || p.taskId || openTitles.has(title.toLowerCase())) continue;
    await create('tasks', {
      title,
      category: 'work',
      status: 'todo',
      priority: 'high',
      dueDate: next,
      scheduledFor: null,
      estimateMinutes: 60,
    });
    openTitles.add(title.toLowerCase());
    n++;
  }
  // Open tasks of the day are not moved: overdue ones show up tomorrow by themselves,
  // and their real deadlines (and NEXT's lateness signals) stay intact.
  n += liveTasks.value.filter((t) => isForDay(t, date, today.value)).length;
  const first = d.review.next.trim();
  if (first && !getDay(next).priorities.some((p) => p.title.trim())) {
    await editDay(next, (x) => (x.priorities[0]!.title = first.slice(0, 120)));
  }
  planDay.value = next;
  go('planning');
  toast(n ? ct('review.carried', { count: n }) : ct('review.ready'), 'good');
}

export function NowCard() {
  const tk = today.value;
  const d = getDay(tk);
  const nm = minutesOfDay(clock.value);
  const c = currentBlock(d, nm);
  const n = nextBlock(d, nm);
  if (c) {
    const pct = Math.min(100, ((nm - c.start) / Math.max(1, c.end - c.start)) * 100);
    return (
      <section class="cx-now" aria-live="polite">
        <div class="cx-now-main">
          <p class="cx-now-label">
            <i class="live" />
            {ct('now.current', { cat: ct(`cat.${c.category}` as CortexKey) })}
          </p>
          <p class="cx-now-title">{c.title || ct('block.untitled')}</p>
          <p class="cx-now-meta">
            {ct('now.left', { left: fmtDuration(c.end - nm), end: hhmm(c.end) })}
            {n && n.id !== c.id
              ? ` · ${ct('now.then', { title: n.title || ct('block.untitled'), time: hhmm(n.start) })}`
              : ''}
          </p>
          <span class="cx-now-bar">
            <b style={{ width: `${pct}%` }} />
          </span>
        </div>
        <div class="cx-now-actions">
          <button
            type="button"
            class="btn btn-primary btn-md"
            onClick={() => (focusBlock.value = { date: tk, id: c.id })}
          >
            <Icon name="play" size={16} />
            <span>{ct('focus.start')}</span>
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-md"
            onClick={() => void setBlockDone(tk, c.id, !c.done)}
          >
            {ct(c.done ? 'block.reopen' : 'block.done')}
          </button>
        </div>
      </section>
    );
  }
  return (
    <section class="cx-now" aria-live="polite">
      <div class="cx-now-main">
        <p class="cx-now-label">{n ? ct('now.nextIn', { in: fmtDuration(n.start - nm) }) : ct('now.free')}</p>
        <p class="cx-now-title">
          {n ? n.title || ct('block.untitled') : d.blocks.length ? ct('now.doneForToday') : ct('now.empty')}
        </p>
        <p class="cx-now-meta">
          {n
            ? `${hhmm(n.start)}–${hhmm(n.end)} · ${ct(`cat.${n.category}` as CortexKey)}`
            : d.blocks.length
              ? ct('now.doneHint')
              : ct('now.emptyHint')}
        </p>
      </div>
      <div class="cx-now-actions">
        {!d.blocks.length && (
          <button
            type="button"
            class="btn btn-secondary btn-md"
            onClick={() => (sheet.value = { kind: 'plan', date: today.value, taskId: null })}
          >
            {ct('now.plan')}
          </button>
        )}
        <button type="button" class="btn btn-primary btn-md" onClick={() => void quickFocus()}>
          <Icon name="play" size={16} />
          <span>{ct('focus.quick')}</span>
        </button>
      </div>
    </section>
  );
}

/** Starts a 25-minute focus block now (shortened to fit before the next block). */
export async function quickFocus(): Promise<void> {
  const tk = today.value;
  const now = Math.round(minutesOfDay(new Date()));
  const nx = sortBlocks(getDay(tk).blocks).find((b) => b.start > now);
  let end = Math.min(24 * 60, now + 25);
  if (nx && nx.start < end && nx.start - now >= 10) end = nx.start;
  const id = `b${Date.now().toString(36)}`;
  await editDay(tk, (x) => {
    x.blocks.push({ id, title: ct('focus.defaultTitle'), start: now, end, category: 'focus', done: false });
  });
  focusBlock.value = { date: tk, id };
}

export function Agenda({ date }: { date: ISODate }) {
  const d = getDay(date);
  const nm = minutesOfDay(clock.value);
  const cur = date === today.value ? currentBlock(d, nm) : null;
  const blocks = sortBlocks(d.blocks);
  if (!blocks.length) return null;
  return (
    <ul class="cx-agenda">
      {blocks.map((b) => (
        <li
          key={b.id}
          class={`${b.done ? 'done' : ''} ${cur?.id === b.id ? 'cur' : ''} ${date === today.value && b.end <= nm ? 'past' : ''}`}
          style={{ '--c': catVar(b.category) }}
        >
          <span class="num">{hhmm(b.start)}</span>
          <i aria-hidden="true" />
          <button
            type="button"
            class="cx-agenda-body"
            onClick={() => (sheet.value = { kind: 'block', date, block: b, start: b.start, end: b.end })}
          >
            <b>{b.title || ct('block.untitled')}</b>
            <small>
              {fmtDuration(b.end - b.start)} · {ct(`cat.${b.category}` as CortexKey)}
            </small>
          </button>
          <Check
            on={b.done}
            color={catVar(b.category)}
            label={ct(b.done ? 'block.reopen' : 'block.done')}
            onToggle={() => void setBlockDone(date, b.id, !b.done)}
          />
        </li>
      ))}
    </ul>
  );
}

export function dayTitle(date: ISODate): string {
  const tk = today.value;
  if (date === tk) return ct('date.today');
  if (date === shiftDay(tk, 1)) return ct('date.tomorrow');
  if (date === shiftDay(tk, -1)) return ct('date.yesterday');
  const w = fmtDate(parseDay(date), { weekday: 'long' });
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export const dateLong = (date: ISODate): string => fmtDate(parseDay(date), { day: 'numeric', month: 'long' });

/** True when the store has no user content at all (first visit). */
export function isBlank(): boolean {
  const s = snapshot.value;
  return (
    !s.tasks.some((t) => !t.deletedAt) &&
    !s.habits.some((h) => !h.deletedAt) &&
    !s.notes.some((n) => !n.deletedAt) &&
    !s.days.some((d) => !d.deletedAt)
  );
}

export { isoDay };
