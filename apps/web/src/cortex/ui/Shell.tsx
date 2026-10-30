/**
 * Cortex shell: same structure and classes as NEXT's (sidebar, top bar,
 * bottom nav) so both apps feel like one product, plus the capture bar and
 * the search palette.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { authUser, entitlement, settings, syncState, updateSettings } from '../../data/store';
import type { Locale } from '../../domain/types';
import { isPro, withinLimit } from '../../domain/entitlements';
import { ByAlgbr } from '../../ui/by-algbr';
import { dictation, isDictating, speechSupported, startDictation, stopDictation } from '../voice';
import { Icon } from '../../ui/icons';
import { ConfirmHost, ToastHost, toast } from '../../ui/components';
import { SidebarPro, UpgradeModal } from '../../ui/pro';
import { t } from '../../i18n';
import { ct, ensureCortexLocale, type CortexKey } from '../i18n';
import {
  captureTask,
  createNote,
  habitIndex,
  liveHabits,
  liveNotes,
  liveProjects,
  liveTasks,
  today,
} from '../data';
import { go, href, route, type CortexRoute } from '../router';
import { habitsOnDay } from '../../domain/habits';
import { dayStats, isForDay, parseDay } from '../model';
import { getDay } from '../data';
import { captureFocus, captureKind, drawerOpen, paletteOpen, sheet } from './state';
import { projectColor } from './parts';
import { Sheets } from './sheets';
import { Focus } from './Focus';
import { openUpgrade } from './pro';

interface NavItem {
  id: CortexRoute;
  icon: string;
  label: CortexKey;
  count?: () => string | number | null;
  hot?: () => boolean;
}

const inboxCount = () =>
  liveTasks.value.filter((x) => x.status === 'inbox').length + liveNotes.value.filter((n) => n.inbox).length;

const MAIN: NavItem[] = [
  {
    id: 'today',
    icon: 'sun',
    label: 'nav.today',
    count: () => liveTasks.value.filter((x) => isForDay(x, today.value, today.value)).length || null,
  },
  {
    id: 'planning',
    icon: 'calendar',
    label: 'nav.planning',
    count: () => {
      const s = dayStats(getDay(today.value));
      return s.count ? `${s.done}/${s.count}` : null;
    },
  },
  {
    id: 'habits',
    icon: 'repeat',
    label: 'nav.habits',
    count: () => {
      const h = habitsOnDay(liveHabits.value, habitIndex.value, parseDay(today.value));
      return h.due ? `${h.done}/${h.due}` : null;
    },
  },
];
const LIBRARY: NavItem[] = [
  {
    id: 'inbox',
    icon: 'inbox',
    label: 'nav.inbox',
    count: () => inboxCount() || null,
    hot: () => inboxCount() > 0,
  },
  {
    id: 'tasks',
    icon: 'check',
    label: 'nav.tasks',
    count: () => liveTasks.value.filter((x) => x.status !== 'done').length || null,
  },
  { id: 'projects', icon: 'folder', label: 'nav.projects' },
  { id: 'notes', icon: 'note', label: 'nav.notes', count: () => liveNotes.value.length || null },
  { id: 'writing', icon: 'feather', label: 'nav.writing' },
];
const REFLECT: NavItem[] = [{ id: 'review', icon: 'chart', label: 'nav.review' }];
const MOBILE: NavItem[] = [MAIN[0]!, MAIN[1]!, MAIN[2]!, LIBRARY[3]!];

function NavGroup({ title, items }: { title?: string; items: NavItem[] }) {
  const cur = route.value.id === 'project' ? 'projects' : route.value.id;
  return (
    <div class="nav-group">
      {title && <p class="nav-group-title">{title}</p>}
      <ul>
        {items.map((r) => {
          const c = r.count?.();
          return (
            <li key={r.id}>
              <a
                href={href(r.id)}
                class={cur === r.id ? 'active' : ''}
                aria-current={cur === r.id ? 'page' : undefined}
                onClick={() => (drawerOpen.value = false)}
              >
                <Icon name={r.icon} />
                <span>{ct(r.label)}</span>
                {c != null && <span class={`nav-count ${r.hot?.() ? 'hot' : ''}`}>{c}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProjectNav() {
  const areas = [
    ['pro', 'area.pro'],
    ['writing', 'area.writing'],
    ['personal', 'area.personal'],
  ] as const;
  const open = (id: string) => route.value.id === 'project' && route.value.param === id;
  return (
    <>
      {areas.map(([a, label]) => {
        const ps = liveProjects.value.filter((p) => (p.area ?? 'pro') === a && p.status !== 'done');
        return (
          <div class="nav-group cx-projects" key={a}>
            <p class="nav-group-title cx-group-row">
              <span>{ct(label)}</span>
              <button
                type="button"
                class="cx-plus"
                aria-label={ct('project.newIn', { area: ct(label) })}
                onClick={() => (sheet.value = { kind: 'project', id: null, area: a })}
              >
                +
              </button>
            </p>
            <ul>
              {ps.map((p) => {
                const n = liveTasks.value.filter((x) => x.projectId === p.id && x.status !== 'done').length;
                return (
                  <li key={p.id}>
                    <a
                      href={href('project', p.id)}
                      class={open(p.id) ? 'active' : ''}
                      aria-current={open(p.id) ? 'page' : undefined}
                      onClick={() => (drawerOpen.value = false)}
                    >
                      <i class="cx-dot" style={{ background: projectColor(p.color) }} aria-hidden="true" />
                      <span>{p.name}</span>
                      {n > 0 && <span class="nav-count">{n}</span>}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function SyncLine() {
  const s = syncState.value;
  const user = authUser.value;
  const label = !user
    ? ct('sync.local')
    : s.status === 'error' || s.status === 'blocked'
      ? ct('sync.error')
      : s.status === 'offline'
        ? ct('sync.offline')
        : ct('sync.on');
  const tone = !user ? '' : s.status === 'error' || s.status === 'blocked' ? 'bad' : 'good';
  return (
    <a class="cx-sync" href="app.html#account" title={ct('sync.manage')}>
      <i class={tone} aria-hidden="true" />
      <span>{label}</span>
    </a>
  );
}

function Brand() {
  return (
    <span class="nsxt" aria-hidden="true">
      cort<b>Σ</b>x
    </span>
  );
}

export function Shell({ children }: { children: ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? '');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        paletteOpen.value = true;
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || sheet.value || paletteOpen.value) return;
      if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        captureFocus.value++;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const s = settings.value;
  const user = authUser.value;
  const cur = [...MAIN, ...LIBRARY, ...REFLECT].find(
    (r) => r.id === (route.value.id === 'project' ? 'projects' : route.value.id),
  );
  return (
    <div class="app cx-app">
      <a href="#main" class="skip-link">
        {t('a11y.skip')}
      </a>
      <aside class={`sidebar ${drawerOpen.value ? 'open' : ''}`} aria-label={ct('nav.label')}>
        <div class="brand">
          <div>
            <a class="brand-home" href={href('today')} aria-label="Cortex">
              <Brand />
            </a>{' '}
            <ByAlgbr />
            <small class="muted">{ct('brand.tagline')}</small>
          </div>
        </div>
        <div class="sidebar-actions">
          <button
            type="button"
            class="sidebar-action"
            onClick={() => {
              drawerOpen.value = false;
              captureFocus.value++;
            }}
          >
            <Icon name="edit" size={18} />
            <span>{ct('capture.action')}</span>
            <kbd class="hide-sm">C</kbd>
          </button>
          <button
            type="button"
            class="sidebar-action"
            onClick={() => {
              drawerOpen.value = false;
              paletteOpen.value = true;
            }}
          >
            <Icon name="search" size={18} />
            <span>{ct('search.title')}</span>
            <kbd class="hide-sm">Ctrl K</kbd>
          </button>
        </div>
        <nav class="nav" aria-label={ct('nav.label')}>
          <NavGroup items={MAIN} />
          <NavGroup title={ct('nav.group.library')} items={LIBRARY} />
          <NavGroup title={ct('nav.group.reflect')} items={REFLECT} />
          <ProjectNav />
        </nav>
        <div class="sidebar-foot">
          <SidebarPro />
          <a class="cx-next-link" href="app.html">
            <span class="nsxt" aria-hidden="true">
              n<b>Σ</b>xt
            </span>
            <span>{ct('nav.openNext')}</span>
            <Icon name="external" size={14} />
          </a>
          <SyncLine />
          <LangSwitch />
          <a href="app.html#account" class="account-chip">
            <span class="avatar" aria-hidden="true">
              {(s.name || user?.email || 'Σ').slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{s.name || t('account.guest')}</strong>
              <small class="muted">{isPro(entitlement.value) ? t('plan.pro') : t('plan.free')}</small>
            </span>
          </a>
        </div>
      </aside>
      {drawerOpen.value && <div class="scrim" onClick={() => (drawerOpen.value = false)} />}

      <div class="main-col">
        <header class="topbar">
          <button
            type="button"
            class="icon-btn"
            aria-label={ct('nav.open')}
            onClick={() => (drawerOpen.value = true)}
          >
            <Icon name="menu" />
          </button>
          <span class="topbar-brand">
            <a class="brand-home" href={href('today')} aria-label="Cortex">
              <Brand />
            </a>{' '}
            <ByAlgbr />
          </span>
          <span class="topbar-title">{cur ? ct(cur.label) : 'Cortex'}</span>
          <button
            type="button"
            class="icon-btn"
            aria-label={ct('search.title')}
            onClick={() => (paletteOpen.value = true)}
          >
            <Icon name="search" />
          </button>
        </header>
        <CaptureBar />
        <main id="main" tabIndex={-1} class="cx-main">
          {children}
        </main>
      </div>

      <nav class="bottom-nav" aria-label={ct('nav.mobile')}>
        {MOBILE.map((r) => (
          <a
            key={r.id}
            href={href(r.id)}
            class={route.value.id === r.id ? 'active' : ''}
            aria-current={route.value.id === r.id ? 'page' : undefined}
          >
            <Icon name={r.icon} />
            <span>{ct(r.label)}</span>
          </a>
        ))}
        <button type="button" onClick={() => (drawerOpen.value = true)}>
          <Icon name="more" />
          <span>{t('nav.more')}</span>
        </button>
      </nav>
      <Palette />
      <Sheets />
      <Focus />
      <UpgradeModal />
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}

/* -------------------------------- language -------------------------------- */

