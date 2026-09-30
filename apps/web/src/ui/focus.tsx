/**
 * Focus session: "Start" opens the work (source, mail, mission) and runs a
 * timer; "Done" records the real time spent, which calibrates future
 * estimates. The session lives in memory for the current visit.
 */
import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { Decision } from '../domain/decision';
import { calibratedMinutes, calibration } from '../domain/calibration';
import { completeDecision, markStarted } from '../data/actions';
import { snapshot } from '../data/store';
import { t } from '../i18n';
import { Button, attempt } from './components';
import { decisionTitle } from './decision-card';

interface Session {
  d: Decision;
  startedAt: number;
  pausedMs: number;
  pausedAt: number | null;
  planned: number;
}

export const focus = signal<Session | null>(null);

export function startFocus(d: Decision): void {
  const planned = calibratedMinutes(d, calibration(snapshot.value.feedback.filter((f) => !f.deletedAt)));
  const s = { d, startedAt: Date.now(), pausedMs: 0, pausedAt: null, planned };
  focus.value = s;
  void markStarted(d);
  if (d.signal.url && d.signal.sourceType !== 'mail') window.open(d.signal.url, '_blank', 'noopener');
}

export function elapsedMinutes(s: Session, now = Date.now()): number {
  const paused = s.pausedMs + (s.pausedAt ? now - s.pausedAt : 0);
  return Math.max(1, Math.round((now - s.startedAt - paused) / 60_000));
}

export function FocusBar() {
  const s = focus.value;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!s) return;
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [s]);
  if (!s) return null;
  const ms = Date.now() - s.startedAt - s.pausedMs - (s.pausedAt ? Date.now() - s.pausedAt : 0);
  const mm = String(Math.floor(ms / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
  const over = ms / 60_000 > s.planned;
  const stop = () => {
    focus.value = null;
  };
  return (
    <div class="focus-bar" role="status" aria-live="polite">
      <span class="focus-dot" aria-hidden="true" />
      <span class="focus-title">{decisionTitle(s.d)}</span>
      <span class={`focus-time ${over ? 'warn-text' : ''}`}>
        {mm}:{ss} <span class="muted">/ {s.planned} min</span>
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          focus.value = s.pausedAt
            ? { ...s, pausedMs: s.pausedMs + (Date.now() - s.pausedAt), pausedAt: null }
            : { ...s, pausedAt: Date.now() };
        }}
      >
        {s.pausedAt ? t('focus.resume') : t('focus.pause')}
      </Button>
      <Button size="sm" variant="ghost" onClick={stop}>
        {t('focus.stop')}
      </Button>
      <Button
        size="sm"
        variant="primary"
        icon="check"
        onClick={() =>
          void attempt(
            async () => {
              await completeDecision(s.d, elapsedMinutes(s));
              stop();
            },
            t('focus.doneToast', { minutes: elapsedMinutes(s) }),
          )
        }
      >
        {t('focus.done')}
      </Button>
    </div>
  );
}
