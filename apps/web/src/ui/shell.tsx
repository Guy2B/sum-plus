import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { t } from '../i18n';
import { Icon } from './icons';
import { ROUTES, navigate, route, type RouteDef } from './router';
import { authUser, entitlement, settings, snapshot, syncState } from '../data/store';
import { visibleAttention } from '../data/actions';
import { can, isPro } from '../domain/entitlements';
import { getEdition } from '../domain/editions';
import { search } from '../domain/search';
import { askCoach, captureTask, composerFocus } from './composer';
import { domainEnabled } from '../domain/signals';

export const drawerOpen = signal(false);
export const paletteOpen = signal(false);

export function navLabel(r: RouteDef): string {
  const ed = getEdition(settings.value.edition, settings.value.locale);
  const map: Partial<Record<string, string>> = {
    tasks: ed.nav.tasks,
    calendar: ed.nav.planner,
    projects: ed.nav.projects,
    finance: ed.nav.finance,
    health: ed.nav.health,
    learning: ed.nav.learning,
  };
  return map[r.id] ?? t(`nav.${r.id}`);
}

function visibleRoutes(): RouteDef[] {
  const ctx = settings.value.context;
  return ROUTES.filter(
    (r) => (!r.adminOnly || authUser.value?.isAdmin) && (!r.domain || domainEnabled(ctx, r.domain)),
  );
}

function attentionCount(): number {
  const a = visibleAttention.value;
  return a.reply.length + a.opportunity.length + a.admin.length;
}

