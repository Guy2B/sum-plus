/** The second brain: inbox, tasks, projects, notes and writing. */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Chapter, ChapterStatus, Note, Project } from '../../../domain/types';
import { create, entitlement, remove, restore, snapshot, update } from '../../../data/store';
import { can, withinLimit } from '../../../domain/entitlements';
import { fmtRelative } from '../../../i18n';
import { toast } from '../../../ui/components';
import { Icon } from '../../../ui/icons';
import { ct, fmtDuration, type CortexKey } from '../../i18n';
import {
  alive,
  backlinks,
  isLate,
  linksIn,
  noteByTitle,
  parseTags,
  shiftDay,
  sortTasks,
  wordCount,
} from '../../model';
import {
  createNote,
  editNote,
  flushNotes,
  getDay,
  liveNotes,
  liveProjects,
  liveTasks,
  today,
} from '../../data';
import { go, href, route } from '../../router';
import { AddTask, Kpi, Panel, TaskRow, projectColor } from '../parts';
import { captureFocus, sheet } from '../state';
import { openUpgrade } from '../pro';

const AREAS = ['pro', 'writing', 'personal'] as const;

/* ---------------------------------- inbox --------------------------------- */

export function Inbox() {
  const tasks = liveTasks.value.filter((t) => t.status === 'inbox');
  const notes = liveNotes.value.filter((n) => n.inbox);
  const items = [
    ...tasks.map((t) => ({ kind: 'task' as const, id: t.id, title: t.title, body: '', at: t.createdAt })),
    ...notes.map((n) => ({
      kind: n.kind,
      id: n.id,
      title: n.title || ct('note.untitled'),
      body: n.body,
      at: n.createdAt,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const file = async (kind: string, id: string, projectId: string | null) => {
    if (kind === 'task') await update('tasks', id, { status: 'todo', projectId });
    else await update('notes', id, { inbox: false, projectId });
    const p = projectId ? liveProjects.value.find((x) => x.id === projectId) : null;
    toast(p ? ct('inbox.filedTo', { name: p.name }) : ct('inbox.kept'), 'good');
  };
  return (
    <div class="cx-page">
      <header class="page-header">
        <div>
          <h1>{ct('nav.inbox')}</h1>
          <p class="muted">{items.length ? ct('inbox.count', { count: items.length }) : ct('inbox.clear')}</p>
        </div>
      </header>
      {items.length ? (
        <ul class="cx-inbox">
          {items.map((it) => (
            <li key={it.id} class="card">
              <span class="cx-ico" aria-hidden="true">
                <Icon
                  name={it.kind === 'task' ? 'check' : it.kind === 'idea' ? 'sparkles' : 'note'}
                  size={18}
                />
              </span>
              <div class="cx-inbox-body">
                <b>{it.title}</b>
                {it.body && <p class="muted">{it.body.slice(0, 160)}</p>}
                <div class="cx-row">
                  <select
                    id={`ib-${it.id}`}
                    aria-label={ct('inbox.fileTo')}
                    value=""
                    onChange={(e) => {
                      const v = (e.target as HTMLSelectElement).value;
                      if (v) void file(it.kind, it.id, v);
                    }}
                  >
                    <option value="">{ct('inbox.fileTo')}</option>
                    {AREAS.map((a) => {
                      const ps = liveProjects.value.filter(
                        (p) => (p.area ?? 'pro') === a && p.status !== 'done',
                      );
                      return ps.length ? (
                        <optgroup key={a} label={ct(`area.${a}` as CortexKey)}>
                          {ps.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null;
                    })}
                  </select>
                  {it.kind === 'task' && (
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      onClick={() =>
                        void update('tasks', it.id, { status: 'todo', scheduledFor: 'today' }).then(() =>
                          toast(ct('inbox.today'), 'good'),
                        )
                      }
                    >
                      <Icon name="star" size={14} />
                      <span>{ct('date.today')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    onClick={() => void file(it.kind, it.id, null)}
                  >
                    {ct('inbox.keep')}
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    onClick={() =>
                      it.kind === 'task' ? (sheet.value = { kind: 'task', id: it.id }) : go('notes', it.id)
                    }
                  >
                    {ct(it.kind === 'task' ? 'common.details' : 'common.open')}
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={ct('common.delete')}
                    onClick={() => {
                      const c = it.kind === 'task' ? 'tasks' : 'notes';
                      void remove(c, it.id);
                      toast(ct('common.deleted'), 'info', {
                        label: ct('common.undo'),
                        run: () => void restore(c, it.id),
                      });
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <section class="card cx-emptybox">
          <Icon name="inbox" size={28} />
          <p>
            <b>{ct('inbox.emptyTitle')}</b>
          </p>
          <p class="muted">{ct('inbox.emptyBody')}</p>
          <button type="button" class="btn btn-secondary btn-md" onClick={() => captureFocus.value++}>
            {ct('capture.action')}
          </button>
        </section>
      )}
    </div>
  );
}

/* ---------------------------------- tasks --------------------------------- */

export function Tasks() {
  const tk = today.value;
  const open = liveTasks.value.filter((t) => t.status !== 'done').sort(sortTasks);
  const week = shiftDay(tk, 7);
  const due = (t: (typeof open)[number]) => (t.dueDate ? String(t.dueDate).slice(0, 10) : null);
  const groups: [CortexKey, typeof open, string][] = [
    ['tasks.late', open.filter((t) => isLate(t, tk)), 'late'],
    [
      'date.today',
      open.filter((t) => !isLate(t, tk) && (due(t) === tk || t.scheduledFor === 'today' || t.essential)),
      '',
    ],
    [
      'tasks.thisWeek',
      open.filter((t) => due(t) && due(t)! > tk && due(t)! <= week && t.scheduledFor !== 'today'),
      '',
    ],
    ['tasks.later', open.filter((t) => due(t) && due(t)! > week && t.scheduledFor !== 'today'), ''],
    ['tasks.noDate', open.filter((t) => !due(t) && t.scheduledFor !== 'today' && !t.essential), ''],
  ];
  const done = liveTasks.value
    .filter((t) => t.status === 'done')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, 10);
  return (
    <div class="cx-page">
      <header class="page-header">
        <div>
          <h1>{ct('nav.tasks')}</h1>
          <p class="muted">{ct('tasks.openCount', { count: open.length })}</p>
        </div>
      </header>
      <Panel title={ct('tasks.all')}>
        {groups
          .filter(([, l]) => l.length)
          .map(([label, l, cls]) => (
            <div key={label}>
              <p class={`cx-group ${cls}`}>
                {ct(label)} <span class="num">{l.length}</span>
              </p>
              <ul class="cx-tasks">
                {l.map((t) => (
                  <TaskRow key={t.id} t={t} date={tk} />
                ))}
              </ul>
            </div>
          ))}
        {!open.length && <p class="cx-empty">{ct('tasks.none')}</p>}
        <AddTask id="add-all" />
      </Panel>
      {done.length > 0 && (
        <Panel title={ct('tasks.recentlyDone')}>
          <ul class="cx-tasks">
            {done.map((t) => (
              <TaskRow key={t.id} t={t} />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/* --------------------------------- projects ------------------------------- */

function progress(p: Project) {
  const ts = liveTasks.value.filter((t) => t.projectId === p.id);
  const ch = alive(snapshot.value.chapters).filter((c) => c.projectId === p.id);
  if (p.area === 'writing' && ch.length) {
    const words = ch.reduce((a, c) => a + (c.words || 0), 0);
    return {
      pct: Math.round((ch.filter((c) => c.status === 'final').length / ch.length) * 100),
      label: ct('writing.words', { n: words.toLocaleString() }),
    };
  }
  const open = ts.filter((t) => t.status !== 'done').length;
  return {
    pct: ts.length ? Math.round(((ts.length - open) / ts.length) * 100) : 0,
    label: ct('project.open', { count: open }),
  };
}

function ProjectCard({ p }: { p: Project }) {
  const pr = progress(p);
  return (
    <a class="card cx-pcard" href={href('project', p.id)} style={{ '--c': projectColor(p.color) }}>
      <span class="cx-pcard-top">
        <span class={`cx-status ${p.status}`}>{ct(`status.${p.status}` as CortexKey)}</span>
        <span class="num muted">{pr.label}</span>
      </span>
      <b>{p.name}</b>
      {p.description && <span class="muted cx-clamp">{p.description}</span>}
      <span class="cx-bar" style={{ '--c': projectColor(p.color) }}>
        <b style={{ width: `${pr.pct}%` }} />
      </span>
    </a>
  );
}

export function Projects() {
  const ps = liveProjects.value;
  return (
    <div class="cx-page">
      <header class="page-header">
        <div>
          <h1>{ct('nav.projects')}</h1>
          <p class="muted">
            {ct('projects.active', { count: ps.filter((p) => p.status === 'active').length })}
          </p>
        </div>
        <div class="page-actions">
          <button
            type="button"
            class="btn btn-primary btn-md"
            onClick={() => (sheet.value = { kind: 'project', id: null })}
          >
            <Icon name="plus" size={16} />
            <span>{ct('project.new')}</span>
          </button>
        </div>
      </header>
      {ps.length ? (
        <>
          {AREAS.map((a) => {
            const list = ps.filter((p) => (p.area ?? 'pro') === a && p.status !== 'done');
            return list.length ? (
              <section key={a} class="cx-area">
                <h2 class="cx-area-title">{ct(`area.${a}` as CortexKey)}</h2>
                <div class="cx-cards">
                  {list.map((p) => (
                    <ProjectCard key={p.id} p={p} />
                  ))}
                </div>
              </section>
            ) : null;
          })}
          {ps.some((p) => p.status === 'done') && (
            <section class="cx-area">
              <h2 class="cx-area-title">{ct('projects.finished')}</h2>
              <div class="cx-cards">
                {ps
                  .filter((p) => p.status === 'done')
                  .map((p) => (
                    <ProjectCard key={p.id} p={p} />
                  ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <section class="card cx-emptybox">
          <Icon name="folder" size={28} />
          <p>
            <b>{ct('projects.emptyTitle')}</b>
          </p>
          <p class="muted">{ct('projects.emptyBody')}</p>
          <button
            type="button"
            class="btn btn-primary btn-md"
            onClick={() => (sheet.value = { kind: 'project', id: null })}
          >
            {ct('project.new')}
          </button>
        </section>
      )}
    </div>
  );
}

type Tab = 'tasks' | 'notes' | 'chapters' | 'characters';

export function ProjectPage() {
  const id = route.value.param;
  const p = liveProjects.value.find((x) => x.id === id);
  const [tab, setTab] = useState<Tab>('tasks');
  const [desc, setDesc] = useState(p?.description ?? '');
  useEffect(() => {
    setDesc(p?.description ?? '');
    setTab('tasks');
  }, [id]);
  if (!p)
    return (
      <div class="cx-page">
        <section class="card cx-emptybox">
          <p>{ct('project.missing')}</p>
          <button type="button" class="btn btn-secondary btn-md" onClick={() => go('projects')}>
            {ct('nav.projects')}
          </button>
        </section>
      </div>
    );
  const writing = p.area === 'writing';
  const ts = liveTasks.value.filter((t) => t.projectId === p.id).sort(sortTasks);
  const notes = liveNotes.value
    .filter((n) => n.projectId === p.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const chapters = alive(snapshot.value.chapters)
    .filter((c) => c.projectId === p.id)
    .sort((a, b) => a.order - b.order);
  const chars = alive(snapshot.value.characters).filter((c) => c.projectId === p.id);
  const tabs: [Tab, CortexKey, number][] = [
    ['tasks', 'nav.tasks', ts.filter((t) => t.status !== 'done').length],
    ['notes', 'nav.notes', notes.length],
  ];
  if (writing)
    tabs.push(
      ['chapters', 'writing.chapters', chapters.length],
      ['characters', 'writing.characters', chars.length],
    );
  const writingLocked = writing && !can('writing', entitlement.value);
  return (
    <div class="cx-page">
      <header class="page-header">
        <div class="cx-ptitle" style={{ '--c': projectColor(p.color) }}>
          <p class="eyebrow">{ct(`area.${p.area ?? 'pro'}` as CortexKey)}</p>
          <h1>
            <i class="cx-dot lg" aria-hidden="true" />
            {p.name}
          </h1>
        </div>
        <div class="page-actions">
          <span class={`cx-status ${p.status}`}>{ct(`status.${p.status}` as CortexKey)}</span>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            onClick={() => (sheet.value = { kind: 'project', id: p.id })}
          >
            {ct('common.edit')}
          </button>
        </div>
      </header>
      <textarea
        class="cx-desc"
        id={`pdesc-${p.id}`}
        rows={2}
        maxLength={500}
        value={desc}
        placeholder={ct('project.goalPlaceholder')}
        aria-label={ct('project.goal')}
        onInput={(e) => setDesc((e.target as HTMLTextAreaElement).value)}
        onBlur={() => desc !== (p.description ?? '') && void update('projects', p.id, { description: desc })}
      />
      <div class="tabs" role="tablist" aria-label={ct('project.sections')}>
        {tabs.map(([v, l, c]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={tab === v}
            class={tab === v ? 'active' : ''}
            onClick={() => setTab(v)}
          >
            {ct(l)}
            {c > 0 && <span class="tab-count">{c}</span>}
          </button>
        ))}
      </div>
      {tab === 'tasks' && (
        <Panel title={ct('nav.tasks')}>
          {ts.filter((t) => t.status !== 'done').length ? (
            <ul class="cx-tasks">
              {ts
                .filter((t) => t.status !== 'done')
                .map((t) => (
                  <TaskRow key={t.id} t={t} date={today.value} showProject={false} />
                ))}
            </ul>
          ) : (
            <p class="cx-empty">{ct('project.noTasks')}</p>
          )}
          <AddTask id={`add-${p.id}`} projectId={p.id} />
          {ts.some((t) => t.status === 'done') && (
            <>
              <p class="cx-group">
                {ct('tasks.done', { count: ts.filter((t) => t.status === 'done').length })}
              </p>
              <ul class="cx-tasks">
                {ts
                  .filter((t) => t.status === 'done')
                  .slice(0, 15)
                  .map((t) => (
                    <TaskRow key={t.id} t={t} showProject={false} />
                  ))}
              </ul>
            </>
          )}
        </Panel>
      )}
      {tab === 'notes' && (
        <Panel
          title={ct('nav.notes')}
          actions={
            <button
              type="button"
              class="btn btn-primary btn-sm"
              onClick={() => void newNote({ projectId: p.id })}
            >
              {ct('note.new')}
            </button>
          }
        >
          {notes.length ? <NoteList notes={notes} /> : <p class="cx-empty">{ct('project.noNotes')}</p>}
        </Panel>
      )}
      {tab === 'chapters' &&
        (writingLocked ? <WritingLocked /> : <Chapters projectId={p.id} chapters={chapters} />)}
      {tab === 'characters' && (writingLocked ? <WritingLocked /> : <Characters projectId={p.id} />)}
    </div>
  );
}

function WritingLocked() {
  return (
    <section class="card cx-emptybox">
      <Icon name="lock" size={24} />
      <p>{ct('writing.locked')}</p>
      <button type="button" class="btn btn-primary btn-md" onClick={() => openUpgrade('writing')}>
        {ct('pro.discover')}
      </button>
    </section>
  );
}

const STATUSES: ChapterStatus[] = ['idea', 'draft', 'revision', 'final'];

function Chapters({ projectId, chapters }: { projectId: string; chapters: Chapter[] }) {
  const words = chapters.reduce((a, c) => a + (c.words || 0), 0);
  return (
    <>
      <div class="cx-kpis three">
        <Kpi label={ct('writing.wordsLabel')} value={words.toLocaleString()} />
        <Kpi label={ct('writing.chapters')} value={chapters.length} />
        <Kpi
          label={ct('writing.final')}
          value={
            <>
              {chapters.filter((c) => c.status === 'final').length}
              <small>/{chapters.length}</small>
            </>
          }
          pct={
            chapters.length
              ? (chapters.filter((c) => c.status === 'final').length / chapters.length) * 100
              : 0
          }
          tone="good"
        />
      </div>
      <Panel title={ct('writing.chapters')}>
        {chapters.length ? (
          <div class="cx-tablewrap">
            <table class="cx-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">{ct('writing.chapterTitle')}</th>
                  <th scope="col">{ct('writing.status')}</th>
                  <th scope="col" class="r">
                    {ct('writing.wordsLabel')}
                  </th>
                  <th scope="col">
                    <span class="sr-only">{ct('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {chapters.map((c, i) => (
                  <tr key={c.id}>
                    <td class="num muted">{i + 1}</td>
                    <td>
                      <input
                        class="cx-cell"
                        id={`ch-t-${c.id}`}
                        defaultValue={c.title}
                        aria-label={ct('writing.chapterTitle')}
                        onBlur={(e) => {
                          const v = (e.target as HTMLInputElement).value;
                          if (v !== c.title) void update('chapters', c.id, { title: v });
                        }}
                      />
                    </td>
                    <td>
                      <select
                        class={`cx-cell s-${c.status}`}
                        id={`ch-s-${c.id}`}
                        value={c.status}
                        aria-label={ct('writing.status')}
                        onChange={(e) =>
                          void update('chapters', c.id, {
                            status: (e.target as HTMLSelectElement).value as ChapterStatus,
                          })
                        }
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {ct(`chapter.${s}` as CortexKey)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td class="r">
                      <input
                        class="cx-cell w num"
                        id={`ch-w-${c.id}`}
                        type="number"
                        min={0}
                        inputMode="numeric"
                        defaultValue={String(c.words || 0)}
                        aria-label={ct('writing.wordsLabel')}
                        onBlur={(e) => {
                          const v = Math.max(0, parseInt((e.target as HTMLInputElement).value, 10) || 0);
                          if (v !== c.words) void update('chapters', c.id, { words: v });
                        }}
                      />
                    </td>
                    <td class="nowrap">
                      <button
                        type="button"
                        class="icon-btn"
                        disabled={i === 0}
                        aria-label={ct('common.moveUp')}
                        onClick={async () => {
                          const prev = chapters[i - 1]!;
                          await update('chapters', c.id, { order: prev.order });
                          await update('chapters', prev.id, { order: c.order });
                        }}
                      >
                        <Icon name="arrowUp" size={16} />
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label={ct('common.delete')}
                        onClick={() => {
                          void remove('chapters', c.id);
                          toast(ct('writing.chapterDeleted'), 'info', {
                            label: ct('common.undo'),
                            run: () => void restore('chapters', c.id),
                          });
                        }}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p class="cx-empty">{ct('writing.noChapters')}</p>
        )}
        <div class="cx-row">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            onClick={async () => {
              const c = await create('chapters', {
                projectId,
                title: ct('writing.chapterN', { n: chapters.length + 1 }),
                status: 'idea',
                words: 0,
                order: (chapters.at(-1)?.order ?? 0) + 1,
              });
              setTimeout(
                () => (document.getElementById(`ch-t-${c.id}`) as HTMLInputElement | null)?.select(),
                30,
              );
            }}
          >
            <Icon name="plus" size={16} />
            <span>{ct('writing.addChapter')}</span>
          </button>
        </div>
      </Panel>
    </>
  );
}

function Characters({ projectId }: { projectId: string }) {
  const list = alive(snapshot.value.characters).filter((c) => c.projectId === projectId);
  const save = (id: string, field: 'name' | 'role' | 'notes', value: string, prev: string) => {
    if (value !== prev) void update('characters', id, { [field]: value });
  };
  return (
    <div class="cx-chars">
      {list.map((c) => (
        <div key={c.id} class="card cx-char">
          <input
            class="cx-cell cx-char-name"
            id={`cr-n-${c.id}`}
            defaultValue={c.name}
            aria-label={ct('writing.charName')}
            onBlur={(e) => save(c.id, 'name', (e.target as HTMLInputElement).value, c.name)}
          />
          <input
            class="cx-cell"
            id={`cr-r-${c.id}`}
            defaultValue={c.role}
            placeholder={ct('writing.rolePlaceholder')}
            aria-label={ct('writing.role')}
            onBlur={(e) => save(c.id, 'role', (e.target as HTMLInputElement).value, c.role)}
          />
          <textarea
            class="cx-cell cx-char-notes"
            id={`cr-d-${c.id}`}
            defaultValue={c.notes}
            rows={4}
            placeholder={ct('writing.charPlaceholder')}
            aria-label={ct('writing.charNotes')}
            onBlur={(e) => save(c.id, 'notes', (e.target as HTMLTextAreaElement).value, c.notes)}
          />
          <div>
            <button
              type="button"
              class="btn btn-ghost btn-sm cx-danger"
              onClick={() => {
                void remove('characters', c.id);
                toast(ct('writing.charDeleted'), 'info', {
                  label: ct('common.undo'),
                  run: () => void restore('characters', c.id),
                });
              }}
            >
              {ct('common.delete')}
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        class="cx-char cx-char-add"
        onClick={async () => {
          const c = await create('characters', {
            projectId,
            name: ct('writing.newChar'),
            role: '',
            notes: '',
          });
          setTimeout(
            () => (document.getElementById(`cr-n-${c.id}`) as HTMLInputElement | null)?.select(),
            30,
          );
        }}
      >
        <Icon name="plus" size={18} />
        <span>{ct('writing.addChar')}</span>
      </button>
    </div>
  );
}

/* ---------------------------------- notes --------------------------------- */

async function newNote(fields: Partial<Note> = {}): Promise<void> {
  if (!withinLimit('notes', liveNotes.value.length, entitlement.value)) {
    openUpgrade('notes');
    return;
  }
  const n = await createNote(fields);
  go('notes', n.id);
  setTimeout(() => document.getElementById(fields.title ? 'n-body' : 'n-title')?.focus(), 60);
}

function NoteList({ notes, current }: { notes: Note[]; current?: string | null }) {
  return (
    <ul class="cx-notelist">
      {notes.map((n) => {
        const p = n.projectId ? liveProjects.value.find((x) => x.id === n.projectId) : null;
        return (
          <li key={n.id} class={current === n.id ? 'on' : ''}>
            <a href={href('notes', n.id)} aria-current={current === n.id ? 'page' : undefined}>
              <b>
                {n.pinned && <Icon name="star" size={12} />} {n.title || ct('note.untitled')}
              </b>
              {n.body && <span class="cx-clamp muted">{n.body.slice(0, 140)}</span>}
              <span class="cx-meta">
                {n.kind === 'idea' && <span class="cx-kind idea">{ct('note.idea')}</span>}
                {p && (
                  <span class="cx-tag" style={{ '--c': projectColor(p.color) }}>
                    <i />
                    {p.name}
                  </span>
                )}
                <span>{fmtRelative(n.updatedAt)}</span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function Notes() {
  const id = route.value.param;
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const all = [...liveNotes.value].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt),
  );
  const list = needle
    ? all.filter((n) => `${n.title} ${n.body} ${n.tags.join(' ')}`.toLowerCase().includes(needle))
    : all;
  const cur = id ? liveNotes.value.find((n) => n.id === id) : null;
  useEffect(() => () => flushNotes(), []);
  return (
    <div class="cx-page">
      <header class="page-header">
        <div>
          <h1>{ct('nav.notes')}</h1>
          <p class="muted">
            {ct('notes.count', { count: all.length })} ·{' '}
            {ct('notes.ideas', { count: all.filter((n) => n.kind === 'idea').length })}
          </p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-primary btn-md" onClick={() => void newNote()}>
            <Icon name="plus" size={16} />
            <span>{ct('note.new')}</span>
          </button>
        </div>
      </header>
      <div class={`card cx-notes ${cur ? 'editing' : ''}`}>
        <div class="cx-notes-list">
          <div class="cx-notes-filter">
            <input
              id="cx-nq"
              value={q}
              placeholder={ct('notes.filter')}
              aria-label={ct('notes.filter')}
              onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            />
          </div>
          {list.length ? (
            <NoteList notes={list} current={id} />
          ) : (
            <p class="cx-empty cx-pad">{needle ? ct('search.none') : ct('notes.empty')}</p>
          )}
        </div>
        <div class="cx-notes-editor">{cur ? <NoteEditor key={cur.id} note={cur} /> : <NoNote />}</div>
      </div>
    </div>
  );
}

function NoNote() {
  return (
    <div class="cx-emptybox">
      <Icon name="note" size={28} />
      <p class="muted">{ct('notes.pick')}</p>
      <button type="button" class="btn btn-primary btn-md" onClick={() => void newNote()}>
        {ct('note.new')}
      </button>
    </div>
  );
}

function NoteEditor({ note }: { note: Note }) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState(note.tags.map((t) => `#${t}`).join(' '));
  const area = useRef<HTMLTextAreaElement>(null);
  // Grow the writing area with its content.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(320, el.scrollHeight)}px`;
  }, [body]);
  const links = linksIn(body);
  const back = backlinks(liveNotes.value, { ...note, title });
  const openLink = (t: string) => {
    const n = noteByTitle(liveNotes.value, t);
    if (n) go('notes', n.id);
    else void newNote({ title: t, projectId: note.projectId ?? null });
  };
  return (
    <article class="cx-note">
      <div class="cx-note-bar">
        <a class="icon-btn cx-back" href={href('notes')} aria-label={ct('common.back')}>
          <Icon name="chevronLeft" />
        </a>
        <select
          id="n-kind"
          value={note.kind}
          aria-label={ct('note.kind')}
          onChange={(e) =>
            void update('notes', note.id, { kind: (e.target as HTMLSelectElement).value as Note['kind'] })
          }
        >
          <option value="note">{ct('note.note')}</option>
          <option value="idea">{ct('note.idea')}</option>
        </select>
        <select
          id="n-proj"
          value={note.projectId ?? ''}
          aria-label={ct('task.project')}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value || null;
            void update('notes', note.id, { projectId: v, inbox: v ? false : note.inbox });
          }}
        >
          <option value="">{ct('task.noProject')}</option>
          {liveProjects.value.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span class="cx-sp" />
        <span class="num muted cx-small">{ct('note.words', { count: wordCount(body) })}</span>
        <button
          type="button"
          class={`icon-btn ${note.pinned ? 'on' : ''}`}
          aria-pressed={Boolean(note.pinned)}
          aria-label={ct(note.pinned ? 'note.unpin' : 'note.pin')}
          onClick={() => void update('notes', note.id, { pinned: !note.pinned })}
        >
          <Icon name="star" />
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-label={ct('note.delete')}
          onClick={() => {
            flushNotes();
            void remove('notes', note.id);
            go('notes');
            toast(ct('note.deleted'), 'info', {
              label: ct('common.undo'),
              run: () => void restore('notes', note.id).then(() => go('notes', note.id)),
            });
          }}
        >
          <Icon name="trash" />
        </button>
      </div>
      <input
        id="n-title"
        class="cx-note-title"
        value={title}
        maxLength={120}
        placeholder={ct('note.titlePlaceholder')}
        aria-label={ct('note.title')}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setTitle(v);
          editNote(note.id, { title: v });
        }}
      />
      <textarea
        id="n-body"
        ref={area}
        class="cx-note-body"
        maxLength={100000}
        value={body}
        placeholder={ct('note.bodyPlaceholder')}
        aria-label={ct('note.body')}
        onInput={(e) => {
          const v = (e.target as HTMLTextAreaElement).value;
          setBody(v);
          editNote(note.id, { body: v });
        }}
      />
      <input
        id="n-tags"
        class="cx-note-tags"
        value={tags}
        placeholder={ct('note.tagsPlaceholder')}
        aria-label={ct('note.tags')}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setTags(v);
          editNote(note.id, { tags: parseTags(v) });
        }}
      />
      <div class="cx-links">
        {links.length > 0 && (
          <>
            <h3>{ct('note.linksOut')}</h3>
            <div class="cx-chiprow">
              {links.map((l) => {
                const exists = Boolean(noteByTitle(liveNotes.value, l));
                return (
                  <button
                    type="button"
                    key={l}
                    class={`cx-chip ${exists ? '' : 'new'}`}
                    onClick={() => openLink(l)}
                  >
                    <Icon name="link" size={14} />
                    {exists ? l : ct('note.createLink', { title: l })}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {back.length > 0 && (
          <>
            <h3>{ct('note.backlinks')}</h3>
            <div class="cx-chiprow">
              {back.map((n) => (
                <a key={n.id} class="cx-chip" href={href('notes', n.id)}>
                  {n.title || ct('note.untitled')}
                </a>
              ))}
            </div>
          </>
        )}
        {!links.length && !back.length && <p class="cx-hint">{ct('note.linksHint')}</p>}
      </div>
    </article>
  );
}

/* --------------------------------- writing -------------------------------- */

export function Writing() {
  const ps = liveProjects.value.filter((p) => p.area === 'writing');
  const ids = new Set(ps.map((p) => p.id));
  const chapters = alive(snapshot.value.chapters).filter((c) => ids.has(c.projectId));
  const words = chapters.reduce((a, c) => a + (c.words || 0), 0);
  let minutes = 0;
  for (let i = 0; i < 14; i++) {
    const d = getDay(shiftDay(today.value, -i));
    minutes += d.blocks
      .filter((b) => b.category === 'writing' && b.done)
      .reduce((a, b) => a + (b.end - b.start), 0);
  }
  const ideas = liveNotes.value
    .filter((n) => n.kind === 'idea')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
  return (
    <div class="cx-page">
      <header class="page-header">
        <div>
          <h1>{ct('nav.writing')}</h1>
          <p class="muted">{ct('writing.subtitle')}</p>
        </div>
        <div class="page-actions">
          <button
            type="button"
            class="btn btn-primary btn-md"
            onClick={() => (sheet.value = { kind: 'project', id: null, area: 'writing' })}
          >
            <Icon name="plus" size={16} />
            <span>{ct('writing.newBook')}</span>
          </button>
        </div>
      </header>
      <div class="cx-kpis">
        <Kpi label={ct('writing.inProgress')} value={ps.filter((p) => p.status !== 'done').length} />
        <Kpi label={ct('writing.totalWords')} value={words.toLocaleString()} />
        <Kpi
          label={ct('writing.final')}
          value={
            <>
              {chapters.filter((c) => c.status === 'final').length}
              <small>/{chapters.length}</small>
            </>
          }
        />
        <Kpi label={ct('writing.time14')} value={fmtDuration(minutes)} detail={ct('writing.time14Hint')} />
      </div>
      {ps.length ? (
        <div class="cx-cards">
          {ps.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <section class="card cx-emptybox">
          <Icon name="feather" size={28} />
          <p class="muted">{ct('writing.empty')}</p>
        </section>
      )}
      <Panel
        title={ct('writing.ideas')}
        actions={
          <button type="button" class="btn btn-ghost btn-sm" onClick={() => void newNote({ kind: 'idea' })}>
            {ct('writing.newIdea')}
          </button>
        }
      >
        {ideas.length ? <NoteList notes={ideas} /> : <p class="cx-empty">{ct('writing.noIdeas')}</p>}
      </Panel>
    </div>
  );
}
