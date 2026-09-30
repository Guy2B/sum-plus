/**
 * One bar to capture, plan and ask. Σ interprets the line (event, task,
 * mission, today's constraints or a question) and shows what it will do
 * before anything is created; the user can switch to "task" or "ask" instead.
 */
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { create, settings, updateSettings } from '../data/store';
import { parseCapture } from '../domain/capture';
import { interpret, type Interpretation } from '../domain/command';
import { allowed, modelLabel } from '../services/llm';
import { track } from '../services/telemetry';
import { structureWithModel } from '../services/structure';
import { isoDay } from '../domain/dates';
import { t, fmtDate, fmtTime } from '../i18n';
import { attempt, toast } from './components';
import { Icon } from './icons';
import { navigate } from './router';

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
      priority: c.promisedTo ? 'high' : c.priority,
      promisedTo: c.promisedTo,
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

/** Human-readable preview of what Σ is about to do with the line. */
export function describe(i: Interpretation): string {
  switch (i.kind) {
    case 'event':
      return t('command.event', {
        title: i.title,
        when: `${fmtDate(i.start)} ${fmtTime(i.start)}–${fmtTime(i.end)}`,
      });
    case 'mission':
      return t('command.mission', { kind: t(`mission.kind.${i.mission}`), when: fmtDate(i.date) });
    case 'day': {
      const parts = [
        i.energy && t(`today.day.energy.${i.energy}`),
        i.minutesLeft && t('command.left', { minutes: i.minutesLeft }),
        i.endAt && t('command.endAt', { time: i.endAt }),
      ].filter(Boolean);
      return t('command.day', { what: parts.join(' · ') });
    }
    case 'ask':
      return t('command.ask');
    default:
      return `${t('command.task', {
        when: i.captured.dueDate ? ` · ${fmtDate(i.captured.dueDate)}` : '',
        minutes: i.captured.estimateMinutes ? ` · ${i.captured.estimateMinutes} min` : '',
      })}${i.captured.promisedTo ? ` · ${t('command.promised', { to: i.captured.promisedTo })}` : ''}`;
  }
}

/** Executes an interpretation. Returns true when the line was consumed. */
export async function runCommand(text: string, i: Interpretation): Promise<boolean> {
  if (i.kind === 'ask') {
    askCoach(text);
    return true;
  }
  if (i.kind === 'task') return captureTask(text);
  let ok = false;
  await attempt(async () => {
    if (i.kind === 'event') {
      await create('events', {
        title: i.title.slice(0, 200),
        start: i.start.toISOString(),
        end: i.end.toISOString(),
        source: { provider: 'local' },
      });
      toast(t('command.eventSaved', { title: i.title, time: fmtTime(i.start) }), 'good');
    } else if (i.kind === 'mission') {
      await create('missions', {
        kind: i.mission,
        title: i.title.slice(0, 200),
        targetDate: i.date,
        status: 'active',
        minutesPerDay: 30,
        daysPerWeek: 5,
        topics: i.mission === 'exam' ? [{ id: 't1', title: i.title.slice(0, 200), mastery: 2 }] : [],
        log: [],
      });
      toast(t('command.missionSaved', { title: i.title }), 'good');
    } else if (i.kind === 'day') {
      void track('day_replanned');
      const s = settings.value;
      const today = isoDay();
      const current = s.usage.day?.date === today ? s.usage.day : { date: today };
      await updateSettings({
        usage: {
          ...s.usage,
          day: {
            ...current,
            date: today,
            ...(i.energy ? { energy: i.energy } : {}),
            ...(i.minutesLeft ? { minutesLeft: i.minutesLeft } : {}),
            ...(i.endAt ? { endAt: i.endAt } : {}),
          },
        },
      });
      toast(t('command.daySaved'), 'good');
      navigate('today');
    }
    ok = true;
  });
  return ok;
}

export function Composer({ prompts }: { prompts: [string, string][] }) {
  const [text, setText] = useState('');
  const [forced, setForced] = useState<'task' | 'ask' | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [model, setModel] = useState<{ text: string; interp: Interpretation } | null>(null);
  const deterministic = text.trim() ? interpret(text) : null;
  // The optional model only refines what the rules left as a plain task.
  const fromAi = model && model.text === text ? model.interp : null;
  const detected = fromAi ?? deterministic;
  const action: Interpretation | null = !detected
    ? null
    : forced === 'task'
      ? { kind: 'task', captured: parseCapture(text) }
      : forced === 'ask'
        ? { kind: 'ask', question: text }
        : detected;

  useEffect(() => {
    const prefs = settings.value.ai;
    const value = text.trim();
    if (!value || value.length < 12 || deterministic?.kind !== 'task' || !allowed(prefs, 'capture')) return;
    const timer = setTimeout(() => {
      void structureWithModel(prefs, value).then((interp) => {
        if (interp) setModel({ text, interp });
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [text]);

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
    if (!value || busy || !action) return;
    setBusy(true);
    if (await runCommand(value, action)) {
      setText('');
      setForced(null);
    }
    setBusy(false);
  };

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
          aria-label={t('capture.label')}
          aria-describedby="composer-preview"
          placeholder={t('command.placeholder')}
          enterkeyhint="done"
          onInput={(e) => {
            setText((e.currentTarget as HTMLTextAreaElement).value);
            setForced(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div class="composer-bar">
          <span id="composer-preview" class="composer-preview" aria-live="polite">
            {action
              ? `${fromAi && !forced ? `✨ ${modelLabel(settings.value.ai)} ` : ''}→ ${describe(action)}`
              : t('command.hint')}
          </span>
          {action && action.kind !== 'task' && (
            <button type="button" class="link small" onClick={() => setForced('task')}>
              {t('command.asTask')}
            </button>
          )}
          {action && action.kind === 'task' && (
            <button type="button" class="link small" onClick={() => setForced('ask')}>
              {t('command.asAsk')}
            </button>
          )}
          <button
            type="submit"
            class="send-btn"
            aria-label={action?.kind === 'ask' ? t('coach.send') : t('capture.add')}
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
