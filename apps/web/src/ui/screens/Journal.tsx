import { useEffect, useState } from 'preact/hooks';
import type { JournalEntry } from '../../domain/types';
import { create, snapshot, update, clock } from '../../data/store';
import { isoDay } from '../../domain/dates';
import { normalizeText } from '../../domain/text';
import { t, fmtLongDate } from '../../i18n';
import { Badge, Button, Card, Empty, Field, IconButton, PageHeader, Tabs, attempt } from '../components';
import { route } from '../router';
import { deleteWithUndo } from './Tasks';

type Kind = JournalEntry['kind'];

export function Journal() {
  const now = clock.value;
  const [filter, setFilter] = useState<'all' | Kind>('all');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState(isoDay(now));
  const [kind, setKind] = useState<Kind>('reflection');
  const [mood, setMood] = useState(3);
  const [text, setText] = useState('');
  const [tags, setTags] = useState('');
  const [open, setOpen] = useState(false);

  const entries = snapshot.value.journal
    .filter((j) => !j.deletedAt)
    .filter((j) => filter === 'all' || j.kind === filter)
    .filter((j) => !query || normalizeText(`${j.text} ${j.tags.join(' ')}`).includes(normalizeText(query)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  useEffect(() => {
    const found = snapshot.value.journal.find((j) => j.id === route.value.param);
    if (found) edit(found);
  }, [route.value.param]);

  function edit(j: JournalEntry) {
    setEditingId(j.id);
    setDate(j.date);
    setKind(j.kind);
    setMood(j.mood ?? 3);
    setText(j.text);
    setTags(j.tags.join(', '));
    setOpen(true);
    document.getElementById('journal-text')?.focus();
  }

  const reset = () => {
    setEditingId(null);
    setText('');
    setTags('');
    setMood(3);
    setKind('reflection');
    setDate(isoDay(new Date()));
  };

  const save = async (e: Event) => {
    e.preventDefault();
    if (!text.trim()) return;
    const fields = {
      date,
      kind,
      mood,
      text: text.trim().slice(0, 20000),
      tags: tags
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 12),
    };
    await attempt(async () => {
      if (editingId) await update('journal', editingId, fields);
      else await create('journal', fields);
      reset();
    }, t('common.saved'));
  };

  return (
    <div class="page page-narrow">
      <PageHeader title={t('nav.journal')} subtitle={t('journal.subtitle')} />
      <form
        class="card journal-editor"
        onSubmit={save}
        aria-label={editingId ? t('journal.edit') : t('journal.new')}
      >
        <label class="sr-only" for="journal-text">
          {t('journal.text')}
        </label>
        <textarea
          id="journal-text"
          rows={open ? 6 : 2}
          maxLength={20000}
          placeholder={t('journal.placeholder')}
          value={text}
          onFocus={() => setOpen(true)}
          onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
        />
        {open && (
          <>
            <div class="row journal-meta">
              <Field label={t('journal.date')}>
                {(id) => (
                  <input
                    id={id}
                    type="date"
                    value={date}
                    onInput={(e) => setDate((e.currentTarget as HTMLInputElement).value)}
                  />
                )}
              </Field>
              <Field label={t('journal.kind')}>
                {(id) => (
                  <select
                    id={id}
                    value={kind}
                    onChange={(e) => setKind((e.currentTarget as HTMLSelectElement).value as Kind)}
                  >
                    {(['reflection', 'milestone', 'learning'] as const).map((k) => (
                      <option key={k} value={k}>
                        {t(`journal.kindValue.${k}`)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={t('journal.mood', { value: mood })}>
                {(id) => (
                  <input
                    id={id}
                    type="range"
                    min={1}
                    max={5}
                    value={mood}
                    onInput={(e) => setMood(Number((e.currentTarget as HTMLInputElement).value))}
                  />
                )}
              </Field>
              <Field label={t('journal.tags')}>
                {(id) => (
                  <input
                    id={id}
                    value={tags}
                    placeholder={t('journal.tagsHint')}
                    onInput={(e) => setTags((e.currentTarget as HTMLInputElement).value)}
                  />
                )}
              </Field>
            </div>
            <div class="journal-actions">
              <p class="small muted">{t('journal.privacy')}</p>
              <Button
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={!text.trim()}>
                {t('common.save')}
              </Button>
            </div>
          </>
        )}
      </form>

      <div class="toolbar">
        <Tabs
          label={t('journal.filter')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all' as const, label: t('attention.all') },
            ...(['reflection', 'milestone', 'learning'] as const).map((k) => ({
              value: k,
              label: t(`journal.kindValue.${k}`),
            })),
          ]}
        />
        <input
          type="search"
          aria-label={t('common.search')}
          placeholder={t('common.search')}
          value={query}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
        />
      </div>

      {entries.length ? (
        <div class="entries">
          {entries.map((j) => (
            <Card
              key={j.id}
              title={fmtLongDate(j.date)}
              actions={
                <>
                  <Badge>{t(`journal.kindValue.${j.kind}`)}</Badge>
                  {j.mood != null && (
                    <span class="muted small">{t('journal.moodShort', { value: j.mood })}</span>
                  )}
                  <IconButton icon="edit" label={t('common.edit')} onClick={() => edit(j)} />
                  <IconButton
                    icon="trash"
                    label={t('common.delete')}
                    onClick={() => void deleteWithUndo('journal', j.id, fmtLongDate(j.date))}
                  />
                </>
              }
            >
              <p class="prewrap">{j.text}</p>
              {j.tags.length > 0 && (
                <div class="chips">
                  {j.tags.map((tag) => (
                    <span key={tag} class="chip static">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <Empty icon="book" title={t('journal.empty')} />
        </Card>
      )}
    </div>
  );
}
