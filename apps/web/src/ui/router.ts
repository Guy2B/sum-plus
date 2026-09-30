import { signal } from '@preact/signals';
import type { Domain } from '../domain/types';
import type { Feature } from '../domain/entitlements';

export type RouteId =
  | 'today'
  | 'attention'
  | 'plan'
  | 'coach'
  | 'sources'
  | 'tasks'
  | 'projects'
  | 'calendar'
  | 'goals'
  | 'journal'
  | 'learning'
  | 'finance'
  | 'health'
  | 'household'
  | 'career'
  | 'mail'
  | 'social'
  | 'context'
  | 'account'
  | 'admin';

export interface RouteDef {
  id: RouteId;
  icon: string;
  group: 'main' | 'tools' | 'connected' | 'settings';
  feature?: Feature;
  domain?: Domain;
  adminOnly?: boolean;
}

export const ROUTES: RouteDef[] = [
  { id: 'today', icon: 'sun', group: 'main' },
  { id: 'attention', icon: 'bell', group: 'main' },
  { id: 'plan', icon: 'map', group: 'main' },
  { id: 'coach', icon: 'sigma', group: 'main' },
  { id: 'tasks', icon: 'check', group: 'tools' },
  { id: 'projects', icon: 'folder', group: 'tools' },
  { id: 'calendar', icon: 'calendar', group: 'tools', domain: 'calendar' },
  { id: 'goals', icon: 'target', group: 'tools' },
  { id: 'journal', icon: 'book', group: 'tools', domain: 'journal' },
  { id: 'learning', icon: 'graduation', group: 'tools', domain: 'learning' },
  { id: 'finance', icon: 'wallet', group: 'tools', feature: 'finance', domain: 'finance' },
  { id: 'health', icon: 'heart', group: 'tools', feature: 'health', domain: 'health' },
  { id: 'household', icon: 'home', group: 'tools', feature: 'household', domain: 'household' },
  { id: 'career', icon: 'briefcase', group: 'tools', feature: 'career', domain: 'career' },
  { id: 'mail', icon: 'mail', group: 'connected', domain: 'mail' },
  { id: 'social', icon: 'share', group: 'connected', feature: 'social', domain: 'social' },
  { id: 'sources', icon: 'plug', group: 'connected' },
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
