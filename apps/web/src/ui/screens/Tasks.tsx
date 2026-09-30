import { useEffect, useState } from 'preact/hooks';
import type { Priority, Task, TaskCategory } from '../../domain/types';
import { create, remove, restore, snapshot, update, clock, settings } from '../../data/store';
import { isTodayTask } from '../../domain/planning';
import { isoDay, toDate, addDays } from '../../domain/dates';
import { getEdition } from '../../domain/editions';
import { t, fmtDate, fmtMinutes } from '../../i18n';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  IconButton,
  Modal,
  PageHeader,
  Tabs,
  toast,
  attempt,
} from '../components';
import { route } from '../router';

type View = 'today' | 'inbox' | 'all' | 'week' | 'matrix' | 'done';
const CATEGORIES: TaskCategory[] = ['work', 'home', 'health', 'projects', 'admin', 'learning', 'family'];
const PRIORITIES: Priority[] = ['high', 'medium', 'low'];

const alive = (x: Task) => !x.deletedAt;

export async function deleteWithUndo(collection: Parameters<typeof remove>[0], id: string, label: string) {
  await remove(collection, id);
  toast(t('common.deleted', { label }), 'info', {
    label: t('common.undo'),
    run: () => void restore(collection, id),
  });
}

function TaskEditor({ task, onClose }: { task: Partial<Task> | null; onClose: () => void }) {
  const [form, setForm] = useState<Partial<Task>>(task ?? {});
  useEffect(() => setForm(task ?? {}), [task]);
  const set = <K extends keyof Task>(k: K, v: Task[K]) => setForm((f) => ({ ...f, [k]: v }));
  const projects = snapshot.value.projects.filter((p) => !p.deletedAt && p.status === 'active');
  const goals = snapshot.value.goals.filter((g) => !g.deletedAt && g.status === 'active');
  const save = async (e: Event) => {
    e.preventDefault();
    const title = (form.title ?? '').trim();
    if (!title) return;
    const fields = {
      title: title.slice(0, 300),
      notes: (form.notes ?? '').slice(0, 5000),
      category: form.category ?? 'work',
      priority: form.priority ?? 'medium',
      dueDate: form.dueDate || null,
      estimateMinutes: form.estimateMinutes || undefined,
      urgent: Boolean(form.urgent),
      important: Boolean(form.important),
      essential: Boolean(form.essential),
      projectId: form.projectId || null,
      goalId: form.goalId || null,
      scheduledFor: form.scheduledFor ?? null,
    };
    await attempt(
      async () => {
        if (form.id) await update('tasks', form.id, fields);
        else
          await create('tasks', { ...fields, status: fields.dueDate || fields.essential ? 'todo' : 'inbox' });
        onClose();
      },
      form.id ? t('common.saved') : t('tasks.added'),
    );
  };
  const v = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  return (
    <Modal open={task !== null} onClose={onClose} title={form.id ? t('tasks.edit') : t('tasks.new')}>
      <form onSubmit={save} class="form">
        <Field label={t('tasks.title')}>
          {(id) => (
            <input
              id={id}
              required
              maxLength={300}
              value={form.title ?? ''}
              onInput={(e) => set('title', v(e))}
            />
          )}
        </Field>
        <div class="row">
          <Field label={t('tasks.category')}>
            {(id) => (
              <select
                id={id}
                value={form.category ?? 'work'}
                onChange={(e) => set('category', v(e) as TaskCategory)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`category.${c}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('tasks.priority')}>
            {(id) => (
              <select
                id={id}
                value={form.priority ?? 'medium'}
                onChange={(e) => set('priority', v(e) as Priority)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`priority.${p}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div class="row">
          <Field label={t('tasks.due')}>
            {(id) => (
              <input
                id={id}
                type="date"
                value={(form.dueDate ?? '').slice(0, 10)}
                onInput={(e) => set('dueDate', v(e) || null)}
              />
            )}
          </Field>
          <Field label={t('tasks.estimate')}>
            {(id) => (
              <select
                id={id}
                value={String(form.estimateMinutes ?? '')}
                onChange={(e) => set('estimateMinutes', Number(v(e)) || undefined)}
              >
                <option value="">—</option>
                {[5, 15, 30, 45, 60, 90, 120, 180].map((m) => (
                  <option key={m} value={m}>
                    {fmtMinutes(m)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div class="row">
          <Field label={t('tasks.project')}>
            {(id) => (
              <select id={id} value={form.projectId ?? ''} onChange={(e) => set('projectId', v(e) || null)}>
                <option value="">—</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('tasks.goal')}>
            {(id) => (
              <select id={id} value={form.goalId ?? ''} onChange={(e) => set('goalId', v(e) || null)}>
                <option value="">—</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <fieldset class="checks">
          <legend class="sr-only">{t('tasks.flags')}</legend>
          <label>
            <input
              type="checkbox"
              checked={Boolean(form.urgent)}
              onChange={(e) => set('urgent', (e.currentTarget as HTMLInputElement).checked)}
            />{' '}
            {t('tasks.urgent')}
          </label>
          <label>
            <input
              type="checkbox"
              checked={Boolean(form.important)}
              onChange={(e) => set('important', (e.currentTarget as HTMLInputElement).checked)}
            />{' '}
            {t('tasks.important')}
          </label>
          <label>
            <input
              type="checkbox"
              checked={Boolean(form.essential)}
              onChange={(e) => set('essential', (e.currentTarget as HTMLInputElement).checked)}
            />{' '}
            {t('tasks.essential')}
          </label>
        </fieldset>
        <Field label={t('tasks.notes')}>
          {(id) => (
            <textarea
              id={id}
              rows={3}
              maxLength={5000}
              value={form.notes ?? ''}
              onInput={(e) => set('notes', v(e))}
            />
          )}
        </Field>
        <div class="modal-actions">
          {form.id && (
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                void deleteWithUndo('tasks', form.id!, form.title ?? '');
                onClose();
              }}
            >
              {t('common.delete')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TaskRow({ task, onEdit }: { task: Task; onEdit: (t: Task) => void }) {
  const now = clock.value;
  const due = toDate(task.dueDate);
  const overdue = task.status !== 'done' && due && due < now;
  const toggle = () =>
    void update(
      'tasks',
      task.id,
      task.status === 'done'
        ? { status: 'todo', completedAt: null }
        : { status: 'done', completedAt: new Date().toISOString(), essential: false },
    );
  return (
    <li class={`task-row ${task.status === 'done' ? 'done' : ''}`}>
      <input
        type="checkbox"
        checked={task.status === 'done'}
        onChange={toggle}
        aria-label={t('tasks.toggle', { title: task.title })}
      />
      <button type="button" class="task-title" onClick={() => onEdit(task)}>
        {task.essential && (
          <span class="essential-dot" title={t('tasks.essential')} aria-label={t('tasks.essential')} />
        )}
        {task.title}
      </button>
      <span class="task-meta">
        {task.priority === 'high' && <Badge tone="warn">{t('priority.high')}</Badge>}
        {task.source?.provider && task.source.provider !== 'demo' && <Badge>{task.source.provider}</Badge>}
        {due && <span class={overdue ? 'bad-text small' : 'muted small'}>{fmtDate(due)}</span>}
        {task.estimateMinutes && <span class="muted small">{fmtMinutes(task.estimateMinutes)}</span>}
      </span>
      {task.status !== 'done' && (
        <IconButton
          icon="star"
          label={task.essential ? t('tasks.unmarkEssential') : t('tasks.markEssential')}
          class={task.essential ? 'on' : ''}
          onClick={() =>
            void update('tasks', task.id, {
              essential: !task.essential,
              status: task.status === 'inbox' ? 'todo' : task.status,
            })
          }
        />
      )}
    </li>
  );
}

export function Tasks() {
  const [view, setView] = useState<View>('today');
  const [editing, setEditing] = useState<Partial<Task> | null>(null);
  const now = clock.value;
  const ed = getEdition(settings.value.edition, settings.value.locale);
  const all = snapshot.value.tasks.filter(alive);
  const open = all.filter((x) => x.status !== 'done');
  const byDue = (a: Task, b: Task) =>
    (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.createdAt.localeCompare(a.createdAt);

  useEffect(() => {
    const id = route.value.param;
    if (id) {
      const found = all.find((x) => x.id === id);
      if (found) setEditing(found);
    }
  }, [route.value.param]);

  const lists: Record<View, Task[]> = {
    today: open.filter((x) => isTodayTask(x, now)).sort(byDue),
    inbox: open.filter((x) => x.status === 'inbox').sort(byDue),
    all: open.sort(byDue),
    week: open
      .filter((x) => {
        const d = toDate(x.dueDate);
        return x.scheduledFor === 'week' || (d && d <= addDays(now, 7));
      })
      .sort(byDue),
    matrix: open,
    done: all
      .filter((x) => x.status === 'done')
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
      .slice(0, 100),
  };

  const quadrant = (u: boolean, i: boolean) =>
    open.filter(
      (x) =>
        Boolean(x.urgent || x.priority === 'high') === u &&
        Boolean(x.important || x.priority === 'high' || x.essential) === i,
    );

  return (
    <div class="page">
      <PageHeader
        title={ed.nav.tasks}
        subtitle={t('tasks.subtitle')}
        actions={
          <Button
            variant="primary"
            icon="plus"
            onClick={() => setEditing({ category: 'work', priority: 'medium', dueDate: isoDay(now) })}
          >
            {t('tasks.new')}
          </Button>
        }
      />
      <Tabs
        label={t('tasks.views')}
        value={view}
        onChange={setView}
        options={(['today', 'inbox', 'week', 'all', 'matrix', 'done'] as View[]).map((v) => ({
          value: v,
          label: t(`tasks.view.${v}`),
          count: v === 'matrix' ? undefined : lists[v].length,
        }))}
      />
      {view === 'matrix' ? (
        <div class="matrix">
          {(
            [
              [true, true],
              [false, true],
              [true, false],
              [false, false],
            ] as const
          ).map(([u, i]) => (
            <Card
              key={`${u}${i}`}
              title={t(`tasks.quadrant.${u ? 'u' : 'n'}${i ? 'i' : 'n'}`)}
              class="quadrant"
            >
              <ul class="task-list">
                {quadrant(u, i).map((x) => (
                  <TaskRow key={x.id} task={x} onEdit={setEditing} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          {lists[view].length ? (
            <ul class="task-list">
              {lists[view].map((x) => (
                <TaskRow key={x.id} task={x} onEdit={setEditing} />
              ))}
            </ul>
          ) : (
            <Empty
              icon="check"
              title={t(`tasks.empty.${view}`)}
              body={view === 'today' ? t('tasks.emptyTodayHint') : undefined}
            />
          )}
        </Card>
      )}
      <TaskEditor task={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
