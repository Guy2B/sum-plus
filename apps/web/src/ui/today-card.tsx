import { useState } from 'preact/hooks';
import type { Decision } from '../domain/decision';
import { freeSlot, blockMinutes, type Slot } from '../domain/today';
import type { WhyNot } from '../domain/whynot';
import { isoDay } from '../domain/dates';
import { t, fmtTime, fmtMinutes, fmtRelative } from '../i18n';
import { Button, attempt, toast } from './components';
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

export type TodayRole = 'now' | 'watch' | 'protect';

function confidence(d: Decision): 'high' | 'medium' | 'low' {
  const c = d.facts.confidence;
  return c >= 75 ? 'high' : c >= 55 ? 'medium' : 'low';
}

/**
 * A Today card is a small cockpit: what, how long, why now (the triggering
 * fact), and three actions — Do, Plan, Ignore. Everything else (sources,
 * confidence, what was set aside and why, feedback) lives behind "Why?".
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
  const trigger = d.reasons[0] ? t(d.reasons[0].key, d.reasons[0].params) : null;
  const planSlot =
    slot ??
    freeSlot(
      snapshot.value.events.filter((e) => !e.deletedAt),
      settings.value.context,
      now,
      blockMinutes(d),
    );
  const freeNow = planSlot && planSlot.start.getTime() - now.getTime() <= 20 * 60_000;
  const isMail = d.signal.sourceType === 'mail' && Boolean(d.signal.senderEmail || d.signal.url);

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
      t('today.planned', {
        time: `${isoDay(planSlot.start) !== isoDay(now) ? `${t('today.tomorrow')} ` : ''}${fmtTime(planSlot.start)}`,
      }),
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
        <span class="today-duration">{fmtMinutes(d.facts.effortMinutes)}</span>
        {trigger && <span> · {trigger}</span>}
        {role === 'protect' && planSlot && (
          <span>
            {' · '}
            {isoDay(planSlot.start) !== isoDay(now) ? `${t('today.tomorrow')} ` : ''}
            {fmtTime(planSlot.start)}–{fmtTime(planSlot.end)}
          </span>
        )}
        {role === 'now' && freeNow && <span> · {t('today.freeNow')}</span>}
      </p>

      <div class="decision-actions">
        <Button
          size="sm"
          variant="primary"
          icon="check"
          onClick={() => void attempt(() => completeDecision(d), t('decision.done'))}
        >
          {t('today.do')}
        </Button>
        {isMail && (
          <Button size="sm" variant="ghost" icon="mail" onClick={() => setDraft(true)}>
            {t('today.reply')}
          </Button>
        )}
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
        <div class="decision-explain">
          <ul>
            {d.reasons.map((r) => (
              <li key={r.key + JSON.stringify(r.params ?? {})}>{t(r.key, r.params)}</li>
            ))}
          </ul>
          <p class="small muted">
            {t('today.from', { source: t(`source.${d.signal.sourceType}`) })}
            {d.signal.sender && ` · ${d.signal.sender}`} · {t(`today.confidence.${confidence(d)}`)}
          </p>
          {alternatives.length > 0 && (
            <>
              <p class="small strong">{t('today.whyNotTitle')}</p>
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
          {d.uncertainties.length > 0 && (
            <p class="small muted">{d.uncertainties.map((u) => t(u.key, u.params)).join(' · ')}</p>
          )}
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

export function toastPlanned(text: string) {
  toast(text, 'good');
}
