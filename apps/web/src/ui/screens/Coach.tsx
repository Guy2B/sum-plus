import { useEffect, useRef, useState } from 'preact/hooks';
import { answer, detectIntent, type CoachAnswer, type Line } from '../../domain/coach';
import { FREE_LIMITS, can } from '../../domain/entitlements';
import { getEdition } from '../../domain/editions';
import { isoDay } from '../../domain/dates';
import {
  capacity,
  clock,
  create,
  entitlement,
  settings,
  effectiveSettings,
  snapshot,
  updateSettings,
  remove,
  update,
} from '../../data/store';
import { visibleDecisions, visibleTop } from '../../data/actions';
import { enhance, semanticIntent } from '../../services/ai';
import { track } from '../../services/telemetry';
import { t, fmtDate } from '../../i18n';
import { Badge, Button, attempt, confirmDialog } from '../components';
import { Icon } from '../icons';
import { enginePrompts } from '../composer';
import { navigate, route, type RouteId } from '../router';

/** Params starting with "@" are i18n references (e.g. "@weekday.fri"), translated here. */
function localParams(params?: Line['params']): Line['params'] {
  if (!params) return params;
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [
      k,
      typeof v === 'string' && v.startsWith('@date:')
        ? fmtDate(v.slice(6))
        : typeof v === 'string' && v.startsWith('@')
          ? t(v.slice(1))
          : v,
    ]),
  );
}

function lineText(l: Line): string {
  if (l.text != null && !l.key) return l.text;
  const base = t(l.key, localParams(l.params));
  return l.text ? `${base} ${l.text}` : base;
}

/** Deterministic answer → plain text (the version stored and optionally rephrased). */
export function renderAnswer(a: CoachAnswer): string {
  const parts = [lineText(a.title), ...a.lines.map(lineText)];
  if (a.bullets.length) parts.push(a.bullets.map((b) => `• ${lineText(b)}`).join('\n'));
  if (a.question) parts.push(lineText(a.question));
  if (a.disclaimer) parts.push(lineText(a.disclaimer));
  return parts.join('\n\n');
}

/** Finance and health answers are never sent to a language model. */
const SENSITIVE_INTENTS = new Set(['finance', 'energy']);

