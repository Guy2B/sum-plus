import type { CollectionName, Snapshot } from './types';
import { normalizeText } from './text';

export interface SearchHit {
  collection: CollectionName;
  id: string;
  title: string;
  detail?: string;
  route: string;
  score: number;
}

type Extract = (d: never) => { title: string; detail?: string; body?: string };

const INDEX: Partial<Record<CollectionName, { route: string; extract: Extract }>> = {
  tasks: {
    route: 'tasks',
    extract: ((d: Snapshot['tasks'][number]) => ({ title: d.title, body: d.notes })) as Extract,
  },
  projects: {
    route: 'projects',
    extract: ((d: Snapshot['projects'][number]) => ({
      title: d.name,
      detail: d.client,
      body: `${d.description ?? ''} ${d.milestones.map((m) => m.title).join(' ')}`,
    })) as Extract,
  },
  events: {
    route: 'calendar',
    extract: ((d: Snapshot['events'][number]) => ({
      title: d.title,
      detail: d.start.slice(0, 10),
      body: d.location,
    })) as Extract,
  },
  journal: {
    route: 'journal',
    extract: ((d: Snapshot['journal'][number]) => ({
      title: d.text.slice(0, 80),
      detail: d.date,
      body: d.text,
    })) as Extract,
  },
  skills: {
    route: 'learning',
    extract: ((d: Snapshot['skills'][number]) => ({
      title: d.name,
      detail: d.target,
      body: d.resources.map((r) => r.title).join(' '),
    })) as Extract,
  },
  finance: {
    route: 'finance',
    extract: ((d: Snapshot['finance'][number]) => ({
      title: d.label,
      detail: d.date,
      body: `${d.category} ${d.counterparty ?? ''}`,
    })) as Extract,
  },
  goals: {
    route: 'context',
    extract: ((d: Snapshot['goals'][number]) => ({ title: d.title, body: d.why })) as Extract,
  },
  contacts: {
    route: 'sources',
    extract: ((d: Snapshot['contacts'][number]) => ({ title: d.name, detail: d.email })) as Extract,
  },
  mailMessages: {
    route: 'mail',
    extract: ((d: Snapshot['mailMessages'][number]) => ({
      title: d.subject,
      detail: d.sender,
      body: d.snippet,
    })) as Extract,
  },
  socialItems: {
    route: 'social',
    extract: ((d: Snapshot['socialItems'][number]) => ({
      title: d.text.slice(0, 80),
      detail: d.author,
      body: d.text,
    })) as Extract,
  },
  applications: {
    route: 'career',
    extract: ((d: Snapshot['applications'][number]) => ({
      title: `${d.role} — ${d.company}`,
      detail: d.stage,
      body: d.notes,
    })) as Extract,
  },
  schoolItems: {
    route: 'household',
    extract: ((d: Snapshot['schoolItems'][number]) => ({
      title: d.title,
      detail: d.dueDate ?? undefined,
    })) as Extract,
  },
};

/** Accent- and case-insensitive search; every query word must match. */
export function search(snap: Snapshot, query: string, limit = 30): SearchHit[] {
  const terms = normalizeText(query)
    .split(' ')
    .filter((t) => t.length > 1);
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  for (const [collection, spec] of Object.entries(INDEX) as [
    CollectionName,
    { route: string; extract: Extract },
  ][]) {
    for (const doc of snap[collection] as { id: string; deletedAt?: string | null }[]) {
      if (doc.deletedAt) continue;
      const { title, detail, body } = spec.extract(doc as never);
      const hayTitle = normalizeText(title);
      const hay = `${hayTitle} ${normalizeText(detail ?? '')} ${normalizeText(body ?? '')}`;
      if (!terms.every((t) => hay.includes(t))) continue;
      const score = terms.reduce(
        (s, t) => s + (hayTitle.startsWith(t) ? 3 : hayTitle.includes(t) ? 2 : 1),
        0,
      );
      hits.push({ collection, id: doc.id, title, detail, route: spec.route, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
