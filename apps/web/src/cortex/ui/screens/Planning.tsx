/** Planning: priorities, tasks to place, the timeline and the evening review of any day. */
import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { snapshot } from '../../../data/store';
import type { BlockCategory } from '../../../domain/types';
import { fmtDate } from '../../../i18n';
import { Icon } from '../../../ui/icons';
import { ct, fmtDuration, type CortexKey } from '../../i18n';
import { CATEGORIES, dayStats, isForDay, parseDay, shiftDay, sortTasks } from '../../model';
import { dayWindow, getDay, liveTasks, today } from '../../data';
import {
  AddTask,
  EveningReview,
  Kpi,
  NowCard,
  Panel,
  PrioritiesPanel,
  TaskRow,
  WeekStrip,
  blockFor,
  catVar,
  dayTitle,
} from '../parts';
import { Timeline, sigmaPlan } from '../Timeline';
import { focusBlock, planDay, sheet } from '../state';
import { suggestStart } from '../sheets';
import { quickFocus } from '../parts';
import { currentBlock, minutesOfDay } from '../../model';
import { toast } from '../../../ui/components';

export function Planning() {
  const k = planDay.value;
  const tk = today.value;
  const d = getDay(k);
  const s = dayStats(d);
  const span = dayWindow.value.end - dayWindow.value.start;
  const open = liveTasks.value.filter((x) => x.status !== 'done');
  const toPlan = open.filter((x) => isForDay(x, k, tk) && !blockFor(x.id, k)).sort(sortTasks);
  const others = open
    .filter((x) => !toPlan.includes(x) && !blockFor(x.id, k))
    .sort(sortTasks)
    .slice(0, 6);
  const placed = liveTasks.value.filter((x) => blockFor(x.id, k));
  const hover = typeof matchMedia !== 'undefined' && matchMedia('(hover: hover)').matches;

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
      if (e.key === 'ArrowLeft') planDay.value = shiftDay(planDay.value, -1);
      else if (e.key === 'ArrowRight') planDay.value = shiftDay(planDay.value, 1);
      else if (e.key === 't') planDay.value = today.value;
      else if (e.key === 'n') {
        e.preventDefault();
        newBlock();
      } else if (e.key === 'f') {
        const c = currentBlock(getDay(today.value), minutesOfDay(new Date()));
        if (c) focusBlock.value = { date: today.value, id: c.id };
        else void quickFocus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const newBlock = () => {
    const at = suggestStart(planDay.value, 60);
    if (at == null) {
      toast(ct('plan.noSlot'), 'info');
      return;
    }
    sheet.value = { kind: 'block', date: planDay.value, block: null, start: at, end: at + 60 };
  };
  const order = CATEGORIES.filter((c) => s.byCategory[c]);

  return (
    <div class="cx-page">
      <header class="page-header">
        <div>
          <p class="eyebrow">{ct('nav.planning')}</p>
          <h1>
            {dayTitle(k)} <em class="cx-date">{fmtDate(parseDay(k), { day: 'numeric', month: 'long' })}</em>
          </h1>
          <p class="muted">
            {ct('today.blocks', { count: s.count })} ·{' '}
            {ct('plan.summary', {
              planned: fmtDuration(s.planned),
              free: fmtDuration(Math.max(0, span - s.planned)),
            })}
          </p>
        </div>
        <div class="page-actions">
          <button
            type="button"
            class="btn btn-ghost btn-md"
            aria-expanded={guideShown()}
            onClick={() => (guideShown() ? hideGuide() : (guideOpen.value = true))}
          >
            <Icon name="help" size={16} />
            <span>{ct('planGuide.help')}</span>
          </button>
          <button
            type="button"
            class="icon-btn"
            aria-label={ct('plan.prev')}
            onClick={() => (planDay.value = shiftDay(k, -1))}
          >
            <Icon name="chevronLeft" />
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-md"
            disabled={k === tk}
            onClick={() => (planDay.value = tk)}
          >
            {ct('date.today')}
          </button>
          <button
            type="button"
            class="icon-btn"
            aria-label={ct('plan.next')}
            onClick={() => (planDay.value = shiftDay(k, 1))}
          >
            <Icon name="chevronRight" />
          </button>
        </div>
      </header>

      {guideShown() && <PlanGuide date={k} touch={!hover} />}

      <WeekStrip
        date={k}
        onPick={(x) => (planDay.value = x)}
        measure={(x) => {
          const st = dayStats(getDay(x));
          return {
            pct: st.count ? Math.round((st.done / st.count) * 100) : 0,
            label: st.planned ? fmtDuration(st.planned) : '',
          };
        }}
      />

      {k === tk && <NowCard />}

      <div class="cx-kpis">
        <Kpi label={ct('kpi.planned')} value={fmtDuration(s.planned)} />
        <Kpi
          label={ct('kpi.focus')}
          value={fmtDuration(s.deep)}
          detail={ct('kpi.focusDone', { d: fmtDuration(s.deepDone) })}
        />
        <Kpi
          label={ct('kpi.blocksDone')}
          value={
            <>
              {s.done}
              <small>/{s.count}</small>
            </>
          }
          pct={s.count ? (s.done / s.count) * 100 : 0}
        />
        <div class="cx-kpi cx-mix">
          <div class="cx-mixbar" role="img" aria-label={ct('plan.mix')}>
            {order.map((c) => (
              <i
                key={c}
                style={{
                  width: `${((s.byCategory[c] ?? 0) / Math.max(span, s.planned)) * 100}%`,
                  background: catVar(c),
                }}
                title={`${ct(`cat.${c}` as CortexKey)} : ${fmtDuration(s.byCategory[c] ?? 0)}`}
              />
            ))}
          </div>
          <div class="cx-mixleg">
            {order.length ? (
              order.map((c: BlockCategory) => (
                <span key={c}>
                  <i style={{ background: catVar(c) }} />
                  {ct(`cat.${c}` as CortexKey)} {fmtDuration(s.byCategory[c] ?? 0)}
                </span>
              ))
            ) : (
              <span>{ct('plan.mixEmpty')}</span>
            )}
          </div>
        </div>
      </div>

      <div class="cx-plan">
        <div class="cx-plan-side" id="cx-plan-side">
          <PrioritiesPanel date={k} />
          <Panel title={ct('plan.toPlan')} count={toPlan.length}>
            {toPlan.length ? (
              <ul class="cx-tasks">
                {toPlan.map((x) => (
                  <TaskRow key={x.id} t={x} date={k} plan estimate />
                ))}
              </ul>
            ) : (
              <p class="cx-empty">{ct('plan.toPlanEmpty')}</p>
            )}
            <AddTask id="add-plan" date={k} withEstimate />
            {others.length > 0 && (
              <>
                <p class="cx-group">{ct('plan.otherOpen')}</p>
                <ul class="cx-tasks">
                  {others.map((x) => (
                    <TaskRow key={x.id} t={x} date={k} plan estimate />
                  ))}
                </ul>
              </>
            )}
            {placed.length > 0 && (
              <>
                <p class="cx-group">{ct('plan.placed', { count: placed.length })}</p>
                <ul class="cx-tasks">
                  {placed.map((x) => (
                    <TaskRow key={x.id} t={x} date={k} />
                  ))}
                </ul>
              </>
            )}
            {hover && (toPlan.length > 0 || others.length > 0) && (
              <p class="cx-hint">{ct('plan.dragHint')}</p>
            )}
          </Panel>
          <EveningReview date={k} />
        </div>
        <section class="card cx-panel cx-plan-tl" aria-labelledby="tl-t">
          <div class="card-head" id="cx-tl">
            <h2 id="tl-t">{ct('plan.timeline')}</h2>
            <div class="card-actions">
              <button type="button" class="btn btn-primary btn-sm" onClick={newBlock}>
                <Icon name="plus" size={16} />
                <span>{ct('block.add')}</span>
              </button>
              <button
                type="button"
                class="icon-btn"
                aria-label={ct('dayOptions.title')}
                onClick={() => (sheet.value = { kind: 'dayOptions', date: k })}
              >
                <Icon name="more" />
              </button>
            </div>
          </div>
          <p class="cx-hint">{ct(hover ? 'plan.hintMouse' : 'plan.hintTouch')}</p>
          <Timeline date={k} />
        </section>
      </div>
    </div>
  );
}

/* ---------------------------------- guide --------------------------------- */

const GUIDE_KEY = 'cortex:plan-guide-hidden';
function readHidden(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1';
  } catch {
    return false;
  }
}
const guideHidden = signal(readHidden());
/** Opened on demand with "How to plan?", even after it was dismissed. */
const guideOpen = signal(false);

