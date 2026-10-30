/** Edit dialogs: block, task, habit, project, day options. */
import { useState } from 'preact/hooks';
import type { BlockCategory, DayMoment, Habit, ISODate, Project, Task } from '../../domain/types';
import { create, entitlement, remove, restore, snapshot, update } from '../../data/store';
import { can, withinLimit } from '../../domain/entitlements';
import { Modal, confirmDialog, toast } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { ct, fmtDuration, type CortexKey } from '../i18n';
import { CATEGORIES, freeSlot, hhmm, parseHHMM, shiftDay, sortBlocks } from '../model';
import { cadenceFor, dayWindow, editDay, getDay, liveHabits, liveProjects, newBlockId, today } from '../data';
import { catVar, projectColor } from './parts';
import { sheet } from './state';
import { openUpgrade } from './pro';
import { go } from '../router';
import { sigmaPlan } from './Timeline';

const close = () => (sheet.value = null);

export function Sheets() {
  const s = sheet.value;
  if (!s) return null;
  switch (s.kind) {
    case 'block':
      return <BlockSheet key={`${s.date}-${s.block?.id ?? 'new'}`} s={s} />;
    case 'task':
      return <TaskSheet key={s.id} id={s.id} />;
    case 'habit':
      return <HabitSheet key={s.id ?? 'new'} id={s.id} />;
    case 'project':
      return <ProjectSheet key={s.id ?? 'new'} id={s.id} area={s.area} />;
    case 'dayOptions':
      return <DayOptions date={s.date} />;
  }
}

