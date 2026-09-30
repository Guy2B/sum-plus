import { useState } from 'preact/hooks';
import { capacity, settings, snapshot, clock, remove } from '../../data/store';
import { completeDecision, visibleDecisions, visibleTop } from '../../data/actions';
import { findConflicts, eventsOn } from '../../domain/planning';
import { comparePlans, scheduleDay, type WhatIf } from '../../domain/scheduler';
import { learnTimeRules, periodOf, type TimeRule } from '../../domain/decision';
import { weeklyReview } from '../../domain/review';
import { isoDay } from '../../domain/dates';
import { t, fmtTime, fmtMinutes, fmtLongDate } from '../../i18n';
import { Badge, Button, Card, PageHeader, Progress, attempt } from '../components';
import { decisionTitle, openDecisionSource } from '../decision-card';

type Scenario = 'short' | 'early' | 'tired';

function ruleLabel(r: TimeRule): string {
  const value = r.dimension === 'category' ? t(`category.${r.value}`) : t(`source.${r.value}`);
  return t('plan.learned.rule', {
    value,
    period: t(`plan.period.${r.period}`),
    pct: Math.round(r.avoidRate * 100),
  });
}

export function Plan() {
  const cap = capacity.value;
  const now = clock.value;
  const today = isoDay(now);
  const ctx = settings.value.context;
  const [scenarios, setScenarios] = useState<Set<Scenario>>(new Set());
  const [skip, setSkip] = useState<string[]>([]);

  const top = visibleTop.value.selected;
  const ranked = [...top, ...visibleDecisions.value.filter((d) => !top.includes(d))];
  const events = snapshot.value.events.filter((e) => !e.deletedAt);
  const whatIf: WhatIf = {
    maxMinutes: scenarios.has('short') ? 120 : null,
    endAt: scenarios.has('early') ? '16:00' : null,
    tired: scenarios.has('tired'),
    skipEvents: skip,
  };
  const active = scenarios.size > 0 || skip.length > 0;
  const base = scheduleDay(ranked, events, ctx, now);
  const plan = active ? scheduleDay(ranked, events, ctx, now, whatIf) : base;
  const diff = active ? comparePlans(base, plan) : null;
  const todayEvents = eventsOn(events, now).filter((e) => !e.allDay && e.end >= now.toISOString());

  const rows = [
    ...plan.events.map((e) => ({
      kind: 'event' as const,
      start: new Date(e.start),
      end: new Date(e.end),
      e,
    })),
    ...plan.blocks.map((b) => ({ kind: 'block' as const, start: b.start, end: b.end, b })),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());

  const toggle = (s: Scenario) => {
    const next = new Set(scenarios);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setScenarios(next);
  };

  const review = weeklyReview(snapshot.value, now);
  const feedback = snapshot.value.feedback.filter((f) => !f.deletedAt);
  const rules = learnTimeRules(feedback);
  const forget = (r: TimeRule) =>
    void attempt(async () => {
      for (const f of feedback)
        if (
          periodOf(f.hour) === r.period &&
          (r.dimension === 'category' ? f.category : f.sourceType) === r.value
        )
          await remove('feedback', f.id);
    }, t('plan.learned.forgotten'));
  const conflicts = findConflicts(events.filter((e) => e.start.slice(0, 10) >= today)).slice(0, 5);

  return (
    <div class="page page-narrow">
      <PageHeader eyebrow={fmtLongDate(now)} title={t('nav.plan')} subtitle={t('plan.subtitleNew')} />

      <section class="whatif" aria-labelledby="whatif-title">
        <h2 id="whatif-title">{t('plan.whatIf.title')}</h2>
        <div class="chips">
          {(['short', 'early', 'tired'] as const).map((s) => (
            <button
              key={s}
              type="button"
              class={`chip ${scenarios.has(s) ? 'chip-on' : ''}`}
              aria-pressed={scenarios.has(s)}
              onClick={() => toggle(s)}
            >
              {t(`plan.whatIf.${s}`)}
            </button>
          ))}
          {todayEvents.map((e) => (
            <button
              key={e.id}
              type="button"
              class={`chip ${skip.includes(e.id) ? 'chip-on' : ''}`}
              aria-pressed={skip.includes(e.id)}
              onClick={() => setSkip(skip.includes(e.id) ? skip.filter((x) => x !== e.id) : [...skip, e.id])}
            >
              {t('plan.whatIf.skip', { title: e.title })}
            </button>
          ))}
        </div>
        {diff && (
          <p class="whatif-result">
            {diff.dropped.length
              ? t('plan.whatIf.dropped', { items: diff.dropped.map(decisionTitle).join(', ') })
              : t('plan.whatIf.nothingDropped')}
            {diff.added.length > 0 &&
              ` ${t('plan.whatIf.added', { items: diff.added.map(decisionTitle).join(', ') })}`}
          </p>
        )}
      </section>

      <Card
        id="blocks"
        title={t(plan.tomorrow ? 'plan.dayTitleTomorrow' : 'plan.dayTitle', {
          used: fmtMinutes(Math.round(plan.usedMinutes)),
          free: fmtMinutes(plan.freeMinutes),
        })}
      >
        <Progress
          value={Math.min(100, plan.freeMinutes ? (plan.usedMinutes / plan.freeMinutes) * 100 : 100)}
          label={t('plan.load')}
        />
        {rows.length ? (
          <ol class="schedule">
            {rows.map((r) =>
              r.kind === 'event' ? (
                <li key={`e-${r.e.id}`} class="block block-event">
                  <time>
                    {fmtTime(r.start)}–{fmtTime(r.end)}
                  </time>
                  <span>{r.e.title}</span>
                  <Badge>{t('plan.kind.event')}</Badge>
                </li>
              ) : (
                <li key={`b-${r.b.decision.signal.id}-${r.start.getTime()}`} class="block block-focus">
                  <time>
                    {fmtTime(r.start)}–{fmtTime(r.end)}
                  </time>
                  <button type="button" class="link-title" onClick={() => openDecisionSource(r.b.decision)}>
                    {decisionTitle(r.b.decision)}
                    {r.b.part && ` (${r.b.part[0]}/${r.b.part[1]})`}
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="check"
                    onClick={() => void attempt(() => completeDecision(r.b.decision), t('decision.done'))}
                  >
                    <span class="sr-only">{t('today.do')}</span>
                  </Button>
                </li>
              ),
            )}
          </ol>
        ) : (
          <p class="muted">{t('plan.noBlocks')}</p>
        )}
        {plan.left.length > 0 && (
          <>
            <p class="label">{t('plan.left.title', { count: plan.left.length })}</p>
            <ul class="plain-list">
              {plan.left.map((l) => (
                <li key={l.decision.signal.id} class="ledger-row">
                  <span>{decisionTitle(l.decision)}</span>
                  <span class="small muted">{t(`plan.left.${l.reason}`)}</span>
                  {l.atRisk && <Badge tone="bad">{t('plan.left.atRisk')}</Badge>}
                </li>
              ))}
            </ul>
          </>
        )}
        <p class="small muted">
          {t('plan.windowHint', {
            from: fmtTime(plan.windowStart),
            to: fmtTime(plan.windowEnd),
            peak: t(`plan.period.${ctx.energyPeak}`),
          })}{' '}
          <a href="#context" class="link">
            {t('plan.adjust')}
          </a>
        </p>
        {cap.meetingMinutes > 0 && (
          <p class="small muted">{t('plan.meetings', { time: fmtMinutes(cap.meetingMinutes) })}</p>
        )}
      </Card>

      <Card id="week" title={t('plan.week.title')}>
        {review.insights.length ? (
          <ul class="mission-reasons">
            {review.insights.map((i) => (
              <li key={i.key + JSON.stringify(i.params ?? {})}>
                {t(i.key, {
                  ...i.params,
                  ...(i.params?.period ? { period: t(`plan.period.${i.params.period}`) } : {}),
                  ...(i.params?.category ? { category: t(`category.${i.params.category}`) } : {}),
                })}
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted small">{t('plan.week.empty')}</p>
        )}
      </Card>

      <Card id="learned" title={t('plan.learned.title')}>
        {rules.length ? (
          <ul class="plain-list">
            {rules.map((r) => (
              <li key={`${r.dimension}-${r.value}-${r.period}`} class="ledger-row">
                <span>{ruleLabel(r)}</span>
                <Button size="sm" variant="ghost" onClick={() => forget(r)}>
                  {t('plan.learned.forget')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted small">{t('plan.learned.empty')}</p>
        )}
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
