import { useState } from 'preact/hooks';
import type { Decision } from '../domain/decision';
import { freeSlot, freeMinutesNow, blockMinutes, type Slot } from '../domain/today';
import type { WhyNot } from '../domain/whynot';
import { calibration, calibratedMinutes, factorFor } from '../domain/calibration';
import { isoDay } from '../domain/dates';
import { t, fmtTime, fmtMinutes, fmtRelative } from '../i18n';
import { Button, attempt } from './components';
import { Icon } from './icons';
import {
  acceptDecision,
  completeDecision,
  deferDecision,
  dismissDecision,
  wrongTimeDecision,
} from '../data/actions';
import { clock, create, settings, snapshot } from '../data/store';
import { decisionTitle, openDecisionSource } from './decision-card';
import { ReplyDraft } from './reply-draft';
import { focus, startFocus } from './focus';

export type TodayRole = 'now' | 'watch' | 'protect';

function confidence(d: Decision): 'high' | 'medium' | 'low' {
  const c = d.facts.confidence;
  return c >= 75 ? 'high' : c >= 55 ? 'medium' : 'low';
}

/**
 * A Today card: what, how long, why now — and Start / Done / Schedule / Ignore.
 * "Why now?" is a fixed, scannable panel (deadline, unblocks, goal, effort,
 * availability, source, confidence) followed by what was set aside and why.
 */
