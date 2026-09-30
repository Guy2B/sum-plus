import { useState } from 'preact/hooks';
import type { Decision } from '../domain/decision';
import type { Slot } from '../domain/today';
import { isoDay } from '../domain/dates';
import { t, fmtTime } from '../i18n';
import { Button, attempt, toast } from './components';
import { Icon } from './icons';
import { acceptDecision, completeDecision, deferDecision, dismissDecision } from '../data/actions';
import { clock, create } from '../data/store';
import { decisionTitle, openDecisionSource } from './decision-card';

export type TodayRole = 'now' | 'watch' | 'protect';

function confidence(d: Decision): 'high' | 'medium' | 'low' {
  const c = d.facts.confidence;
  return c >= 75 ? 'high' : c >= 55 ? 'medium' : 'low';
}

/** One of the three Today cards: what, why (in words, no score), from where, how sure, and what to do. */
export function TodayCard({ role, d, slot }: { role: TodayRole; d: Decision; slot?: Slot | null }) {
  const [open, setOpen] = useState(false);
  const title = decisionTitle(d);
  const why = d.reasons.slice(0, 2).map((r) => t(r.key, r.params));
  const tomorrow = slot && isoDay(slot.start) !== isoDay(clock.value);

  const block = async () => {
    if (!slot) return;
    await attempt(async () => {
      await create('events', {
        title: t('today.focusEvent', { title }),
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        source: { provider: 'local', ref: d.signal.id },
      });
      await acceptDecision(d);
    }, t('today.blocked'));
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
      {role === 'protect' && slot && (
        <p class="today-slot">
          {tomorrow ? `${t('today.tomorrow')} · ` : ''}
          {fmtTime(slot.start)}–{fmtTime(slot.end)}
        </p>
      )}
      {why.length > 0 && <p class="decision-why">{why.join(' · ')}</p>}
      <p class="today-meta">
        {t('today.from', { source: t(`source.${d.signal.sourceType}`) })}
        {d.signal.sender && ` · ${d.signal.sender}`} · {t(`today.confidence.${confidence(d)}`)}
      </p>

      <div class="decision-actions">
        {role === 'protect' && slot ? (
          <Button size="sm" variant="primary" icon="calendar" onClick={() => void block()}>
            {t('today.block')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            icon="check"
            onClick={() => void attempt(() => completeDecision(d), t('decision.done'))}
          >
            {t('decision.markDone')}
          </Button>
        )}
        {d.signal.url && (
          <a class="btn btn-ghost btn-sm" href={d.signal.url} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={16} />
            <span>{t('decision.openSource')}</span>
          </a>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void attempt(() => deferDecision(d), t('decision.deferred'))}
        >
          {t('decision.later')}
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
        <button
          type="button"
          class="icon-btn useful"
          aria-label={t('today.useful')}
          title={t('today.useful')}
          onClick={() => void acceptDecision(d).then(() => toast(t('today.usefulThanks'), 'good'))}
        >
          👍
        </button>
      </div>

      {open && (
        <div class="decision-explain">
          <ul>
            {d.reasons.map((r) => (
              <li key={r.key + JSON.stringify(r.params ?? {})}>{t(r.key, r.params)}</li>
            ))}
          </ul>
          {d.uncertainties.length > 0 && (
            <>
              <p class="small strong">{t('decision.uncertainties')}</p>
              <ul class="muted">
                {d.uncertainties.map((u) => (
                  <li key={u.key}>{t(u.key, u.params)}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </article>
  );
}
