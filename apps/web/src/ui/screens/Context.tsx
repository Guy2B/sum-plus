import { useEffect, useState } from 'preact/hooks';
import type { ContextProfile, Domain } from '../../domain/types';
import { create, settings, snapshot, updateSettings, clock } from '../../data/store';
import { isoDay, startOfWeek } from '../../domain/dates';
import { t, fmtDate } from '../../i18n';
import { Button, Card, Field, PageHeader, Toggle, attempt } from '../components';

const DAYS: ContextProfile['workDays'] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DOMAINS: Domain[] = [
  'calendar',
  'mail',
  'social',
  'finance',
  'health',
  'journal',
  'learning',
  'household',
  'career',
];

export function Context() {
  const [ctx, setCtx] = useState<ContextProfile>(settings.value.context);
  useEffect(() => setCtx(settings.value.context), [settings.value.context]);
  const dirty = JSON.stringify(ctx) !== JSON.stringify(settings.value.context);
  const set = <K extends keyof ContextProfile>(k: K, v: ContextProfile[K]) =>
    setCtx((c) => ({ ...c, [k]: v }));
  const v = (e: Event) => (e.currentTarget as HTMLInputElement).value;

  const save = (e: Event) => {
    e.preventDefault();
    void attempt(
      () =>
        updateSettings((s) => ({
          ...s,
          context: {
            ...ctx,
            primaryGoal: ctx.primaryGoal.slice(0, 200),
            secondaryGoal: ctx.secondaryGoal.slice(0, 200),
            successDefinition: ctx.successDefinition.slice(0, 500),
            fixedCommitments: ctx.fixedCommitments.slice(0, 1000),
            constraints: ctx.constraints.slice(0, 1000),
            focusHours: Math.min(14, Math.max(0.5, ctx.focusHours)),
            weeklyHours: Math.min(100, Math.max(1, ctx.weeklyHours)),
          },
        })),
      t('common.saved'),
    );
  };

  // Weekly check-in
  const weekOf = isoDay(startOfWeek(clock.value));
  const checkins = snapshot.value.checkins
    .filter((c) => !c.deletedAt)
    .sort((a, b) => b.weekOf.localeCompare(a.weekOf));
  const thisWeek = checkins.find((c) => c.weekOf === weekOf);
  const [wins, setWins] = useState('');
  const [blockers, setBlockers] = useState('');
  const [focusNext, setFocusNext] = useState('');
  const [energy, setEnergy] = useState(3);

  return (
    <div class="page">
      <PageHeader title={t('nav.context')} subtitle={t('context.subtitle')} />
      <form onSubmit={save}>
        <Card title={t('context.goals')}>
          <Field label={t('context.primaryGoal')} hint={t('context.primaryGoalHint')}>
            {(id) => (
              <input
                id={id}
                maxLength={200}
                value={ctx.primaryGoal}
                onInput={(e) => set('primaryGoal', v(e))}
              />
            )}
          </Field>
          <Field label={t('context.secondaryGoal')}>
            {(id) => (
              <input
                id={id}
                maxLength={200}
                value={ctx.secondaryGoal}
                onInput={(e) => set('secondaryGoal', v(e))}
              />
            )}
          </Field>
          <Field label={t('context.success')}>
            {(id) => (
              <textarea
                id={id}
                rows={2}
                maxLength={500}
                value={ctx.successDefinition}
                onInput={(e) => set('successDefinition', v(e))}
              />
            )}
          </Field>
        </Card>

        <Card title={t('context.rhythm')}>
          <div class="row">
            <Field label={t('context.workStart')}>
              {(id) => (
                <input
                  id={id}
                  type="time"
                  value={ctx.workStart}
                  onInput={(e) => set('workStart', v(e) || '09:00')}
                />
              )}
            </Field>
            <Field label={t('context.workEnd')}>
              {(id) => (
                <input
                  id={id}
                  type="time"
                  value={ctx.workEnd}
                  onInput={(e) => set('workEnd', v(e) || '18:00')}
                />
              )}
            </Field>
            <Field label={t('context.focusHours')}>
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={0.5}
                  max={14}
                  step={0.5}
                  value={ctx.focusHours}
                  onInput={(e) => set('focusHours', Number(v(e)) || 4)}
                />
              )}
            </Field>
            <Field label={t('context.weeklyHours')}>
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={100}
                  value={ctx.weeklyHours}
                  onInput={(e) => set('weeklyHours', Number(v(e)) || 35)}
                />
              )}
            </Field>
          </div>
          <fieldset class="days">
            <legend>{t('context.workDays')}</legend>
            {DAYS.map((d) => (
              <label key={d} class="day-toggle">
                <input
                  type="checkbox"
                  checked={ctx.workDays.includes(d)}
                  onChange={(e) =>
                    set(
                      'workDays',
                      (e.currentTarget as HTMLInputElement).checked
                        ? [...ctx.workDays, d]
                        : ctx.workDays.filter((x) => x !== d),
                    )
                  }
                />
                <span>{t(`day.${d}`)}</span>
              </label>
            ))}
          </fieldset>
          <div class="row">
            <Field label={t('context.energyPeak')}>
              {(id) => (
                <select
                  id={id}
                  value={ctx.energyPeak}
                  onChange={(e) => set('energyPeak', v(e) as ContextProfile['energyPeak'])}
                >
                  {(['morning', 'afternoon', 'evening'] as const).map((p) => (
                    <option key={p} value={p}>
                      {t(`context.peak.${p}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('context.tone')}>
              {(id) => (
                <select
                  id={id}
                  value={ctx.coachingTone}
                  onChange={(e) => set('coachingTone', v(e) as ContextProfile['coachingTone'])}
                >
                  {(['direct', 'balanced', 'gentle'] as const).map((p) => (
                    <option key={p} value={p}>
                      {t(`context.toneValue.${p}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Field label={t('context.commitments')}>
            {(id) => (
              <textarea
                id={id}
                rows={2}
                maxLength={1000}
                value={ctx.fixedCommitments}
                onInput={(e) => set('fixedCommitments', v(e))}
              />
            )}
          </Field>
          <Field label={t('context.constraints')}>
            {(id) => (
              <textarea
                id={id}
                rows={2}
                maxLength={1000}
                value={ctx.constraints}
                onInput={(e) => set('constraints', v(e))}
              />
            )}
          </Field>
        </Card>

        <Card title={t('context.permissions')}>
          <p class="small muted">{t('context.permissionsHint')}</p>
          <Toggle
            label={t('context.crossAnalysis')}
            hint={t('context.crossAnalysisHint')}
            checked={ctx.allowCrossAnalysis}
            onChange={(x) => set('allowCrossAnalysis', x)}
          />
          {DOMAINS.map((d) => (
            <Toggle
              key={d}
              label={t(`domain.${d}`)}
              checked={ctx.includedDomains[d]}
              onChange={(x) => set('includedDomains', { ...ctx.includedDomains, [d]: x })}
            />
          ))}
        </Card>

        <div class="sticky-save">
          <Button type="submit" variant="primary" disabled={!dirty}>
            {dirty ? t('common.save') : t('common.saved')}
          </Button>
        </div>
      </form>

      <Card title={t('context.checkinTitle', { date: fmtDate(weekOf) })}>
        {thisWeek ? (
          <p class="muted">{t('context.checkinDone')}</p>
        ) : (
          <form
            class="form"
            onSubmit={(e) => {
              e.preventDefault();
              void attempt(async () => {
                await create('checkins', {
                  weekOf,
                  wins: wins.slice(0, 2000),
                  blockers: blockers.slice(0, 2000),
                  focusNext: focusNext.slice(0, 2000),
                  energy,
                });
                setWins('');
                setBlockers('');
                setFocusNext('');
              }, t('common.saved'));
            }}
          >
            <Field label={t('context.wins')}>
              {(id) => <textarea id={id} rows={2} value={wins} onInput={(e) => setWins(v(e))} />}
            </Field>
            <Field label={t('context.blockers')}>
              {(id) => <textarea id={id} rows={2} value={blockers} onInput={(e) => setBlockers(v(e))} />}
            </Field>
            <Field label={t('context.focusNext')}>
              {(id) => <textarea id={id} rows={2} value={focusNext} onInput={(e) => setFocusNext(v(e))} />}
            </Field>
            <Field label={t('context.weekEnergy', { value: energy })}>
              {(id) => (
                <input
                  id={id}
                  type="range"
                  min={1}
                  max={5}
                  value={energy}
                  onInput={(e) => setEnergy(Number(v(e)))}
                />
              )}
            </Field>
            <Button type="submit" variant="primary">
              {t('common.save')}
            </Button>
          </form>
        )}
        {checkins.length > 0 && (
          <details>
            <summary>{t('context.history', { count: checkins.length })}</summary>
            <ul class="plain-list">
              {checkins.slice(0, 12).map((c) => (
                <li key={c.id}>
                  <strong>{fmtDate(c.weekOf)}</strong> — {c.focusNext || c.wins}{' '}
                  <small class="muted">({t('context.energyShort', { value: c.energy })})</small>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </div>
  );
}
