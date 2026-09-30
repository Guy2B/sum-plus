/**
 * "No longer moving": stagnant tasks, projects and missions with the facts
 * that make them stagnant, and three ways out — define the smallest next step
 * (unblock), reschedule, or let it go.
 */
import { useState } from 'preact/hooks';
import { detectStagnation, type Stagnant } from '../domain/stagnation';
import { addDays, isoDay } from '../domain/dates';
import { clock, create, snapshot, update } from '../data/store';
import { t } from '../i18n';
import { Button, attempt } from './components';
import { deleteWithUndo } from './screens/Tasks';

function Item({ s }: { s: Stagnant }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState('');
  const today = isoDay(clock.value);
  const facts = [
    s.days > 0 && t('stagnant.days', { count: s.days }),
    s.deferrals > 0 && t('stagnant.deferrals', { count: s.deferrals }),
    s.noNextStep && t('stagnant.noNext'),
  ].filter(Boolean);

  const unblock = async (e: Event) => {
    e.preventDefault();
    if (!step.trim()) return;
    const project = s.kind === 'project' ? s.id : snapshot.value.tasks.find((x) => x.id === s.id)?.projectId;
    await attempt(async () => {
      await create('tasks', {
        title: step.trim().slice(0, 300),
        category: 'work',
        status: 'todo',
        priority: 'high',
        dueDate: today,
        scheduledFor: 'today',
        estimateMinutes: 15,
        projectId: project ?? null,
      });
      setOpen(false);
      setStep('');
    }, t('stagnant.unblocked'));
  };

  const reschedule = () =>
    void attempt(async () => {
      if (s.kind === 'task')
        await update('tasks', s.id, { dueDate: isoDay(addDays(clock.value, 7)), essential: false });
      if (s.kind === 'mission')
        await update('missions', s.id, { targetDate: isoDay(addDays(clock.value, 14)) });
      if (s.kind === 'project') await update('projects', s.id, { dueDate: isoDay(addDays(clock.value, 30)) });
    }, t('stagnant.rescheduled'));

  const letGo = () =>
    void attempt(async () => {
      if (s.kind === 'task') await deleteWithUndo('tasks', s.id, s.title);
      if (s.kind === 'mission') await update('missions', s.id, { status: 'archived' });
      if (s.kind === 'project') await update('projects', s.id, { status: 'paused' });
    }, t('stagnant.released'));

  return (
    <li class="stagnant">
      <div class="stagnant-head">
        <span aria-hidden="true">⚠️</span>
        <div>
          <strong>{s.title}</strong>
          <p class="small muted">
            {t(`stagnant.kind.${s.kind}`)} · {facts.join(' · ')}
          </p>
        </div>
      </div>
      {open ? (
        <form class="inline-form" onSubmit={unblock}>
          <input
            value={step}
            maxLength={300}
            aria-label={t('stagnant.stepLabel')}
            placeholder={t('stagnant.stepPlaceholder')}
            onInput={(e) => setStep((e.currentTarget as HTMLInputElement).value)}
          />
          <Button type="submit" size="sm" variant="primary">
            {t('stagnant.addStep')}
          </Button>
        </form>
      ) : (
        <div class="row-actions">
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
            {t('stagnant.unblock')}
          </Button>
          <Button size="sm" variant="ghost" onClick={reschedule}>
            {t('stagnant.reschedule')}
          </Button>
          <Button size="sm" variant="ghost" onClick={letGo}>
            {t('stagnant.letGo')}
          </Button>
        </div>
      )}
    </li>
  );
}

export function StagnationPanel() {
  const items = detectStagnation(snapshot.value, clock.value);
  if (!items.length) return null;
  return (
    <section class="card stagnation" aria-labelledby="stagnation-title">
      <h2 id="stagnation-title">{t('stagnant.title')}</h2>
      <p class="small muted">{t('stagnant.subtitle')}</p>
      <ul class="plain-list">
        {items.map((s) => (
          <Item key={`${s.kind}-${s.id}`} s={s} />
        ))}
      </ul>
    </section>
  );
}
