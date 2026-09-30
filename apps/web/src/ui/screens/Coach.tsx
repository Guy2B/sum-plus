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
} from '../../data/store';
import { visibleDecisions, visibleTop } from '../../data/actions';
import { enhance, semanticIntent } from '../../services/ai';
import { t } from '../../i18n';
import { Badge, Button, Card, PageHeader, confirmDialog } from '../components';
import { navigate, type RouteId } from '../router';

function lineText(l: Line): string {
  if (l.text != null && !l.key) return l.text;
  const base = t(l.key, l.params);
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
        a.confidence !== 'low' ? await enhance(plain, s.locale, s.context.coachingTone, s.ai) : null;
      await create('coachMessages', {
        role: 'assistant',
        text: better?.text ?? plain,
        meta: {
          intent: a.intent,
          usedSources: a.usedSources.map((u) => `${u.source}:${u.count}`),
          confidence: a.confidence,
          enhancedBy: better?.by ?? null,
          actions: a.actions,
        },
      });
      await updateSettings({ usage: { coachDate: today, coachCount: used + 1 } });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!(await confirmDialog({ title: t('coach.clearTitle'), body: t('coach.clearBody'), danger: true })))
      return;
    for (const m of messages) await remove('coachMessages', m.id);
  };

  return (
    <div class="page coach-page">
      <PageHeader
        title={t('nav.coach')}
        subtitle={ed.coachWelcome}
        actions={
          messages.length ? (
            <Button variant="ghost" size="sm" icon="trash" onClick={() => void clear()}>
              {t('coach.clear')}
            </Button>
          ) : undefined
        }
      />
      <Card>
        <div class="chat" ref={listRef} aria-live="polite">
          {!messages.length && <p class="muted">{t('coach.intro')}</p>}
          {messages.map((m) => (
            <div key={m.id} class={`bubble bubble-${m.role}`}>
              <p class="bubble-text">{m.text}</p>
              {m.role === 'assistant' && m.meta && (
                <div class="bubble-meta">
                  <Badge
                    tone={
                      m.meta.confidence === 'high' ? 'good' : m.meta.confidence === 'low' ? 'warn' : 'neutral'
                    }
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
                    <span class="muted small">· {t(`coach.enhanced.${m.meta.enhancedBy}`)}</span>
                  )}
                  {m.meta.actions?.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      class="link small"
                      onClick={() => navigate(a.route as RouteId)}
                    >
                      {t(a.key)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div class="bubble bubble-assistant">
              <span class="spinner" aria-label={t('common.loading')} />
            </div>
          )}
        </div>

        <div class="chips" role="group" aria-label={t('coach.suggestions')}>
          {ed.prompts.map(([label, prompt]) => (
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

        <form
          class="chat-input"
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
            rows={2}
            value={text}
            maxLength={1000}
            placeholder={t('coach.placeholder')}
            onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask(text);
              }
            }}
          />
          <Button
            type="submit"
            variant="primary"
            icon="send"
            loading={busy}
            disabled={!text.trim() || remaining <= 0}
          >
            {t('coach.send')}
          </Button>
        </form>
        <p class="small muted">
          {unlimited
            ? t('coach.unlimited')
            : t('coach.remaining', { count: remaining, max: FREE_LIMITS.coachPerDay })}{' '}
          · {t('coach.disclaimer')}
        </p>
      </Card>
    </div>
  );
}
