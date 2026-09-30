import { useEffect, useState } from 'preact/hooks';
import type { Project } from '../../domain/types';
import { create, snapshot, update, entitlement, settings } from '../../data/store';
import { projectNextStep, projectProgress, isStalled } from '../../domain/learning';
import { withinLimit, FREE_LIMITS } from '../../domain/entitlements';
import { getEdition } from '../../domain/editions';
import { parseAmount } from '../../domain/finance';
import { newId } from '../../domain/ids';
import { t, fmtDate, fmtMoney } from '../../i18n';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  IconButton,
  Modal,
  PageHeader,
  Progress,
  attempt,
} from '../components';
import { route, navigate } from '../router';
import { deleteWithUndo } from './Tasks';

function ProjectEditor({ project, onClose }: { project: Partial<Project> | null; onClose: () => void }) {
  const [form, setForm] = useState<Partial<Project>>(project ?? {});
  const [value, setValue] = useState('');
  useEffect(() => {
    setForm(project ?? {});
    setValue(project?.value ? String(project.value / 100) : '');
  }, [project]);
  const v = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  const save = async (e: Event) => {
    e.preventDefault();
    const name = (form.name ?? '').trim();
    if (!name) return;
    const fields = {
      name: name.slice(0, 200),
      description: (form.description ?? '').slice(0, 5000),
      client: (form.client ?? '').slice(0, 200),
      status: form.status ?? 'active',
      dueDate: form.dueDate || null,
      value: value ? parseAmount(value) : null,
      milestones: form.milestones ?? [],
    };
    await attempt(async () => {
      if (form.id) await update('projects', form.id, fields);
      else await create('projects', fields);
      onClose();
    }, t('common.saved'));
  };
  return (
    <Modal open={project !== null} onClose={onClose} title={form.id ? t('projects.edit') : t('projects.new')}>
      <form class="form" onSubmit={save}>
        <Field label={t('projects.name')}>
          {(id) => (
            <input
              id={id}
              required
              maxLength={200}
              value={form.name ?? ''}
              onInput={(e) => setForm({ ...form, name: v(e) })}
            />
          )}
        </Field>
        <div class="row">
          <Field label={t('projects.client')}>
            {(id) => (
              <input
                id={id}
                maxLength={200}
                value={form.client ?? ''}
                onInput={(e) => setForm({ ...form, client: v(e) })}
              />
            )}
          </Field>
          <Field label={t('projects.value')} hint={settings.value.currency}>
            {(id) => <input id={id} inputMode="decimal" value={value} onInput={(e) => setValue(v(e))} />}
          </Field>
        </div>
        <div class="row">
          <Field label={t('projects.due')}>
            {(id) => (
              <input
                id={id}
                type="date"
                value={form.dueDate ?? ''}
                onInput={(e) => setForm({ ...form, dueDate: v(e) || null })}
              />
            )}
          </Field>
          <Field label={t('projects.status')}>
            {(id) => (
              <select
                id={id}
                value={form.status ?? 'active'}
                onChange={(e) => setForm({ ...form, status: v(e) as Project['status'] })}
              >
                {(['active', 'paused', 'done'] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(`projects.statusValue.${s}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field label={t('projects.description')}>
          {(id) => (
            <textarea
              id={id}
              rows={3}
              maxLength={5000}
              value={form.description ?? ''}
              onInput={(e) => setForm({ ...form, description: v(e) })}
            />
          )}
        </Field>
        <div class="modal-actions">
          {form.id && (
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                void deleteWithUndo('projects', form.id!, form.name ?? '');
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

function ProjectCard({ p, onEdit }: { p: Project; onEdit: () => void }) {
  const [milestone, setMilestone] = useState('');
  const tasks = snapshot.value.tasks;
  const progress = projectProgress(p, tasks);
  const next = projectNextStep(p, tasks);
  const linked = tasks.filter((x) => !x.deletedAt && x.projectId === p.id && x.status !== 'done').length;
  const setMilestones = (milestones: Project['milestones']) => void update('projects', p.id, { milestones });
  return (
    <Card
      title={p.name}
      actions={
        <>
          <Badge tone={p.status === 'active' ? 'accent' : 'neutral'}>
            {t(`projects.statusValue.${p.status}`)}
          </Badge>
          <IconButton icon="edit" label={t('common.edit')} onClick={onEdit} />
        </>
      }
    >
      <p class="muted small">
        {[
          p.client,
          p.dueDate && t('projects.dueOn', { date: fmtDate(p.dueDate) }),
          p.value && fmtMoney(p.value),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <Progress value={progress} label={t('projects.progress')} />
      <p class="small">
        {next ? (
          t('projects.next', { step: next })
        ) : isStalled(p, tasks) ? (
          <span class="warn-text">{t('projects.stalled')}</span>
        ) : (
          t('projects.complete')
        )}
        {linked > 0 && <span class="muted"> · {t('projects.linkedTasks', { count: linked })}</span>}
      </p>
      <ul class="check-list">
        {p.milestones.map((m) => (
          <li key={m.id}>
            <label>
              <input
                type="checkbox"
                checked={m.done}
                onChange={() =>
                  setMilestones(p.milestones.map((x) => (x.id === m.id ? { ...x, done: !x.done } : x)))
                }
              />
              <span class={m.done ? 'strike' : ''}>{m.title}</span>
              {m.dueDate && <small class="muted"> · {fmtDate(m.dueDate)}</small>}
            </label>
            <IconButton
              icon="x"
              label={t('common.delete')}
              onClick={() => setMilestones(p.milestones.filter((x) => x.id !== m.id))}
            />
          </li>
        ))}
      </ul>
      <form
        class="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!milestone.trim()) return;
          setMilestones([
            ...p.milestones,
            { id: newId(), title: milestone.trim().slice(0, 200), done: false },
          ]);
          setMilestone('');
        }}
      >
        <input
          aria-label={t('projects.addMilestone')}
          placeholder={t('projects.addMilestone')}
          value={milestone}
          maxLength={200}
          onInput={(e) => setMilestone((e.currentTarget as HTMLInputElement).value)}
        />
        <Button type="submit" size="sm" icon="plus">
          {t('common.add')}
        </Button>
      </form>
    </Card>
  );
}

export function Projects() {
  const [editing, setEditing] = useState<Partial<Project> | null>(null);
  const ed = getEdition(settings.value.edition, settings.value.locale);
  const projects = snapshot.value.projects.filter((p) => !p.deletedAt);
  const active = projects.filter((p) => p.status !== 'done');
  const canAdd = withinLimit('projects', active.length, entitlement.value);

  useEffect(() => {
    const found = projects.find((p) => p.id === route.value.param);
    if (found) setEditing(found);
  }, [route.value.param]);

  const add = (name = '') =>
    canAdd ? setEditing({ name, status: 'active', milestones: [] }) : navigate('account', 'plan');

  return (
    <div class="page">
      <PageHeader
        title={ed.nav.projects}
        subtitle={t('projects.subtitle')}
        actions={
          <Button variant="primary" icon={canAdd ? 'plus' : 'lock'} onClick={() => add()}>
            {t('projects.new')}
          </Button>
        }
      />
      {!canAdd && <p class="notice">{t('projects.limit', { max: FREE_LIMITS.projects })}</p>}
      {active.length ? (
        <div class="grid grid-2">
          {active.map((p) => (
            <ProjectCard key={p.id} p={p} onEdit={() => setEditing(p)} />
          ))}
        </div>
      ) : (
        <Card>
          <Empty icon="folder" title={t('projects.empty')} body={t('projects.templatesHint')} />
          <div class="chips">
            {ed.templates.map((tpl) => (
              <button key={tpl} type="button" class="chip" onClick={() => add(tpl)}>
                {tpl}
              </button>
            ))}
          </div>
        </Card>
      )}
      {projects.some((p) => p.status === 'done') && (
        <Card title={t('projects.archived')}>
          <ul class="plain-list">
            {projects
              .filter((p) => p.status === 'done')
              .map((p) => (
                <li key={p.id}>
                  <button type="button" class="link" onClick={() => setEditing(p)}>
                    {p.name}
                  </button>
                </li>
              ))}
          </ul>
        </Card>
      )}
      <ProjectEditor project={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
