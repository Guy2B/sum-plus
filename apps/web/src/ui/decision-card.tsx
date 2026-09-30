import { useState } from 'preact/hooks';
import type { Decision } from '../domain/decision';
import { t, fmtRelative, fmtMinutes } from '../i18n';
import { Badge, Button, attempt } from './components';
import { Icon } from './icons';
import { completeDecision, deferDecision, dismissDecision } from '../data/actions';
import { navigate, type RouteId } from './router';
import { clock } from '../data/store';

const ROUTE_FOR: Record<string, RouteId> = {
  tasks: 'tasks',
  events: 'calendar',
  mailMessages: 'mail',
  socialItems: 'social',
  finance: 'finance',
  health: 'health',
  skills: 'learning',
  habits: 'goals',
  projects: 'projects',
  schoolItems: 'household',
  applications: 'career',
};

export function decisionTitle(d: Decision): string {
  return d.signal.titleKey ? t(d.signal.titleKey, d.signal.titleParams) : (d.signal.title ?? '');
}

const BAND_TONE = { critical: 'bad', high: 'warn', medium: 'accent', low: 'neutral' } as const;

export function DecisionCard({ d, rank, compact }: { d: Decision; rank?: number; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const title = decisionTitle(d);
  const due = d.signal.dueAt ? fmtRelative(d.signal.dueAt, clock.value) : null;
  const openSource = () => {
    const route = ROUTE_FOR[d.signal.ref.collection];
    if (route) navigate(route, d.signal.ref.id);
  };
  return (
    <article class={`decision band-${d.band}`} aria-label={title}>
      <div class="decision-main">
        {rank != null && (
          <span class="decision-rank" aria-hidden="true">
            {rank}
          </span>
        )}
        <div class="decision-body">
          <div class="decision-meta">
            <Badge tone={BAND_TONE[d.band]}>{t(`band.${d.band}`)}</Badge>
            <span class="muted">{t(`source.${d.signal.sourceType}`)}</span>
            <span class="decision-hint">· {t(`action.${d.action}`)}</span>
            {d.signal.provider && !['local', 'demo'].includes(d.signal.provider) && (
              <span class="muted">· {d.signal.provider}</span>
            )}
            {due && (
              <span class="muted">
                · <Icon name="clock" size={13} /> {due}
              </span>
            )}
            <span class="muted">· {fmtMinutes(d.facts.effortMinutes)}</span>
          </div>
          <h3 class="decision-title">
            <button type="button" class="link-title" onClick={openSource}>
              {title}
            </button>
          </h3>
          {d.signal.sender && <p class="muted small">{d.signal.sender}</p>}
          {!compact && d.reasons[0] && <p class="decision-why">{t(d.reasons[0].key, d.reasons[0].params)}</p>}
        </div>
        <div class="decision-score" title={t('decision.scoreHint')}>
          <strong>{d.score}</strong>
          <small>/100</small>
        </div>
      </div>

      <div class="decision-actions">
        <Button
          size="sm"
          variant="primary"
          icon="check"
          onClick={() => void attempt(() => completeDecision(d), t('decision.done'))}
        >
          {t('decision.markDone')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="clock"
          onClick={() => void attempt(() => deferDecision(d), t('decision.deferred'))}
        >
          {t('decision.later')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="x"
          onClick={() => void attempt(() => dismissDecision(d), t('decision.dismissed'))}
        >
          {t('decision.dismiss')}
        </Button>
        {d.signal.url && (
          <a class="btn btn-ghost btn-sm" href={d.signal.url} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={16} />
            <span>{t('decision.openSource')}</span>
          </a>
        )}
        <button type="button" class="link why-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t('decision.why')}
        </button>
      </div>

      {open && (
        <div class="decision-explain">
          <ul>
            {d.reasons.map((r) => (
              <li key={r.key}>{t(r.key, r.params)}</li>
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
          <p class="small muted">
            {t('decision.formula', {
              base: d.formula.base,
              rules: d.formula.rules,
              behavior: d.formula.behavior,
              edition: d.formula.edition,
              confidence: d.facts.confidence,
            })}
          </p>
          {d.requiresReview && <p class="small warn-text">{t('decision.requiresReview')}</p>}
        </div>
      )}
    </article>
  );
}