/** Shown until the person has planned once or dismisses it; reopened from the header. */
function guideShown(): boolean {
  if (guideOpen.value) return true;
  if (guideHidden.value) return false;
  return !snapshot.value.days.some((d) => !d.deletedAt && d.blocks.length > 0);
}

function hideGuide() {
  guideOpen.value = false;
  guideHidden.value = true;
  try {
    localStorage.setItem(GUIDE_KEY, '1');
  } catch {
    /* private mode: hidden for this session only */
  }
}

const scrollTo = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** How planning works, in three gestures, each one doable from here. */
function PlanGuide({ date, touch }: { date: string; touch: boolean }) {
  const steps: { title: CortexKey; hint: CortexKey; go: () => void }[] = [
    { title: 'planGuide.s1', hint: 'planGuide.s1Hint', go: () => scrollTo('cx-plan-side') },
    {
      title: 'planGuide.s2',
      hint: touch ? 'planGuide.s2HintTouch' : 'planGuide.s2HintMouse',
      go: () => scrollTo('cx-tl'),
    },
    {
      title: 'planGuide.s3',
      hint: 'planGuide.s3Hint',
      go: () => {
        if (date !== today.value) planDay.value = today.value;
        void sigmaPlan(today.value).then(() => scrollTo('cx-tl'));
      },
    },
  ];
  return (
    <section class="card cx-welcome cx-plan-guide" aria-labelledby="cx-pg-t">
      <div class="cx-welcome-head">
        <div>
          <h2 id="cx-pg-t">{ct('planGuide.title')}</h2>
          <p class="muted">{ct('planGuide.body')}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" onClick={hideGuide}>
          {ct('planGuide.hide')}
        </button>
      </div>
      <ol class="cx-steps cx-steps-3">
        {steps.map((st) => (
          <li key={st.title}>
            <button type="button" onClick={st.go}>
              <b>{ct(st.title)}</b>
              <span>{ct(st.hint)}</span>
            </button>
          </li>
        ))}
      </ol>
      <p class="cx-hint">{ct('planGuide.after')}</p>
    </section>
  );
}
