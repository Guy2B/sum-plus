/**
 * Import into Cortex: an appointment from a pasted message (WhatsApp, SMS,
 * mail), a calendar file (.ics, also mail invitations), or a connected
 * calendar and mailbox (set up once in NEXT, shared by both apps).
 */
import { useState } from 'preact/hooks';
import type { ISODate } from '../../domain/types';
import { create } from '../../data/store';
import { parseAppointment } from '../../domain/appointment';
import { parseIcs } from '../../domain/ics';
import { ingestEvents } from '../../services/connectors/ingest';
import { Modal, toast } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { ct, fmtDuration, type CortexKey } from '../i18n';
import { hhmm, parseHHMM } from '../model';
import { isoDay } from '../../domain/dates';
import { planDay, sheet } from './state';
import { dateLong, dayTitle } from './parts';

const close = () => (sheet.value = null);
type Tab = 'message' | 'file' | 'connect';

export function ImportSheet({ tab: initial = 'message' }: { tab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial);
  return (
    <Modal open onClose={close} title={ct('import.title')}>
      <div class="cx-form">
        <div class="cx-seg" role="tablist" aria-label={ct('import.title')}>
          {(['message', 'file', 'connect'] as const).map((k) => (
            <button
              type="button"
              role="tab"
              key={k}
              aria-selected={tab === k}
              aria-pressed={tab === k}
              onClick={() => setTab(k)}
            >
              {ct(`import.tab.${k}` as CortexKey)}
            </button>
          ))}
        </div>
        {tab === 'message' && <FromMessage />}
        {tab === 'file' && <FromFile />}
        {tab === 'connect' && <Connect />}
      </div>
    </Modal>
  );
}

function FromMessage() {
  const [text, setText] = useState('');
  const found = text.trim() ? parseAppointment(text) : null;
  const [edit, setEdit] = useState<{ title: string; date: string; time: string; len: number } | null>(null);
  // Re-read the message until the person edits the proposal.
  const p =
    edit ??
    (found
      ? {
          title: found.title,
          date: isoDay(found.start),
          time: hhmm(found.start.getHours() * 60 + found.start.getMinutes()),
          len: 60,
        }
      : null);
  const set = (patch: Partial<NonNullable<typeof p>>) => p && setEdit({ ...p, ...patch });

  const addEvent = async () => {
    if (!p) return;
    const m = parseHHMM(p.time) ?? 9 * 60;
    const [y, mo, d] = p.date.split('-').map(Number);
    const start = new Date(y!, mo! - 1, d!, Math.floor(m / 60), m % 60);
    await create('events', {
      title: p.title.trim() || ct('import.untitled'),
      start: start.toISOString(),
      end: new Date(start.getTime() + p.len * 60_000).toISOString(),
      location: found?.location ?? undefined,
      description: text.slice(0, 2000),
      source: { provider: 'message' },
    });
    planDay.value = p.date as ISODate;
    close();
    toast(
      ct('import.eventAdded', {
        day: `${dayTitle(p.date as ISODate)} ${dateLong(p.date as ISODate)}`,
        time: p.time,
      }),
      'good',
    );
  };
  const addTask = async () => {
    const title = (p?.title || text.split('\n')[0] || '').trim().slice(0, 300);
    if (!title) return;
    await create('tasks', {
      title,
      category: 'work',
      status: 'todo',
      priority: 'medium',
      dueDate: p ? p.date : null,
      scheduledFor: null,
      source: { provider: 'message' },
    });
    close();
    toast(ct('import.taskAdded'), 'good');
  };

  return (
    <>
      <p class="muted cx-small">{ct('import.messageHint')}</p>
      <textarea
        id="imp-text"
        rows={4}
        maxLength={4000}
        value={text}
        placeholder={ct('import.messagePlaceholder')}
        aria-label={ct('import.tab.message')}
        onInput={(e) => {
          setText((e.target as HTMLTextAreaElement).value);
          setEdit(null);
        }}
      />
      {p ? (
        <section class="cx-found" aria-live="polite">
          <p class="cx-label">
            <Icon name="calendar" size={16} /> {ct('import.found')}
          </p>
          <div class="field">
            <label for="imp-title">{ct('block.what')}</label>
            <input
              id="imp-title"
              value={p.title}
              maxLength={120}
              onInput={(e) => set({ title: (e.target as HTMLInputElement).value })}
            />
          </div>
          <div class="cx-two">
            <div class="field">
              <label for="imp-date">{ct('planSheet.when')}</label>
              <input
                id="imp-date"
                type="date"
                value={p.date}
                onInput={(e) => set({ date: (e.target as HTMLInputElement).value })}
              />
            </div>
            <div class="field">
              <label for="imp-time">{ct('planSheet.at')}</label>
              <input
                id="imp-time"
                type="time"
                step={300}
                value={p.time}
                onInput={(e) => set({ time: (e.target as HTMLInputElement).value })}
              />
            </div>
          </div>
          {found && (!found.timed || !found.dated) && (
            <p class="cx-hint">{ct(found.timed ? 'import.guessDay' : 'import.guessTime')}</p>
          )}
          <div class="cx-chips cx-chips-pick" role="group" aria-label={ct('planSheet.duration')}>
            {[30, 60, 90, 120].map((m) => (
              <button type="button" key={m} aria-pressed={p.len === m} onClick={() => set({ len: m })}>
                {fmtDuration(m)}
              </button>
            ))}
          </div>
          {found?.location && (
            <p class="muted cx-small">
              {ct('import.place')} {found.location}
            </p>
          )}
          <div class="cx-foot">
            <button type="button" class="btn btn-ghost btn-md" onClick={() => void addTask()}>
              {ct('import.asTask')}
            </button>
            <button type="button" class="btn btn-primary btn-md" onClick={() => void addEvent()}>
              {ct('import.addEvent')}
            </button>
          </div>
        </section>
      ) : (
        text.trim() && (
          <div class="cx-found">
            <p class="muted">{ct('import.nothingFound')}</p>
            <div class="cx-foot">
              <button type="button" class="btn btn-primary btn-md" onClick={() => void addTask()}>
                {ct('import.asTask')}
              </button>
            </div>
          </div>
        )
      )}
    </>
  );
}

