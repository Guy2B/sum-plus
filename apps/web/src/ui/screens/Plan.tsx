import { capacity, dayBlocks, settings, snapshot, clock, update } from '../../data/store';
import { visibleTop } from '../../data/actions';
import { findConflicts, isTodayTask } from '../../domain/planning';
import { t, fmtTime, fmtMinutes, fmtLongDate } from '../../i18n';
import { Badge, Card, Empty, PageHeader, Progress, Stat, Button } from '../components';
import { DecisionCard } from '../decision-card';
import { navigate } from '../router';
import { isoDay } from '../../domain/dates';

export function Plan() {
  const cap = capacity.value;
  const top = visibleTop.value;
  const blocks = dayBlocks.value;
  const now = clock.value;
  const today = isoDay(now);
  const conflicts = findConflicts(snapshot.value.events.filter((e) => e.start.slice(0, 10) >= today)).slice(
    0,
    5,
  );
  const todayTasks = snapshot.value.tasks.filter((x) => isTodayTask(x, now));
  const essentials = snapshot.value.tasks.filter((x) => !x.deletedAt && x.essential && x.status !== 'done');
  const ctx = settings.value.context;

  return (
    <div class="page">
      <PageHeader eyebrow={fmtLongDate(now)} title={t('nav.plan')} subtitle={t('plan.subtitle')} />

      <Card
        id="plan-capacity"
        title={t('plan.capacityTitle')}
        actions={
          <a href="#context" class="link">
            {t('plan.adjust')}
          </a>
        }
      >
        <div class="stats">
          <Stat
            label={t('plan.focusWindow')}
            value={`${ctx.workStart}–${ctx.workEnd}`}
            detail={t(`context.peak.${ctx.energyPeak}`)}
          />
          <Stat label={t('plan.meetingsLabel')} value={fmtMinutes(cap.meetingMinutes)} />
          <Stat
            label={t('plan.available')}
            value={fmtMinutes(cap.capacityMinutes)}
            detail={
              cap.energyMeasured
                ? t('plan.energyFactor', { pct: Math.round(cap.energyFactor * 100) })
                : t('plan.energyUnknown')
            }
          />
          <Stat
            label={t('plan.planned')}
            value={fmtMinutes(cap.plannedMinutes)}
            tone={cap.status === 'overloaded' ? 'bad' : cap.status === 'light' ? 'good' : undefined}
            detail={t(`plan.status.${cap.status}`, { pct: cap.loadPct })}
          />
        </div>
        <Progress value={Math.min(100, cap.loadPct)} label={t('plan.load')} />
        {cap.status === 'overloaded' && (
          <p class="warn-text small">{t('plan.overloadAdvice', { count: todayTasks.length })}</p>
        )}
      </Card>

      <Card id="outcomes" title={t('plan.outcomes')}>
        {top.selected.length ? (
          <div class="decision-list">
            {top.selected.map((d, i) => (
              <DecisionCard key={d.signal.id} d={d} rank={i + 1} compact />
            ))}
          </div>
        ) : (
          <Empty
            title={t('plan.noOutcomes')}
            action={<Button onClick={() => navigate('tasks')}>{t('today.addTask')}</Button>}
          />
        )}
        {essentials.length > 3 && (
          <p class="warn-text small">{t('plan.tooManyEssentials', { count: essentials.length })}</p>
        )}
      </Card>

      <Card id="blocks" title={t('plan.schedule')}>
        {blocks.length ? (
          <ol class="schedule">
            {blocks.map((b) => (
              <li key={`${b.start}-${b.kind}`} class={`block block-${b.kind}`}>
                <time>
                  {fmtTime(b.start)}–{fmtTime(b.end)}
                </time>
                <span>{b.titleKey ? t(b.titleKey, b.titleParams) : b.title}</span>
                <Badge tone={b.kind === 'event' ? 'neutral' : b.kind === 'break' ? 'good' : 'accent'}>
                  {t(`plan.kind.${b.kind}`)}
                </Badge>
                {b.kind === 'focus' && b.ref?.collection === 'tasks' && (
                  <button
                    type="button"
                    class="link small"
                    onClick={() =>
                      void update('tasks', b.ref!.id, {
                        status: 'done',
                        completedAt: new Date().toISOString(),
                      })
                    }
                  >
                    {t('tasks.markDone')}
                  </button>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p class="muted">{t('plan.noBlocks')}</p>
        )}
        <p class="small muted">{t('plan.scheduleHint')}</p>
      </Card>

      {conflicts.length > 0 && (
        <Card id="conflicts" title={t('plan.conflicts')}>
          <ul class="plain-list">
            {conflicts.map(([a, b]) => (
              <li key={`${a.id}-${b.id}`}>
                <strong>{fmtTime(a.start)}</strong> {a.title} ↔ {b.title}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
