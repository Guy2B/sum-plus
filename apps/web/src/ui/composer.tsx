/**
 * The home composer: one calm input for the two things people do most —
 * capture a task in natural language, or ask Σ a question. A trailing "?"
 * switches to "ask" automatically unless the user picked a mode explicitly.
 */
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { create } from '../data/store';
import { parseCapture } from '../domain/capture';
import { t } from '../i18n';
import { attempt, toast } from './components';
import { Icon } from './icons';
import { navigate } from './router';

type Mode = 'task' | 'ask';

/** Incremented to ask the composer to take focus (sidebar "New capture"). */
export const composerFocus = signal(0);
let focusHandled = 0;

/** Creates a task from natural language; `when` is the default horizon of the current list. */
export async function captureTask(text: string, when?: 'today' | 'week'): Promise<boolean> {
  const c = parseCapture(text);
  const scheduledFor = c.scheduledFor ?? (c.dueDate ? null : (when ?? null));
  let ok = false;
  await attempt(async () => {
    await create('tasks', {
      title: c.title.slice(0, 300),
      category: c.category ?? 'work',
      status: c.dueDate || scheduledFor ? 'todo' : 'inbox',
      priority: c.priority,
      dueDate: c.dueDate,
      scheduledFor,
      estimateMinutes: c.estimateMinutes ?? undefined,
    });
    toast(t('capture.saved', { title: c.title }), 'good');
    ok = true;
  });
  return ok;
}

/** Questions that query the engine directly (not a generic chat). */
export const ENGINE_QUESTIONS = ['plan', 'forget', 'wait', 'overload', 'blocked', 'free'] as const;
export function enginePrompts(): [string, string][] {
  return ENGINE_QUESTIONS.map((k) => [t(`coach.ask.${k}`), t(`coach.ask.${k}`)]);
}

export function askCoach(question: string): void {
  navigate('coach', question.trim().slice(0, 1000));
}

export function Composer({ prompts }: { prompts: [string, string][] }) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const mode: Mode = picked ?? (/\?\s*$/.test(text) ? 'ask' : 'task');

  useEffect(() => {
    // Each request focuses once (not on every later visit to the home page).
    if (composerFocus.value > focusHandled) {
      focusHandled = composerFocus.value;
      ref.current?.focus();
    }
  }, [composerFocus.value]);

  // Auto-grow up to the CSS max-height.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    if (mode === 'ask') {
      askCoach(value);
      return;
    }
    setBusy(true);
    if (await captureTask(value)) {
      setText('');
      setPicked(null);
    }
    setBusy(false);
  };

  const label = mode === 'ask' ? t('composer.ask') : t('capture.label');
  return (
    <div>
      <form
        class="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={ref}
          rows={1}
          value={text}
          maxLength={1000}
          aria-label={label}
          placeholder={mode === 'ask' ? t('composer.placeholderAsk') : t('capture.placeholder')}
          enterkeyhint={mode === 'ask' ? 'send' : 'done'}
          onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div class="composer-bar">
          <div class="composer-modes" role="group" aria-label={t('composer.mode')}>
            {(['task', 'ask'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => {
                  setPicked(m);
                  ref.current?.focus();
                }}
              >
                {m === 'task' ? t('composer.task') : t('composer.ask')}
              </button>
            ))}
          </div>
          <span class="composer-hint">{mode === 'ask' ? t('composer.hintAsk') : t('composer.hintTask')}</span>
          <button
            type="submit"
            class="send-btn"
            aria-label={mode === 'ask' ? t('coach.send') : t('capture.add')}
            disabled={!text.trim() || busy}
          >
            <Icon name="arrowUp" size={18} />
          </button>
        </div>
      </form>
      {prompts.length > 0 && (
        <div class="chips composer-chips" role="group" aria-label={t('coach.suggestions')}>
          {prompts.slice(0, 4).map(([chip, prompt]) => (
            <button key={chip} type="button" class="chip" onClick={() => askCoach(prompt)}>
              {chip}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