export function Coach() {
  const s = settings.value;
  const ed = getEdition(s.edition, s.locale);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const messages = snapshot.value.coachMessages
    .filter((m) => !m.deletedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const today = isoDay(clock.value);
  const used = s.usage.coachDate === today ? s.usage.coachCount : 0;
  const unlimited = can('unlimitedCoach', entitlement.value);
  const remaining = unlimited ? Infinity : Math.max(0, FREE_LIMITS.coachPerDay - used);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length]);

  const ask = async (question: string) => {
    void track('coach_used');
    const q = question.trim().slice(0, 1000);
    if (!q || busy || remaining <= 0) return;
    setBusy(true);
    setText('');
    try {
      await create('coachMessages', { role: 'user', text: q });
      let intent = detectIntent(q);
      if (intent === 'help' && s.ai.semantic) intent = (await semanticIntent(q).catch(() => null)) ?? 'help';
      const a = answer(
        q,
        {
          snap: snapshot.value,
          settings: effectiveSettings.value,
          decisions: visibleDecisions.value,
          top: visibleTop.value,
          capacity: capacity.value,
          now: clock.value,
        },
        intent,
      );
      const plain = renderAnswer(a);
      const better =
        a.confidence !== 'low' && !SENSITIVE_INTENTS.has(a.intent)
          ? await enhance(plain, s.locale, s.context.coachingTone, s.ai)
          : null;
      await create('coachMessages', {
        role: 'assistant',
        text: better?.text ?? plain,
        meta: {
          intent: a.intent,
          usedSources: a.usedSources.map((u) => `${u.source}:${u.count}`),
          confidence: a.confidence,
          enhancedBy: better?.by ?? null,
          enhancedModel: better?.model ?? null,
          actions: a.actions,
          proposal: a.proposal,
        },
      });
      await updateSettings({ usage: { coachDate: today, coachCount: used + 1 } });
    } finally {
      setBusy(false);
    }
  };

  /** Applies the coach's proposal after an explicit confirmation (tasks only, never external calendars). */
  const applyProposal = async (m: (typeof messages)[number]) => {
    const moves = m.meta?.proposal ?? [];
    if (
      !moves.length ||
      !(await confirmDialog({
        title: t('coach.proposal.confirmTitle'),
        body: t('coach.proposal.confirmBody', { count: moves.length }),
      }))
    )
      return;
    await attempt(
      async () => {
        for (const p of moves)
          await update('tasks', p.id, { dueDate: p.to, scheduledFor: null, essential: false });
        await update('coachMessages', m.id, { meta: { ...m.meta, applied: true } });
        void track('coach_plan_applied');
      },
      t('coach.proposal.done', { count: moves.length }),
    );
  };

  const clear = async () => {
    if (!(await confirmDialog({ title: t('coach.clearTitle'), body: t('coach.clearBody'), danger: true })))
      return;
    for (const m of messages) await remove('coachMessages', m.id);
  };

  // A question handed over from the home composer or the palette (#coach/<question>).
  const handed = useRef<string | null>(null);
  const param = route.value.param;
  useEffect(() => {
    if (!param) {
      handed.current = null;
      return;
    }
    if (handed.current === param) return;
    handed.current = param;
    navigate('coach');
    void ask(param);
  }, [param]);

  const Meta = ({ m }: { m: (typeof messages)[number] }) =>
    m.meta ? (
      <div class="bubble-meta">
        <Badge
          tone={m.meta.confidence === 'high' ? 'good' : m.meta.confidence === 'low' ? 'warn' : 'neutral'}
        >
          {t(`coach.confidence.${m.meta.confidence ?? 'medium'}`)}
        </Badge>
        <span class="muted small">
          {m.meta.usedSources?.length
            ? t('coach.usedSources', {
                sources: m.meta.usedSources
                  .map((u) => {
                    const [src, n] = u.split(':');
                    return `${t(`source.${src}`)} (${n})`;
                  })
                  .join(', '),
              })
            : t('coach.noSources')}
        </span>
        {m.meta.enhancedBy && (
          <span class={`muted small ${m.meta.enhancedBy === 'local' ? 'local-badge' : ''}`}>
            · {t(`coach.enhanced.${m.meta.enhancedBy}`, { model: m.meta.enhancedModel ?? '' })}
          </span>
        )}
        {m.meta.proposal && m.meta.proposal.length > 0 && (
          <div class="proposal">
            <p class="small strong">{t('coach.proposal.title')}</p>
            <ul>
              {m.meta.proposal.map((p) => (
                <li key={p.id}>
                  {p.title} → <strong>{fmtDate(p.to)}</strong>
                </li>
              ))}
            </ul>
            {m.meta.applied ? (
              <p class="small good-text">{t('coach.proposal.applied')}</p>
            ) : (
              <Button size="sm" variant="primary" icon="check" onClick={() => void applyProposal(m)}>
                {t('coach.proposal.apply')}
              </Button>
            )}
          </div>
        )}
        {m.meta.actions?.map((a) => (
          <button key={a.key} type="button" class="chip" onClick={() => navigate(a.route as RouteId)}>
            {t(a.key)}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div class={`page page-narrow coach-page ${messages.length || busy ? '' : 'is-empty'}`}>
      {messages.length ? (
        <div class="coach-top">
          <h1>{t('nav.coach')}</h1>
          <Button variant="ghost" size="sm" icon="trash" onClick={() => void clear()}>
            {t('coach.clear')}
          </Button>
        </div>
      ) : (
        <header class="coach-hero">
          <span class="brand-mark brand-lg hero-mark" aria-hidden="true">
            Σ
          </span>
          <h1 class="display">{t('coach.heroTitle')}</h1>
          <p class="muted">{ed.coachWelcome}</p>
        </header>
      )}

      <div class="chat" ref={listRef} aria-live="polite">
        {messages.map((m) =>
          m.role === 'assistant' ? (
            <div key={m.id} class="bubble bubble-assistant">
              <div class="bubble-content">
                <p class="bubble-text">{m.text}</p>
                <Meta m={m} />
              </div>
            </div>
          ) : (
            <div key={m.id} class="bubble bubble-user">
              <p class="bubble-text">{m.text}</p>
            </div>
          ),
        )}
        {busy && (
          <div class="bubble bubble-assistant">
            <span class="spinner muted" aria-label={t('common.loading')} />
          </div>
        )}
      </div>

      <div class="coach-dock">
        {!messages.length && (
          <div class="chips composer-chips" role="group" aria-label={t('coach.suggestions')}>
            {enginePrompts().map(([label, prompt]) => (
              <button
                key={label}
                type="button"
                class="chip"
                disabled={busy || remaining <= 0}
                onClick={() => void ask(prompt)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <form
          class="composer chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(text);
          }}
        >
          <label class="sr-only" for="coach-input">
            {t('coach.placeholder')}
          </label>
          <textarea
            id="coach-input"
            rows={1}
            value={text}
            maxLength={1000}
            placeholder={t('coach.placeholder')}
            onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                void ask(text);
              }
            }}
          />
          <div class="composer-bar">
            <span class="composer-hint">
              {unlimited
                ? t('coach.unlimited')
                : t('coach.remaining', { count: remaining, max: FREE_LIMITS.coachPerDay })}
            </span>
            <button
              type="submit"
              class="send-btn"
              aria-label={t('coach.send')}
              disabled={!text.trim() || busy || remaining <= 0}
            >
              <Icon name="arrowUp" size={18} />
            </button>
          </div>
        </form>
        <p class="coach-foot">{t('coach.disclaimer')}</p>
      </div>
    </div>
  );
}
