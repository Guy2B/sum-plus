import { signal } from '@preact/signals';

export type CortexRoute =
  | 'today'
  | 'planning'
  | 'habits'
  | 'inbox'
  | 'tasks'
  | 'projects'
  | 'project'
  | 'notes'
  | 'writing'
  | 'review';

const VALID = new Set<string>([
  'today',
  'planning',
  'habits',
  'inbox',
  'tasks',
  'projects',
  'project',
  'notes',
  'writing',
  'review',
]);

function parse(hash: string): { id: CortexRoute; param: string | null } {
  const [id, param] = hash.replace(/^#\/?/, '').split('/');
  return {
    id: VALID.has(id ?? '') ? (id as CortexRoute) : 'today',
    param: param ? decodeURIComponent(param) : null,
  };
}

export const route = signal(parse(typeof location !== 'undefined' ? location.hash : ''));

export function go(id: CortexRoute, param?: string | null): void {
  const hash = `#${id}${param ? `/${encodeURIComponent(param)}` : ''}`;
  if (location.hash !== hash) location.hash = hash;
  else route.value = parse(hash);
}

export const href = (id: CortexRoute, param?: string | null): string =>
  `#${id}${param ? `/${encodeURIComponent(param)}` : ''}`;

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route.value = parse(location.hash);
    window.scrollTo?.(0, 0);
  });
}
