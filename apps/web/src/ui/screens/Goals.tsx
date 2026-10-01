import { useEffect, useState } from 'preact/hooks';
import { LimitNotice } from '../pro';
import type { Goal, Habit } from '../../domain/types';
import { create, snapshot, update, clock, entitlement, remove } from '../../data/store';
import { habitDueOn, habitStreak } from '../../domain/wellbeing';
import { withinLimit, FREE_LIMITS } from '../../domain/entitlements';
import { isoDay, addDays } from '../../domain/dates';
import { t, fmtDate } from '../../i18n';
import { Button, Card, Empty, Field, IconButton, Modal, PageHeader, Progress, attempt } from '../components';
import { Icon } from '../icons';
import { navigate } from '../router';
import { deleteWithUndo } from './Tasks';

function GoalEditor({ goal, onClose }: { goal: Partial<Goal> | null; onClose: () => void }) {
  const [f, setF] = useState<Partial<Goal>>({});
  useEffect(() => setF(goal ?? {}), [goal]);
  const v = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  const save = async (e: Event) => {
    e.preventDefault();
    const title = (f.title ?? '').trim();
    if (!title) return;
    const fields = {
      title: title.slice(0, 200),
      why: (f.why ?? '').slice(0, 1000),
      horizon: f.horizon ?? 'month',
      metric: (f.metric ?? '').slice(0, 100),
      targetValue: f.targetValue ?? 100,
      currentValue: f.currentValue ?? 0,
      dueDate: f.dueDate ?? null,
      status: f.status ?? 'active',
    };
    await attempt(async () => {
      if (goal?.id) await update('goals', goal.id, fields);
      else await create('goals', fields);
      onClose();
    }, t('common.saved'));
  };
  const val = <K extends keyof Goal>(k: K) => f[k] as Goal[K];
  return (
    <Modal open={goal !== null} onClose={onClose} title={goal?.id ? t('goals.edit') : t('goals.new')}>
      <form class="form" onSubmit={save}>
        <Field label={t('goals.title')}>
          {(id) => (
            <input
              id={id}
              required
              maxLength={200}
              value={val('title') ?? ''}
              onInput={(e) => setF({ ...f, title: v(e) })}
            />
          )}
        </Field>
        <Field label={t('goals.why')}>
          {(id) => (
            <textarea
              id={id}
              rows={2}
              maxLength={1000}
              value={val('why') ?? ''}
              onInput={(e) => setF({ ...f, why: v(e) })}
            />
          )}
        </Field>
        <div class="row">
          <Field label={t('goals.horizon')}>
            {(id) => (
              <select
                id={id}
                value={val('horizon') ?? 'month'}
                onChange={(e) => setF({ ...f, horizon: v(e) as Goal['horizon'] })}
              >
                {(['week', 'month', 'quarter', 'year'] as const).map((h) => (
                  <option key={h} value={h}>
                    {t(`goals.horizonValue.${h}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('goals.due')}>
            {(id) => (
              <input
                id={id}
                type="date"
                value={val('dueDate') ?? ''}
                onInput={(e) => setF({ ...f, dueDate: v(e) || null })}
              />
            )}
          </Field>
        </div>
        <div class="row">
          <Field label={t('goals.metric')} hint={t('goals.metricHint')}>
            {(id) => (
              <input
                id={id}
                maxLength={100}
                value={val('metric') ?? ''}
                onInput={(e) => setF({ ...f, metric: v(e) })}
              />
            )}
          </Field>
          <Field label={t('goals.current')}>
            {(id) => (
              <input
                id={id}
                type="number"
                value={val('currentValue') ?? 0}
                onInput={(e) => setF({ ...f, currentValue: Number(v(e)) })}
              />
            )}
          </Field>
          <Field label={t('goals.target')}>
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                value={val('targetValue') ?? 100}
                onInput={(e) => setF({ ...f, targetValue: Number(v(e)) || 1 })}
              />
            )}
          </Field>
        </div>
        <div class="modal-actions">
          {goal?.id && (
            <Button
              variant="ghost"
              onClick={() => void update('goals', goal.id!, { status: 'achieved' }).then(onClose)}
            >
              {t('goals.markAchieved')}
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

export function Goals() {
  const [goal, setGoal] = useState<Partial<Goal> | null>(null);
  const [habitName, setHabitName] = useState('');
  const [cadence, setCadence] = useState<Habit['cadence']>('daily');
  const now = clock.value;
  const today = isoDay(now);
  const goals = snapshot.value.goals.filter((g) => !g.deletedAt && g.status === 'active');
  const achieved = snapshot.value.goals.filter((g) => !g.deletedAt && g.status === 'achieved');
  const habits = snapshot.value.habits.filter((h) => !h.deletedAt && !h.archived);
  const logs = snapshot.value.habitLogs.filter((l) => !l.deletedAt);
  const canAddHabit = withinLimit('habits', habits.length, entitlement.value);
  const tasks = snapshot.value.tasks.filter((x) => !x.deletedAt);
  const week = Array.from({ length: 7 }, (_, i) => addDays(now, i - 6));

  return (
    <div class="page">
      <PageHeader
        title={t('nav.goals')}
        subtitle={t('goals.subtitle')}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setGoal({})}>
            {t('goals.new')}
          </Button>
        }
      />
      <Card title={t('goals.active')}>
        {goals.length ? (
          <ul class="goal-list">
            {goals.map((g) => {
              const pct = g.targetValue ? Math.round(((g.currentValue ?? 0) / g.targetValue) * 100) : 0;
              const linked = tasks.filter((x) => x.goalId === g.id && x.status !== 'done').length;
              return (
                <li key={g.id}>
                  <div class="goal-head">
                    <button type="button" class="link-title" onClick={() => setGoal(g)}>
                      {g.title}
                    </button>
                    <span class="muted small">
                      {t(`goals.horizonValue.${g.horizon}`)}
                      {g.dueDate && ` · ${fmtDate(g.dueDate)}`}
                      {linked > 0 && ` · ${t('goals.linkedTasks', { count: linked })}`}
                    </span>
                  </div>
                  <Progress value={pct} label={g.title} />
                  <span class="small muted">
                    {g.currentValue ?? 0} / {g.targetValue ?? 100} {g.metric}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty icon="target" title={t('goals.empty')} />
        )}
      </Card>

      <Card title={t('habits.title')}>
        {habits.length ? (
          <table class="habit-table">
            <thead>
              <tr>
                <th scope="col">{t('habits.habit')}</th>
                {week.map((d) => (
                  <th key={isoDay(d)} scope="col" class="small muted">
                    {fmtDate(d, { weekday: 'narrow' })}
                  </th>
                ))}
                <th scope="col">{t('habits.streak')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {habits.map((h) => (
                <tr key={h.id}>
                  <th scope="row">
                    {h.name}
                    <small class="muted"> · {t(`habits.cadence.${h.cadence}`)}</small>
                  </th>
                  {week.map((d) => {
                    const key = isoDay(d);
                    const log = logs.find((l) => l.habitId === h.id && l.date === key);
                    const due = habitDueOn(h, d) || h.cadence === 'weekly';
                    return (
                      <td key={key}>
                        <input
                          type="checkbox"
                          disabled={!due || key > today}
                          checked={Boolean(log)}
                          aria-label={`${h.name} ${fmtDate(d)}`}
                          onChange={() =>
                            void (log
                              ? remove('habitLogs', log.id)
                              : create('habitLogs', { habitId: h.id, date: key }))
                          }
                        />
                      </td>
                    );
                  })}
                  <td>
                    <Icon name="flame" size={14} /> {habitStreak(h, logs, now)}
                  </td>
                  <td>
                    <IconButton
                      icon="trash"
                      label={t('common.delete')}
                      onClick={() => void deleteWithUndo('habits', h.id, h.name)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="muted">{t('habits.empty')}</p>
        )}
        <form
          class="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canAddHabit) return navigate('account', 'plan');
            if (!habitName.trim()) return;
            void create('habits', { name: habitName.trim().slice(0, 100), cadence, domain: 'personal' }).then(
              () => setHabitName(''),
            );
          }}
        >
          <input
            aria-label={t('habits.new')}
            placeholder={t('habits.new')}
            maxLength={100}
            value={habitName}
            onInput={(e) => setHabitName((e.currentTarget as HTMLInputElement).value)}
          />
          <select
            aria-label={t('habits.cadenceLabel')}
            value={cadence}
            onChange={(e) => setCadence((e.currentTarget as HTMLSelectElement).value as Habit['cadence'])}
          >
            {(['daily', 'weekdays', 'weekly'] as const).map((c) => (
              <option key={c} value={c}>
                {t(`habits.cadence.${c}`)}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" icon={canAddHabit ? 'plus' : 'lock'}>
            {t('common.add')}
          </Button>
        </form>
        {!canAddHabit && <LimitNotice from="habits" text={t('habits.limit', { max: FREE_LIMITS.habits })} />}
      </Card>

      {achieved.length > 0 && (
        <Card title={t('goals.achieved')}>
          <ul class="plain-list">
            {achieved.map((g) => (
              <li key={g.id}>✓ {g.title}</li>
            ))}
          </ul>
        </Card>
      )}
      <GoalEditor goal={goal} onClose={() => setGoal(null)} />
    </div>
  );
}
