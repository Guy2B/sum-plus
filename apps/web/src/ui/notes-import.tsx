/**
 * Phone notes into NEXT: "Share → NEXT" from any notes app (installed PWA on
 * Android), .txt/.md files, or pasted text. Every note is previewed: the person
 * ticks the lines that become tasks and can keep the full text as a journal note.
 */
import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { parseCapture } from '../domain/capture';
import { isoDay } from '../domain/dates';
import { splitNote, sharedText, type SplitNote } from '../domain/notes';
import { create, createMany, updateSettings } from '../data/store';
import { t } from '../i18n';
import { Button, Modal, attempt, toast } from './components';

/** Share targets only exist on Android (installed web app); iOS has no web share target. */
export const shareSupported = () => /android/i.test(navigator.userAgent);

/** Query parameters of the manifest share_target (see vite.config.ts). */
export const SHARE_PARAMS = ['share_title', 'share_text', 'share_url'] as const;

const pending = signal<string | null>(null);

export async function saveNote(note: SplitNote, tasks: string[], keepText: boolean): Promise<number> {
  if (tasks.length)
    await createMany(
      'tasks',
      tasks.map((line) => {
        const c = parseCapture(line);
        return {
          title: c.title.slice(0, 300),
          category: c.category ?? 'home',
          status: 'todo' as const,
          priority: c.priority,
          dueDate: c.dueDate,
          scheduledFor: c.dueDate ? c.scheduledFor : null,
          estimateMinutes: c.estimateMinutes ?? undefined,
          source: { provider: 'note' },
        };
      }),
    );
  if (keepText && note.text)
    await create('journal', {
      date: isoDay(),
      kind: 'reflection',
      text: note.text.slice(0, 10_000),
      tags: ['note'],
    });
  await updateSettings((cur) => ({
    ...cur,
    usage: { ...cur.usage, notesLinked: cur.usage.notesLinked ?? isoDay() },
  }));
  return tasks.length;
}

export function NotePreview({
  text,
  onClose,
  onSaved,
}: {
  text: string | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const note = text ? splitNote(text) : null;
  const [picked, setPicked] = useState<string[]>([]);
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!note) return;
    setPicked(note.tasks);
    setKeep(note.tasks.length === 0);
  }, [text]);
  if (!note) return null;
  const toggle = (line: string) =>
    setPicked(picked.includes(line) ? picked.filter((x) => x !== line) : [...picked, line]);
  const save = async () => {
    setBusy(true);
    const n = await attempt(() => saveNote(note, picked, keep));
    setBusy(false);
    if (n === undefined) return;
    toast(n ? t('notes.savedTasks', { count: n }) : t('notes.savedNote'), 'good');
    onSaved?.();
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={t('notes.previewTitle')}>
      <div class="form">
        {note.title && (
          <p>
            <strong>{note.title}</strong>
          </p>
        )}
        {note.tasks.length ? (
          <>
            <p class="small muted">{t('notes.pickTasks')}</p>
            <ul class="plain-list note-lines">
              {note.tasks.map((line) => (
                <li key={line}>
                  <label class="check">
                    <input type="checkbox" checked={picked.includes(line)} onChange={() => toggle(line)} />{' '}
                    {line}
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p class="small muted">{t('notes.noTasks')}</p>
        )}
        {note.done > 0 && <p class="small muted">{t('notes.doneSkipped', { count: note.done })}</p>}
        <label class="check">
          <input type="checkbox" checked={keep} onChange={() => setKeep(!keep)} /> {t('notes.keepText')}
        </label>
        <div class="modal-actions">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!picked.length && !keep}
            onClick={() => void save()}
          >
            {picked.length ? t('notes.createTasks', { count: picked.length }) : t('notes.saveNote')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** File import + paste box, shown in the guided setup. */
export function NotesImport({ onDone }: { onDone?: () => void }) {
  const [paste, setPaste] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const texts: string[] = [];
    for (const f of Array.from(files).slice(0, 30)) {
      if (f.size > 500_000) continue;
      const txt = (await f.text()).trim();
      if (txt) texts.push(txt);
    }
    if (!texts.length) return toast(t('notes.emptyFiles'), 'bad');
    setPreview(texts[0]!);
    setQueue(texts.slice(1));
  };
  const nextInQueue = () => {
    setPreview(queue[0] ?? null);
    setQueue(queue.slice(1));
  };

  return (
    <div class="notes-import">
      <p>
        <b>{t('notes.importTitle')}</b>
      </p>
      <div class="signal-choices">
        <label class="btn btn-secondary btn-md file-btn">
          <input
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            multiple
            onChange={(e) => void onFiles((e.currentTarget as HTMLInputElement).files)}
          />
          <span>{t('notes.chooseFiles')}</span>
        </label>
      </div>
      <textarea
        rows={3}
        placeholder={t('notes.pastePlaceholder')}
        aria-label={t('notes.pasteLabel')}
        value={paste}
        onInput={(e) => setPaste((e.currentTarget as HTMLTextAreaElement).value)}
      />
      <Button size="sm" disabled={!paste.trim()} onClick={() => setPreview(paste)}>
        {t('notes.pasteGo')}
      </Button>
      <NotePreview
        text={preview}
        onClose={nextInQueue}
        onSaved={() => {
          setPaste('');
          onDone?.();
        }}
      />
    </div>
  );
}

/** App root: a note shared to NEXT arrives as app.html?share_text=…; show its preview once. */
export function SharedNoteReceiver() {
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!SHARE_PARAMS.some((k) => params.has(k))) return;
    const text = sharedText(
      new URLSearchParams(SHARE_PARAMS.map((k) => [k.replace('share_', ''), params.get(k) ?? ''])),
    );
    for (const k of SHARE_PARAMS) params.delete(k);
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
    if (text.trim()) pending.value = text;
  }, []);
  return <NotePreview text={pending.value} onClose={() => (pending.value = null)} />;
}