function NavList({ onPick }: { onPick?: () => void }) {
  const groups: RouteDef['group'][] = ['main', 'tools', 'connected', 'settings'];
  const current = route.value.id;
  const routes = visibleRoutes();
  return (
    <nav aria-label={t('nav.label')} class="nav">
      {groups.map((g) => (
        <div class="nav-group" key={g}>
          {g !== 'main' && <p class="nav-group-title">{t(`nav.group.${g}`)}</p>}
          <ul>
            {routes
              .filter((r) => r.group === g)
              .map((r) => {
                const locked = r.feature && !can(r.feature, entitlement.value);
                const count = r.id === 'attention' ? attentionCount() : 0;
                return (
                  <li key={r.id}>
                    <a
                      href={`#${r.id}`}
                      class={current === r.id ? 'active' : ''}
                      aria-current={current === r.id ? 'page' : undefined}
                      onClick={() => onPick?.()}
                    >
                      <Icon name={r.icon} />
                      <span>{navLabel(r)}</span>
                      {count > 0 && <span class="nav-count">{count}</span>}
                      {locked && <Icon name="lock" size={14} label={t('pro.badge')} />}
                    </a>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SyncBadge() {
  const s = syncState.value;
  const user = authUser.value;
  if (!user) return null;
  const map: Record<string, { icon: string; key: string }> = {
    off: { icon: 'cloudOff', key: 'sync.off' },
    idle: { icon: 'cloud', key: 'sync.idle' },
    syncing: { icon: 'refresh', key: 'sync.syncing' },
    error: { icon: 'alert', key: 'sync.error' },
    offline: { icon: 'cloudOff', key: 'sync.offline' },
    blocked: { icon: 'lock', key: 'sync.blocked' },
  };
  const m = map[s.status] ?? map.off!;
  return (
    <a href="#account/sync" class={`sync-badge sync-${s.status}`} title={t(m.key)}>
      <Icon name={m.icon} size={16} />
      <span>{t(m.key)}</span>
    </a>
  );
}

function CommandPalette() {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const open = paletteOpen.value;
  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);
  if (!open) return null;
  const routes = visibleRoutes()
    .filter((r) => !q || navLabel(r).toLowerCase().includes(q.toLowerCase()))
    .map((r) => ({
      key: `r:${r.id}`,
      title: navLabel(r),
      detail: t('palette.page'),
      go: () => navigate(r.id),
    }));
  const hits =
    q.length > 1
      ? search(snapshot.value, q, 20).map((h) => ({
          key: `h:${h.collection}:${h.id}`,
          title: h.title,
          detail: `${t(`collection.${h.collection}`)}${h.detail ? ` · ${h.detail}` : ''}`,
          go: () => navigate(h.route as never, h.id),
        }))
      : [];
  const query = q.trim();
  const commands = query
    ? [
        {
          key: 'c:task',
          icon: 'plus',
          title: t('palette.createTask', { q: query }),
          detail: t('composer.task'),
          go: () => void captureTask(query),
        },
        {
          key: 'c:ask',
          icon: 'sigma',
          title: t('palette.ask', { q: query }),
          detail: t('composer.ask'),
          go: () => askCoach(query),
        },
      ]
    : [];
  const items: { key: string; icon?: string; title: string; detail: string; go: () => void }[] = [
    ...routes.slice(0, 6),
    ...commands,
    ...hits,
  ];
  const pick = (i: number) => {
    items[i]?.go();
    paletteOpen.value = false;
  };
  return (
    <div class="palette-backdrop" onClick={() => (paletteOpen.value = false)}>
      <div
        class="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            value={q}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.placeholder')}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[idx] ? `pal-${idx}` : undefined}
            onInput={(e) => {
              setQ((e.currentTarget as HTMLInputElement).value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setIdx(Math.min(items.length - 1, idx + 1));
              else if (e.key === 'ArrowUp') setIdx(Math.max(0, idx - 1));
              else if (e.key === 'Enter') pick(idx);
              else if (e.key === 'Escape') paletteOpen.value = false;
              else return;
              e.preventDefault();
            }}
          />
        </div>
        <ul id="palette-list" role="listbox" class="palette-list">
          {items.map((it, i) => (
            <li
              key={it.key}
              id={`pal-${i}`}
              role="option"
              aria-selected={i === idx}
              class={i === idx ? 'active' : ''}
              onMouseEnter={() => setIdx(i)}
              onClick={() => pick(i)}
            >
              {it.icon && <Icon name={it.icon} size={16} />}
              <span>{it.title}</span>
              <small class="muted">{it.detail}</small>
            </li>
          ))}
          {!items.length && <li class="muted">{t('palette.empty')}</li>}
        </ul>
      </div>
    </div>
  );
}

export function Shell({ children, banner }: { children: ComponentChildren; banner?: ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        paletteOpen.value = !paletteOpen.value;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const s = settings.value;
  const ed = getEdition(s.edition, s.locale);
  const user = authUser.value;
  const current = ROUTES.find((r) => r.id === route.value.id);
  const newCapture = () => {
    drawerOpen.value = false;
    navigate('today');
    composerFocus.value++;
  };
  const mobileMain = ROUTES.filter((r) => r.group === 'main');
  return (
    <div class="app">
      <a href="#main" class="skip-link">
        {t('a11y.skip')}
      </a>
      <aside class={`sidebar ${drawerOpen.value ? 'open' : ''}`} aria-label={t('nav.label')}>
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">
            Σ
          </span>
          <div>
            <strong>Σ Life OS</strong>
            <small class="muted">{ed.name}</small>
          </div>
        </div>
        <div class="sidebar-actions">
          <button type="button" class="sidebar-action" onClick={newCapture}>
            <Icon name="edit" size={18} />
            <span>{t('nav.new')}</span>
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
            <span>{t('palette.title')}</span>
            <kbd class="hide-sm">Ctrl K</kbd>
          </button>
        </div>
        <NavList onPick={() => (drawerOpen.value = false)} />
        <div class="sidebar-foot">
          <SyncBadge />
          <a href="#account" class="account-chip">
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
            aria-label={t('nav.open')}
            onClick={() => (drawerOpen.value = true)}
          >
            <Icon name="menu" />
          </button>
          <span class="topbar-title">{current ? navLabel(current) : 'Σ'}</span>
          <button
            type="button"
            class="icon-btn"
            aria-label={t('palette.title')}
            onClick={() => (paletteOpen.value = true)}
          >
            <Icon name="search" />
          </button>
          <button type="button" class="icon-btn" aria-label={t('nav.new')} onClick={newCapture}>
            <Icon name="edit" />
          </button>
        </header>
        {banner}
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </div>

      <nav class="bottom-nav" aria-label={t('nav.mobile')}>
        {mobileMain.map((r) => (
          <a
            key={r.id}
            href={`#${r.id}`}
            class={route.value.id === r.id ? 'active' : ''}
            aria-current={route.value.id === r.id ? 'page' : undefined}
          >
            <Icon name={r.icon} />
            <span>{navLabel(r)}</span>
          </a>
        ))}
        <button type="button" onClick={() => (drawerOpen.value = true)}>
          <Icon name="more" />
          <span>{t('nav.more')}</span>
        </button>
      </nav>
      <CommandPalette />
    </div>
  );
}
