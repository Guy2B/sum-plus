import { signal } from '@preact/signals';
import type { Domain } from '../domain/types';
import type { Feature } from '../domain/entitlements';

export type RouteId =
  | 'today'
  | 'attention'
  | 'plan'
  | 'coach'
  | 'sources'
  | 'missions'
  | 'tasks'
  | 'projects'
  | 'calendar'
  | 'goals'
  | 'journal'
  | 'finance'
  | 'health'
  | 'household'
  | 'mail'
  | 'social'
  | 'context'
  | 'account'
  | 'admin';

export interface RouteDef {
  id: RouteId;
  icon: string;
  group: 'main' | 'library' | 'settings';
  feature?: Feature;
  domain?: Domain;
  adminOnly?: boolean;
}

export const ROUTES: RouteDef[] = [
  { id: 'today', icon: 'sun', group: 'main' },
  { id: 'attention', icon: 'bell', group: 'main' },
  { id: 'plan', icon: 'map', group: 'main' },
  { id: 'coach', icon: 'sigma', group: 'main' },
  { id: 'missions', icon: 'flame', group: 'library' },
  { id: 'tasks', icon: 'check', group: 'library' },
  { id: 'projects', icon: 'folder', group: 'library' },
  { id: 'calendar', icon: 'calendar', group: 'library', domain: 'calendar' },
  { id: 'goals', icon: 'target', group: 'library' },
  { id: 'journal', icon: 'book', group: 'library', domain: 'journal' },
  { id: 'finance', icon: 'wallet', group: 'library', feature: 'finance', domain: 'finance' },
  { id: 'health', icon: 'heart', group: 'library', feature: 'health', domain: 'health' },
  { id: 'household', icon: 'home', group: 'library', feature: 'household', domain: 'household' },
  { id: 'mail', icon: 'mail', group: 'library', domain: 'mail' },
  { id: 'social', icon: 'share', group: 'library', feature: 'social', domain: 'social' },
  { id: 'sources', icon: 'plug', group: 'settings' },
  { id: 'context', icon: 'compass', group: 'settings' },
  { id: 'account', icon: 'user', group: 'settings' },
  { id: 'admin', icon: 'shield', group: 'settings', adminOnly: true },
];

const VALID = new Set<string>(ROUTES.map((r) => r.id));

function parse(hash: string): { id: RouteId; param: string | null } {
  const [id, param] = hash.replace(/^#\/?/, '').split('/');
  return {
    id: VALID.has(id ?? '') ? (id as RouteId) : 'today',
    param: param ? decodeURIComponent(param) : null,
  };
}

export const route = signal(parse(typeof location !== 'undefined' ? location.hash : ''));

export function navigate(id: RouteId, param?: string): void {
  const hash = `#${id}${param ? `/${encodeURIComponent(param)}` : ''}`;
  if (location.hash !== hash) location.hash = hash;
  else route.value = parse(hash);
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route.value = parse(location.hash);
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  });
}