/** NEXT's four languages, one tap away; the choice is shared with NEXT. */
const LANGS: [Locale, string, string][] = [
  ['fr', 'FR', 'Français'],
  ['en', 'EN', 'English'],
  ['de', 'DE', 'Deutsch'],
  ['es', 'ES', 'Español'],
];

function LangSwitch() {
  const cur = settings.value.locale;
  return (
    <div class="cx-lang" role="group" aria-label={ct('lang.label')}>
      {LANGS.map(([l, short, name]) => (
        <button
          type="button"
          key={l}
          lang={l}
          aria-pressed={cur === l}
          aria-label={name}
          title={name}
          onClick={() => {
            if (cur === l) return;
            void ensureCortexLocale(l)
              .catch(() => undefined)
              .then(() => updateSettings({ locale: l }));
          }}
        >
          {short}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- capture -------------------------------- */

function CaptureBar() {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (captureFocus.value) input.current?.focus();
  }, [captureFocus.value]);
  const inProject = route.value.id === 'project' ? route.value.param : null;
  const listening = isDictating('capture');
  const submit = async () => {
    if (isDictating('capture')) stopDictation();
    const v = text.trim();
    if (!v) return;
    const kind = captureKind.value;
    if (kind === 'task') {
      await captureTask({ text: v, projectId: inProject });
    } else {
      if (!withinLimit('notes', liveNotes.value.length, entitlement.value)) {
        openUpgrade('notes');
        return;
      }
      await createNote({
        title: v.slice(0, 120),
        kind: kind === 'idea' ? 'idea' : 'note',
        projectId: inProject,
        inbox: !inProject,
      });
    }
    setText('');
    const p = inProject ? liveProjects.value.find((x) => x.id === inProject) : null;
    toast(p ? ct('capture.addedTo', { name: p.name }) : ct('capture.toInbox'), 'good');
  };
  return (
    <form
      class="cx-capture"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Icon name="plus" size={18} />
      <input
        ref={input}
        id="cx-capture"
        value={text}
        maxLength={300}
        autoComplete="off"
        placeholder={
          listening
            ? dictation.value?.interim || ct('voice.listening')
            : ct(`capture.placeholder.${captureKind.value}` as CortexKey)
        }
        aria-label={ct('capture.label')}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
      {speechSupported() && (
        <button
          type="button"
          class={`icon-btn cx-mic ${listening ? 'on' : ''}`}
          aria-pressed={listening}
          aria-label={ct(listening ? 'voice.stop' : 'voice.dictate')}
          title={ct(listening ? 'voice.stop' : 'voice.dictate')}
          onClick={() => {
            if (listening) return stopDictation();
            input.current?.focus();
            startDictation('capture', (t) =>
              setText((cur) => `${cur.trim()} ${t.trim()}`.trim().slice(0, 300)),
            );
          }}
        >
          <Icon name={listening ? 'stopSquare' : 'mic'} size={18} />
        </button>
      )}
      <div class="cx-ktype" role="group" aria-label={ct('capture.type')}>
        {(['task', 'note', 'idea'] as const).map((k) => (
          <button
            type="button"
            key={k}
            aria-pressed={captureKind.value === k}
            onClick={() => {
              captureKind.value = k;
              input.current?.focus();
            }}
          >
            {ct(`capture.kind.${k}` as CortexKey)}
          </button>
        ))}
      </div>
    </form>
  );
}

/* --------------------------------- palette -------------------------------- */

interface Hit {
  kind: CortexKey;
  title: string;
  run: () => void;
}

function Palette() {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const open = paletteOpen.value;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setQ('');
      setI(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);
  if (!open) return null;
  const close = () => (paletteOpen.value = false);
  const needle = q.trim().toLowerCase();
  const has = (s: string) => !needle || s.toLowerCase().includes(needle);
  const hits: Hit[] = [];
  for (const r of [...MAIN, ...LIBRARY, ...REFLECT])
    if (has(ct(r.label))) hits.push({ kind: 'search.view', title: ct(r.label), run: () => go(r.id) });
  if (needle) {
    for (const p of liveProjects.value)
      if (has(p.name)) hits.push({ kind: 'search.project', title: p.name, run: () => go('project', p.id) });
    for (const n of liveNotes.value)
      if (has(`${n.title} ${n.body} ${n.tags.join(' ')}`))
        hits.push({
          kind: n.kind === 'idea' ? 'search.idea' : 'search.note',
          title: n.title || ct('note.untitled'),
          run: () => go('notes', n.id),
        });
    for (const x of liveTasks.value)
      if (x.status !== 'done' && has(x.title))
        hits.push({
          kind: 'search.task',
          title: x.title,
          run: () => (sheet.value = { kind: 'task', id: x.id }),
        });
    for (const h of liveHabits.value)
      if (has(h.name)) hits.push({ kind: 'search.habit', title: h.name, run: () => go('habits') });
    hits.push({
      kind: 'search.create',
      title: ct('search.createNote', { title: q.trim() }),
      run: () => void createNote({ title: q.trim().slice(0, 120) }).then((n) => go('notes', n.id)),
    });
  }
  const list = hits.slice(0, 40);
  const pick = (k: number) => {
    const h = list[k];
    if (!h) return;
    close();
    h.run();
  };
  return (
    <div class="cx-scrim" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="cx-palette" role="dialog" aria-modal="true" aria-label={ct('search.title')}>
        <input
          ref={input}
          id="cx-palette"
          value={q}
          placeholder={ct('search.placeholder')}
          aria-label={ct('search.title')}
          autoComplete="off"
          onInput={(e) => {
            setQ((e.target as HTMLInputElement).value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setI(Math.min(list.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setI(Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(i);
            } else if (e.key === 'Escape') close();
          }}
        />
        <ul>
          {list.map((h, k) => (
            <li key={k} class={k === i ? 'on' : ''}>
              <button type="button" onClick={() => pick(k)} onMouseEnter={() => setI(k)}>
                <span class="t">{h.title}</span>
                <span class="k">{ct(h.kind)}</span>
              </button>
            </li>
          ))}
          {!list.length && <li class="muted cx-pad">{ct('search.none')}</li>}
        </ul>
      </div>
    </div>
  );
}