export function TodayCard({
  role,
  d,
  slot,
  alternatives = [],
}: {
  role: TodayRole;
  d: Decision;
  slot?: Slot | null;
  alternatives?: WhyNot[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(false);
  const title = decisionTitle(d);
  const now = clock.value;
  const events = snapshot.value.events.filter((e) => !e.deletedAt);
  const ctx = settings.value.context;
  const factors = calibration(snapshot.value.feedback.filter((f) => !f.deletedAt));
  const minutes = calibratedMinutes(d, factors);
  const factor = factorFor(d, factors);
  const freeNow = freeMinutesNow(events, ctx, now);
  const planSlot = slot ?? freeSlot(events, ctx, now, blockMinutes(d));
  const trigger = d.reasons[0] ? t(d.reasons[0].key, d.reasons[0].params) : null;
  // Reply only makes sense to a person: never to notifications or newsletters.
  const isMail =
    d.signal.sourceType === 'mail' &&
    Boolean(d.signal.senderEmail || d.signal.url) &&
    !['automated', 'marketing'].includes(d.facts.relationshipType);
  const running = focus.value?.d.signal.id === d.signal.id;
  const slotLabel = (s: Slot) =>
    `${isoDay(s.start) !== isoDay(now) ? `${t('today.tomorrow')} ` : ''}${fmtTime(s.start)}–${fmtTime(s.end)}`;

  const plan = async () => {
    if (!planSlot) return;
    await attempt(
      async () => {
        await create('events', {
          title: t('today.focusEvent', { title }),
          start: planSlot.start.toISOString(),
          end: planSlot.end.toISOString(),
          source: { provider: 'local', ref: d.signal.id },
        });
        await deferDecision(d);
      },
      t('today.planned', { time: slotLabel(planSlot) }),
    );
  };

  const feedback = async (kind: 'useful' | 'notUseful' | 'wrongTime' | 'done') => {
    await attempt(
      async () => {
        if (kind === 'useful') await acceptDecision(d);
        if (kind === 'notUseful') await dismissDecision(d);
        if (kind === 'wrongTime') await wrongTimeDecision(d);
        if (kind === 'done') await completeDecision(d);
      },
      t(`today.feedback.${kind}Thanks`),
    );
  };

  const rows: [string, string, string][] = [];
  if (d.signal.dueAt) rows.push(['⏰', t('why.deadline'), fmtRelative(d.signal.dueAt, now)]);
  if (d.signal.unblocks)
    rows.push(['🔓', t('why.unblocks'), t('why.unblocksValue', { count: d.signal.unblocks })]);
  if (d.signal.chain?.length) rows.push(['🎯', t('why.goal'), d.signal.chain.join(' → ')]);
  rows.push([
    '⏱',
    t('why.effort'),
    factor !== 1
      ? t('why.effortCalibrated', { minutes, pct: Math.round((factor - 1) * 100) })
      : fmtMinutes(minutes),
  ]);
  rows.push([
    '📅',
    t('why.availability'),
    freeNow >= minutes
      ? t('why.freeNow', { minutes: freeNow })
      : planSlot
        ? t('why.nextSlot', { slot: slotLabel(planSlot) })
        : t('why.noSlot'),
  ]);
  rows.push([
    '🧭',
    t('why.source'),
    `${t(`source.${d.signal.sourceType}`)}${d.signal.sender ? ` · ${d.signal.sender}` : ''}`,
  ]);
  rows.push(['✓', t('why.confidence'), t(`today.confidence.${confidence(d)}`)]);

  return (
    <article class={`decision today-card role-${role}`} aria-label={`${t(`today.role.${role}`)} : ${title}`}>
      <p class="today-role">
        <Icon name={role === 'now' ? 'sun' : role === 'watch' ? 'bell' : 'clock'} size={15} />
        {t(`today.role.${role}`)}
      </p>
      <h3 class="decision-title">
        <button type="button" class="link-title" onClick={() => openDecisionSource(d)}>
          {title}
        </button>
      </h3>
      <p class="today-line">
        <span class="today-duration">{fmtMinutes(minutes)}</span>
        {trigger && <span> · {trigger}</span>}
        {role === 'protect' && planSlot && <span> · {slotLabel(planSlot)}</span>}
        {role === 'now' && freeNow >= minutes && <span> · {t('today.freeNow')}</span>}
      </p>

      <div class="decision-actions">
        {isMail ? (
          <Button size="sm" variant="primary" icon="mail" onClick={() => setDraft(true)}>
            {t('today.reply')}
          </Button>
        ) : (
          <Button size="sm" variant="primary" icon="arrowUp" disabled={running} onClick={() => startFocus(d)}>
            {running ? t('today.running') : t('today.start')}
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          icon="check"
          onClick={() => void attempt(() => completeDecision(d), t('decision.done'))}
        >
          {t('today.done')}
        </Button>
        <Button size="sm" variant="ghost" icon="calendar" disabled={!planSlot} onClick={() => void plan()}>
          {t('today.plan')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void attempt(() => dismissDecision(d), t('decision.dismissed'))}
        >
          {t('decision.dismiss')}
        </Button>
        <span class="spacer" />
        <button type="button" class="link why-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t('decision.why')}
        </button>
      </div>

      {open && (
        <div class="decision-explain why-panel">
          <p class="why-title">{t('why.now')}</p>
          <dl class="why-grid">
            {rows.map(([icon, label, value]) => (
              <div key={label} class="why-row">
                <dt>
                  <span aria-hidden="true">{icon}</span> {label}
                </dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {alternatives.length > 0 && (
            <>
              <p class="why-title">{t('today.whyNotTitle')}</p>
              <ul class="whynot">
                {alternatives.map((w) => (
                  <li key={w.decision.signal.id}>
                    <strong>{decisionTitle(w.decision)}</strong> —{' '}
                    {t(w.key, { ...w.params, when: w.until ? fmtRelative(w.until, now) : '' })}
                  </li>
                ))}
              </ul>
            </>
          )}
          <details class="why-details">
            <summary>{t('why.details')}</summary>
            <ul>
              {d.reasons.map((r) => (
                <li key={r.key + JSON.stringify(r.params ?? {})}>{t(r.key, r.params)}</li>
              ))}
              {d.uncertainties.map((u) => (
                <li key={u.key} class="muted">
                  {t(u.key, u.params)}
                </li>
              ))}
            </ul>
          </details>
          <div class="feedback-row" role="group" aria-label={t('today.feedback.label')}>
            <span class="small muted">{t('today.feedback.label')}</span>
            {(['useful', 'notUseful', 'wrongTime', 'done'] as const).map((k) => (
              <button key={k} type="button" class="chip" onClick={() => void feedback(k)}>
                {t(`today.feedback.${k}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {draft && <ReplyDraft d={d} onClose={() => setDraft(false)} />}
    </article>
  );
}