function FromFile() {
  const [busy, setBusy] = useState(false);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast(ct('import.tooLarge'), 'bad');
    setBusy(true);
    try {
      const parsed = parseIcs(await file.text(), { now: new Date() });
      const res = await ingestEvents(
        'ics',
        parsed.map((x) => ({
          title: x.title,
          start: x.start,
          end: x.end,
          allDay: x.allDay,
          location: x.location,
          description: x.description,
          source: { provider: 'ics', ref: x.uid },
        })),
      );
      close();
      toast(ct('import.icsDone', { count: res.added, updated: res.updated }), 'good');
    } catch {
      toast(ct('import.icsError'), 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p class="muted cx-small">{ct('import.fileHint')}</p>
      <label class="cx-drop">
        <Icon name="upload" size={22} />
        <b>{ct(busy ? 'import.reading' : 'import.pickFile')}</b>
        <span>{ct('import.fileTypes')}</span>
        <input
          type="file"
          accept=".ics,text/calendar"
          class="sr-only"
          onChange={(e) => void onFile((e.target as HTMLInputElement).files?.[0])}
        />
      </label>
    </>
  );
}

function Connect() {
  return (
    <>
      <p class="muted cx-small">{ct('import.connectHint')}</p>
      <ul class="cx-pick">
        <li>
          <a href="app.html#sources">
            <b>{ct('import.google')}</b>
            <span>{ct('import.googleHint')}</span>
            <Icon name="external" size={16} />
          </a>
        </li>
        <li>
          <a href="app.html#sources">
            <b>{ct('import.microsoft')}</b>
            <span>{ct('import.microsoftHint')}</span>
            <Icon name="external" size={16} />
          </a>
        </li>
        <li>
          <a href="app.html#sources">
            <b>{ct('import.otherMail')}</b>
            <span>{ct('import.otherMailHint')}</span>
            <Icon name="external" size={16} />
          </a>
        </li>
      </ul>
      <p class="cx-hint">{ct('import.whatsapp')}</p>
    </>
  );
}