function Seg<T extends string | number>({
  value,
  options,
  onPick,
  label,
}: {
  value: T;
  options: [T, string][];
  onPick: (v: T) => void;
  label: string;
}) {
  return (
    <div class="cx-seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button type="button" key={String(v)} aria-pressed={value === v} onClick={() => onPick(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- block ---------------------------------- */

function BlockSheet({ s }: { s: Extract<NonNullable<typeof sheet.value>, { kind: 'block' }> }) {
  const [title, setTitle] = useState(s.block?.title ?? s.title ?? '');
  const [cat, setCat] = useState<BlockCategory>(s.block?.category ?? s.category ?? 'focus');
  const [start, setStart] = useState(hhmm(s.start));
  const [end, setEnd] = useState(hhmm(s.end));
  const [note, setNote] = useState(s.block?.note ?? '');
  const [err, setErr] = useState('');
  const date = s.date;
  const save = async () => {
    const a = parseHHMM(start);
    let b = parseHHMM(end);
    if (b === 0) b = 24 * 60;
    if (a == null || b == null || b <= a) {
      setErr(ct('block.errorTime'));
      return;
    }
    await editDay(date, (d) => {
      if (s.block) {
        const x = d.blocks.find((y) => y.id === s.block!.id);
        if (x) Object.assign(x, { title: title.trim(), category: cat, start: a, end: b, note });
      } else
        d.blocks.push({
          id: newBlockId(),
          title: title.trim(),
          category: cat,
          start: a,
          end: b,
          note,
          done: false,
        });
    });
    close();
  };
  const setDur = (m: number) => {
    const a = parseHHMM(start);
    if (a != null) setEnd(hhmm(Math.min(24 * 60, a + m)));
  };
  return (
    <Modal open onClose={close} title={ct(s.block ? 'block.edit' : 'block.new')}>
      <form
        class="cx-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div class="field">
          <label for="b-title">{ct('block.what')}</label>
          <input
            id="b-title"
            value={title}
            maxLength={120}
            autoFocus={!s.block}
            placeholder={ct('block.placeholder')}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <span class="cx-label">{ct('block.category')}</span>
          <div class="cx-cats">
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c}
                style={{ '--c': catVar(c) }}
                aria-pressed={cat === c}
                onClick={() => setCat(c)}
              >
                <i />
                {ct(`cat.${c}` as CortexKey)}
              </button>
            ))}
          </div>
        </div>
        <div class="cx-two">
          <div class="field">
            <label for="b-start">{ct('block.start')}</label>
            <input
              id="b-start"
              type="time"
              step={300}
              value={start}
              onInput={(e) => setStart((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="field">
            <label for="b-end">{ct('block.end')}</label>
            <input
              id="b-end"
              type="time"
              step={300}
              value={end}
              onInput={(e) => setEnd((e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        <div class="cx-chips">
          {[15, 30, 45, 60, 90, 120].map((m) => (
            <button type="button" key={m} onClick={() => setDur(m)}>
              {fmtDuration(m)}
            </button>
          ))}
        </div>
        <div class="field">
          <label for="b-note">{ct('block.note')}</label>
          <textarea
            id="b-note"
            rows={3}
            maxLength={1000}
            value={note}
            placeholder={ct('block.notePlaceholder')}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          />
        </div>
        {s.block?.taskId && <p class="muted cx-small">{ct('block.linkedTask')}</p>}
        {err && (
          <p class="cx-err" role="alert">
            {err}
          </p>
        )}
        <div class="cx-foot">
          {s.block && (
            <>
              <button
                type="button"
                class="btn btn-ghost btn-md cx-danger"
                onClick={() => {
                  const b = s.block!;
                  void editDay(date, (d) => (d.blocks = d.blocks.filter((x) => x.id !== b.id)));
                  close();
                  toast(ct('block.deleted'), 'info', {
                    label: ct('common.undo'),
                    run: () => void editDay(date, (d) => d.blocks.push(b)),
                  });
                }}
              >
                {ct('common.delete')}
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-md"
                onClick={() => {
                  const b = s.block!;
                  const len = b.end - b.start;
                  const at = freeSlot(getDay(date).blocks, len, b.end, 24 * 60);
                  if (at == null) {
                    toast(ct('plan.noSlot'), 'info');
                    return;
                  }
                  void editDay(date, (d) =>
                    d.blocks.push({
                      ...b,
                      id: newBlockId(),
                      start: at,
                      end: at + len,
                      done: false,
                      taskId: null,
                    }),
                  );
                  close();
                  toast(ct('block.duplicated', { time: hhmm(at) }), 'good');
                }}
              >
                {ct('block.duplicate')}
              </button>
            </>
          )}
          <span class="cx-sp" />
          <button type="button" class="btn btn-secondary btn-md" onClick={close}>
            {ct('common.cancel')}
          </button>
          <button type="submit" class="btn btn-primary btn-md">
            {ct(s.block ? 'common.save' : 'common.add')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------- task ---------------------------------- */

function TaskSheet({ id }: { id: string }) {
  const t = snapshot.value.tasks.find((x) => x.id === id);
  const [title, setTitle] = useState(t?.title ?? '');
  const [pid, setPid] = useState(t?.projectId ?? '');
  const [due, setDue] = useState(t?.dueDate ? String(t.dueDate).slice(0, 10) : '');
  const [prio, setPrio] = useState<Task['priority']>(t?.priority ?? 'medium');
  const [est, setEst] = useState(t?.estimateMinutes || 30);
  const [notes, setNotes] = useState(t?.notes ?? '');
  const [err, setErr] = useState('');
  if (!t) return null;
  const save = async () => {
    if (!title.trim()) {
      setErr(ct('task.errorTitle'));
      return;
    }
    await update('tasks', t.id, {
      title: title.trim(),
      projectId: pid || null,
      // Keep an existing due time unless the date itself was changed.
      dueDate: due === (t.dueDate ? String(t.dueDate).slice(0, 10) : '') ? (t.dueDate ?? null) : due || null,
      priority: prio,
      estimateMinutes: est,
      notes,
      status: t.status === 'inbox' && (pid || due) ? 'todo' : t.status,
    });
    close();
    toast(ct('task.saved'), 'good');
  };
  return (
    <Modal open onClose={close} title={ct('task.edit')}>
      <form
        class="cx-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div class="field">
          <label for="t-title">{ct('task.title')}</label>
          <input
            id="t-title"
            value={title}
            maxLength={300}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="cx-two">
          <div class="field">
            <label for="t-proj">{ct('task.project')}</label>
            <select id="t-proj" value={pid} onChange={(e) => setPid((e.target as HTMLSelectElement).value)}>
              <option value="">{ct('task.noProject')}</option>
              {liveProjects.value
                .filter((p) => p.status !== 'done' || p.id === pid)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </div>
          <div class="field">
            <label for="t-due">{ct('task.due')}</label>
            <input
              id="t-due"
              type="date"
              value={due}
              onInput={(e) => setDue((e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        <div class="cx-two">
          <div class="field">
            <span class="cx-label">{ct('task.priority')}</span>
            <Seg
              label={ct('task.priority')}
              value={prio}
              onPick={setPrio}
              options={[
                ['low', ct('prio.low')],
                ['medium', ct('prio.medium')],
                ['high', ct('prio.high')],
              ]}
            />
          </div>
          <div class="field">
            <label for="t-est">{ct('task.estimate')}</label>
            <select
              id="t-est"
              value={String(est)}
              onChange={(e) => setEst(Number((e.target as HTMLSelectElement).value))}
            >
              {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
                <option key={m} value={m}>
                  {fmtDuration(m)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div class="field">
          <label for="t-notes">{ct('task.notes')}</label>
          <textarea
            id="t-notes"
            rows={3}
            maxLength={2000}
            value={notes}
            onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
          />
        </div>
        {err && (
          <p class="cx-err" role="alert">
            {err}
          </p>
        )}
        <div class="cx-foot">
          <button
            type="button"
            class="btn btn-ghost btn-md cx-danger"
            onClick={() => {
              void remove('tasks', t.id);
              close();
              toast(ct('task.deleted'), 'info', {
                label: ct('common.undo'),
                run: () => void restore('tasks', t.id),
              });
            }}
          >
            {ct('common.delete')}
          </button>
          <span class="cx-sp" />
          <button type="button" class="btn btn-secondary btn-md" onClick={close}>
            {ct('common.cancel')}
          </button>
          <button type="submit" class="btn btn-primary btn-md">
            {ct('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------- habit --------------------------------- */

export const HABIT_ICONS = [
  'drop',
  'activity',
  'dumbbell',
  'book',
  'feather',
  'leaf',
  'moon',
  'sun',
  'heart',
  'coffee',
  'bed',
  'phoneOff',
  'target',
  'wallet',
  'sparkles',
  'graduation',
];

function HabitSheet({ id }: { id: string | null }) {
  const h = id ? liveHabits.value.find((x) => x.id === id) : null;
  const [name, setName] = useState(h?.name ?? '');
  const [icon, setIcon] = useState(h?.icon ?? 'target');
  const [color, setColor] = useState(h?.color ?? liveHabits.value.length % 6);
  const [counter, setCounter] = useState((h?.target ?? 1) > 1);
  const [target, setTarget] = useState(String((h?.target ?? 1) > 1 ? h!.target : 8));
  const [unit, setUnit] = useState(h?.unit ?? '');
  const [moment, setMoment] = useState<DayMoment>(h?.moment ?? 'any');
  const weekly = Boolean(h && h.cadence === 'weekly' && !h.days?.length);
  const [daysTouched, setDaysTouched] = useState(false);
  const [days, setDays] = useState<number[]>(
    h?.days?.length ? h.days : h?.cadence === 'weekdays' ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6],
  );
  const [err, setErr] = useState('');
  const save = async () => {
    const n = name.trim();
    const tg = counter ? Number(target) : 1;
    if (!n) return setErr(ct('habits.errorName'));
    if (!days.length) return setErr(ct('habits.errorDays'));
    if (counter && !(tg >= 2 && tg <= 999)) return setErr(ct('habits.errorTarget'));
    const fields: Partial<Habit> = {
      name: n,
      icon,
      color,
      target: tg,
      unit: counter ? unit.trim().slice(0, 16) : '',
      moment,
      days: [...days].sort(),
      cadence: cadenceFor(days),
    };
    // A NEXT weekly habit stays weekly unless the person really picks days.
    if (weekly && !daysTouched) {
      delete fields.days;
      delete fields.cadence;
    }
    if (h) await update('habits', h.id, fields);
    else {
      if (!withinLimit('habits', liveHabits.value.length, entitlement.value)) {
        close();
        openUpgrade('habits');
        return;
      }
      await create('habits', { ...(fields as Habit), domain: 'personal', order: liveHabits.value.length });
    }
    close();
    toast(ct(h ? 'habits.saved' : 'habits.added'), 'good');
  };
  const pickDays = (next: number[]) => {
    setDaysTouched(true);
    setDays(next);
  };
  const toggleDay = (d: number) => pickDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);
  return (
    <Modal open onClose={close} title={ct(h ? 'habits.edit' : 'habits.new')}>
      <form
        class="cx-form"
        style={{ '--c': projectColor(color) }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div class="field">
          <label for="h-name">{ct('habits.name')}</label>
          <input
            id="h-name"
            value={name}
            maxLength={60}
            autoFocus={!h}
            placeholder={ct('habits.namePlaceholder')}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <span class="cx-label">{ct('habits.icon')}</span>
          <div class="cx-icons">
            {HABIT_ICONS.map((n) => (
              <button
                type="button"
                key={n}
                aria-pressed={icon === n}
                aria-label={n}
                onClick={() => setIcon(n)}
              >
                <Icon name={n} size={18} />
              </button>
            ))}
          </div>
        </div>
        <div class="field">
          <span class="cx-label">{ct('common.color')}</span>
          <ColorPick value={color} onPick={setColor} />
        </div>
        <div class="field">
          <span class="cx-label">{ct('habits.type')}</span>
          <Seg
            label={ct('habits.type')}
            value={counter ? 'n' : 'y'}
            onPick={(v) => setCounter(v === 'n')}
            options={[
              ['y', ct('habits.typeYes')],
              ['n', ct('habits.typeCount')],
            ]}
          />
        </div>
        {counter && (
          <div class="cx-two">
            <div class="field">
              <label for="h-target">{ct('habits.target')}</label>
              <input
                id="h-target"
                type="number"
                inputMode="numeric"
                min={2}
                max={999}
                value={target}
                onInput={(e) => setTarget((e.target as HTMLInputElement).value)}
              />
            </div>
            <div class="field">
              <label for="h-unit">{ct('habits.unit')}</label>
              <input
                id="h-unit"
                maxLength={16}
                value={unit}
                placeholder={ct('habits.unitPlaceholder')}
                onInput={(e) => setUnit((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
        )}
        <div class="field">
          <span class="cx-label">{ct('habits.moment')}</span>
          <Seg
            label={ct('habits.moment')}
            value={moment}
            onPick={setMoment}
            options={(['am', 'mid', 'pm', 'any'] as DayMoment[]).map((m) => [
              m,
              ct(`moment.${m}` as CortexKey),
            ])}
          />
        </div>
        <div class="field">
          <span class="cx-label">{ct('habits.days')}</span>
          {weekly && !daysTouched && <p class="cx-hint">{ct('habits.weeklyHint')}</p>}
          <div class="cx-days">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <button
                type="button"
                key={d}
                aria-pressed={days.includes(d)}
                aria-label={ct(`weekdayLong.${d}` as CortexKey)}
                onClick={() => toggleDay(d)}
              >
                {ct(`weekday.${d}` as CortexKey)}
              </button>
            ))}
          </div>
          <div class="cx-chips">
            <button type="button" onClick={() => pickDays([0, 1, 2, 3, 4, 5, 6])}>
              {ct('habits.everyDay')}
            </button>
            <button type="button" onClick={() => pickDays([0, 1, 2, 3, 4])}>
              {ct('habits.weekdays')}
            </button>
            <button type="button" onClick={() => pickDays([5, 6])}>
              {ct('habits.weekend')}
            </button>
          </div>
        </div>
        {err && (
          <p class="cx-err" role="alert">
            {err}
          </p>
        )}
        <div class="cx-foot">
          {h && (
            <button
              type="button"
              class="btn btn-ghost btn-md cx-danger"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: ct('habits.deleteTitle', { name: h.name }),
                  body: ct('habits.deleteBody'),
                  confirmLabel: ct('common.delete'),
                  danger: true,
                });
                if (!ok) return;
                await remove('habits', h.id);
                close();
                toast(ct('habits.deleted'), 'info', {
                  label: ct('common.undo'),
                  run: () => void restore('habits', h.id),
                });
              }}
            >
              {ct('common.delete')}
            </button>
          )}
          <span class="cx-sp" />
          <button type="button" class="btn btn-secondary btn-md" onClick={close}>
            {ct('common.cancel')}
          </button>
          <button type="submit" class="btn btn-primary btn-md">
            {ct(h ? 'common.save' : 'common.add')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ColorPick({ value, onPick }: { value: number; onPick: (v: number) => void }) {
  return (
    <div class="cx-colors">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <button
          type="button"
          key={i}
          style={{ '--c': projectColor(i) }}
          aria-pressed={value === i}
          aria-label={ct('common.colorN', { n: i + 1 })}
          onClick={() => onPick(i)}
        />
      ))}
    </div>
  );
}

/* --------------------------------- project -------------------------------- */

function ProjectSheet({ id, area: initialArea }: { id: string | null; area?: Project['area'] }) {
  const p = id ? liveProjects.value.find((x) => x.id === id) : null;
  const [name, setName] = useState(p?.name ?? '');
  const [area, setArea] = useState<NonNullable<Project['area']>>(p?.area ?? initialArea ?? 'pro');
  const [status, setStatus] = useState<Project['status']>(p?.status ?? 'active');
  const [color, setColor] = useState(p?.color ?? liveProjects.value.length % 6);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!name.trim()) return setErr(ct('project.errorName'));
    if (p) {
      await update('projects', p.id, { name: name.trim(), area, status, color });
      close();
      toast(ct('project.saved'), 'good');
      return;
    }
    if (
      !withinLimit(
        'projects',
        liveProjects.value.filter((x) => x.status !== 'done').length,
        entitlement.value,
      )
    ) {
      close();
      openUpgrade('projects');
      return;
    }
    if (
      area === 'writing' &&
      !can('unlimitedProjects', entitlement.value) &&
      !can('writing', entitlement.value)
    ) {
      close();
      openUpgrade('writing');
      return;
    }
    const created = await create('projects', {
      name: name.trim(),
      area,
      status,
      color,
      milestones: [],
      description: '',
    });
    close();
    go('project', created.id);
    toast(ct('project.created'), 'good');
  };
  return (
    <Modal open onClose={close} title={ct(p ? 'project.edit' : 'project.new')}>
      <form
        class="cx-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div class="field">
          <label for="p-name">{ct('project.name')}</label>
          <input
            id="p-name"
            value={name}
            maxLength={80}
            autoFocus={!p}
            placeholder={ct('project.namePlaceholder')}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <span class="cx-label">{ct('project.area')}</span>
          <Seg
            label={ct('project.area')}
            value={area}
            onPick={setArea}
            options={[
              ['pro', ct('area.pro')],
              ['writing', ct('area.writing')],
              ['personal', ct('area.personal')],
            ]}
          />
        </div>
        <div class="field">
          <span class="cx-label">{ct('project.status')}</span>
          <Seg
            label={ct('project.status')}
            value={status}
            onPick={setStatus}
            options={[
              ['active', ct('status.active')],
              ['paused', ct('status.paused')],
              ['done', ct('status.done')],
            ]}
          />
        </div>
        <div class="field">
          <span class="cx-label">{ct('common.color')}</span>
          <ColorPick value={color} onPick={setColor} />
        </div>
        {err && (
          <p class="cx-err" role="alert">
            {err}
          </p>
        )}
        <div class="cx-foot">
          {p && (
            <button
              type="button"
              class="btn btn-ghost btn-md cx-danger"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: ct('project.deleteTitle', { name: p.name }),
                  body: ct('project.deleteBody'),
                  confirmLabel: ct('common.delete'),
                  danger: true,
                });
                if (!ok) return;
                await remove('projects', p.id);
                close();
                go('projects');
                toast(ct('project.deleted'), 'info', {
                  label: ct('common.undo'),
                  run: () => void restore('projects', p.id),
                });
              }}
            >
              {ct('common.delete')}
            </button>
          )}
          <span class="cx-sp" />
          <button type="button" class="btn btn-secondary btn-md" onClick={close}>
            {ct('common.cancel')}
          </button>
          <button type="submit" class="btn btn-primary btn-md">
            {ct(p ? 'common.save' : 'common.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------- day options ------------------------------ */

const ROUTINE = 'routine';

function DayOptions({ date }: { date: ISODate }) {
  const d = getDay(date);
  const prev = getDay(shiftDay(date, -1));
  const routine = getDay(ROUTINE);
  const proRoutines = can('routines', entitlement.value);
  const addFrom = async (blocks: typeof d.blocks) => {
    let n = 0;
    await editDay(date, (x) => {
      for (const b of sortBlocks(blocks)) {
        if (x.blocks.some((y) => y.start < b.end && b.start < y.end)) continue;
        x.blocks.push({ ...b, id: newBlockId(), done: false, taskId: null });
        n++;
      }
    });
    return n;
  };
  return (
    <Modal open onClose={close} title={ct('dayOptions.title')}>
      <div class="cx-optlist">
        {date === today.value && (
          <button
            type="button"
            onClick={async () => {
              close();
              await sigmaPlan(date);
            }}
          >
            <b>
              <Icon name="sigma" size={16} /> {ct('sigma.planDay')}
            </b>
            <span>{ct('sigma.planDayHint')}</span>
          </button>
        )}
        <button
          type="button"
          disabled={!d.blocks.length}
          onClick={async () => {
            if (!proRoutines) {
              close();
              openUpgrade('routines');
              return;
            }
            await editDay(
              ROUTINE,
              (x) => (x.blocks = d.blocks.map((b) => ({ ...b, done: false, taskId: null }))),
            );
            close();
            toast(ct('dayOptions.routineSaved'), 'good');
          }}
        >
          <b>
            {ct('dayOptions.saveRoutine')} {!proRoutines && <span class="badge badge-accent">Pro</span>}
          </b>
          <span>{ct('dayOptions.saveRoutineHint')}</span>
        </button>
        <button
          type="button"
          disabled={!routine.blocks.length}
          onClick={async () => {
            const n = await addFrom(routine.blocks);
            close();
            toast(n ? ct('dayOptions.added', { count: n }) : ct('plan.noSlot'), n ? 'good' : 'info');
          }}
        >
          <b>{ct('dayOptions.applyRoutine')}</b>
          <span>
            {routine.blocks.length
              ? ct('dayOptions.applyRoutineHint', { count: routine.blocks.length })
              : ct('dayOptions.noRoutine')}
          </span>
        </button>
        <button
          type="button"
          disabled={!prev.blocks.length}
          onClick={async () => {
            const n = await addFrom(prev.blocks);
            close();
            toast(n ? ct('dayOptions.added', { count: n }) : ct('plan.noSlot'), n ? 'good' : 'info');
          }}
        >
          <b>{ct('dayOptions.copyPrevious')}</b>
          <span>{ct('dayOptions.copyPreviousHint')}</span>
        </button>
        <button
          type="button"
          disabled={!d.blocks.length}
          onClick={() => {
            const before = d.blocks;
            void editDay(date, (x) => (x.blocks = []));
            close();
            toast(ct('dayOptions.cleared'), 'info', {
              label: ct('common.undo'),
              run: () => void editDay(date, (x) => (x.blocks = before)),
            });
          }}
        >
          <b>{ct('dayOptions.clear')}</b>
          <span>{ct('dayOptions.clearHint')}</span>
        </button>
      </div>
      <p class="muted cx-small">
        {ct('dayOptions.window', { start: hhmm(dayWindow.value.start), end: hhmm(dayWindow.value.end) })}
      </p>
    </Modal>
  );
}

/* used by the Planning header */
export function suggestStart(date: ISODate, len = 60): number | null {
  const win = dayWindow.value;
  const now = new Date();
  const from = date === today.value ? Math.max(win.start, now.getHours() * 60 + now.getMinutes()) : win.start;
  return freeSlot(getDay(date).blocks, len, from, win.end);
}
