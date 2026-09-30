import content from './edition-content.json';
import type { EditionKey, Locale } from './types';
import type { Signal } from './signals';
import { normalizeText } from './text';

export const EDITION_KEYS: readonly EditionKey[] = ['student', 'solo', 'creator', 'life', 'nomad'];

export interface EditionCopy {
  name: string;
  short: string;
  promise: string;
  hero: string;
  nav: {
    tasks: string;
    planner: string;
    projects: string;
    finance: string;
    health: string;
    learning: string;
  };
  labels: { priority: string; essentials: string; habits: string; focus: string };
  kpis: string[];
  coachWelcome: string;
  prompts: [string, string][];
  templates: string[];
}

export interface EditionDemo {
  tasks: string[];
  project: string[];
  income: string;
  expense: string;
  journal: string;
  gratitude: string;
  skill: string;
  goals: string[];
  events: string[];
}

export interface Edition extends EditionCopy {
  key: EditionKey;
  icon: string;
  accent: string;
  soft: string;
}

type ContentShape = {
  base: Record<EditionKey, { icon: string; accent: string; soft: string }>;
  copy: Record<Locale, Record<EditionKey, EditionCopy>>;
  demo: Record<Locale, Record<EditionKey, EditionDemo>>;
};
const data = content as unknown as ContentShape;

const LEGACY: Record<string, EditionKey> = { professional: 'solo', personal: 'life', 'solo-micro': 'solo' };

export function normalizeEdition(value: unknown): EditionKey {
  const raw = normalizeText(value);
  if (LEGACY[raw]) return LEGACY[raw];
  return (EDITION_KEYS as readonly string[]).includes(raw) ? (raw as EditionKey) : 'solo';
}

export function getEdition(key: EditionKey, locale: Locale): Edition {
  const copy = data.copy[locale]?.[key] ?? data.copy.en[key];
  return { key, ...data.base[key], ...copy };
}

export function listEditions(locale: Locale): Edition[] {
  return EDITION_KEYS.map((k) => getEdition(k, locale));
}

export function editionDemo(key: EditionKey, locale: Locale): EditionDemo {
  return structuredClone(data.demo[locale]?.[key] ?? data.demo.en[key]);
}

/* ------------------------------------------------------------------------ */
/* Decision profiles: how each edition re-weights the same signals.          */
/* ------------------------------------------------------------------------ */

const TAG_WORDS: Record<string, string[]> = {
  academic: [
    'exam',
    'examen',
    'course',
    'cours',
    'assignment',
    'devoir',
    'revision',
    'study',
    'etude',
    'university',
    'universite',
    'thesis',
    'memoire',
    'dissertation',
    'scholarship',
    'bourse',
    'professor',
    'professeur',
    'school',
    'ecole',
    'classe',
    'prufung',
    'examen',
  ],
  client: [
    'client',
    'customer',
    'prospect',
    'lead',
    'devis',
    'quote',
    'proposal',
    'proposition',
    'contract',
    'contrat',
    'mission',
    'kunde',
    'angebot',
    'cliente',
    'propuesta',
  ],
  money: [
    'invoice',
    'facture',
    'payment',
    'paiement',
    'cashflow',
    'tresorerie',
    'revenue',
    'revenu',
    'expense',
    'depense',
    'tax',
    'impot',
    'vat',
    'tva',
    'bank',
    'banque',
    'rechnung',
    'zahlung',
    'factura',
    'pago',
  ],
  sales: [
    'sale',
    'sales',
    'vente',
    'commercial',
    'prospection',
    'launch',
    'lancement',
    'offer',
    'offre',
    'conversion',
    'verkauf',
    'venta',
  ],
  creator: [
    'content',
    'contenu',
    'publish',
    'publier',
    'publication',
    'newsletter',
    'podcast',
    'video',
    'youtube',
    'sponsor',
    'audience',
    'subscriber',
    'abonne',
    'episode',
    'record',
    'enregistrer',
    'montage',
    'contenido',
  ],
  personal: [
    'family',
    'famille',
    'home',
    'maison',
    'household',
    'foyer',
    'personal',
    'personnel',
    'appointment',
    'rendez-vous',
    'budget',
    'habit',
    'habitude',
    'familie',
    'familia',
  ],
  wellbeing: [
    'health',
    'sante',
    'energy',
    'energie',
    'sleep',
    'sommeil',
    'rest',
    'repos',
    'walk',
    'marche',
    'stress',
    'wellbeing',
    'bien-etre',
    'schlaf',
    'sueno',
  ],
  mobility: [
    'travel',
    'voyage',
    'trip',
    'deplacement',
    'flight',
    'vol',
    'train',
    'visa',
    'passport',
    'passeport',
    'residence',
    'insurance',
    'assurance',
    'accommodation',
    'logement',
    'hotel',
    'border',
    'frontiere',
    'embassy',
    'ambassade',
    'reise',
    'viaje',
  ],
  language: [
    'language',
    'langue',
    'english',
    'anglais',
    'french',
    'francais',
    'german',
    'allemand',
    'spanish',
    'espagnol',
    'portuguese',
    'portugais',
    'sprache',
    'idioma',
  ],
  deadline: [
    'deadline',
    'echeance',
    'due',
    'urgent',
    'urgente',
    'tomorrow',
    'demain',
    'today',
    "aujourd'hui",
    'overdue',
    'retard',
    'frist',
    'plazo',
  ],
  administration: [
    'administrative',
    'administratif',
    'document',
    'form',
    'formulaire',
    'renewal',
    'renouvellement',
    'registration',
    'inscription',
    'compliance',
    'conformite',
    'antrag',
    'tramite',
  ],
};

export interface EditionProfile {
  key: EditionKey;
  boosts: Record<string, number>;
  penalties: Record<string, number>;
  sourceBoosts: Record<string, number>;
  intentBoosts: Record<string, number>;
  preferredTags: string[];
}

export const EDITION_PROFILES: Record<EditionKey, EditionProfile> = {
  student: {
    key: 'student',
    preferredTags: ['academic', 'deadline', 'task', 'calendar', 'wellbeing'],
    boosts: { academic: 24, deadline: 12, wellbeing: 7, language: 6 },
    sourceBoosts: { task: 8, event: 7, learning: 6 },
    intentBoosts: { request: 5, information: 2 },
    penalties: { client: -18, sales: -24, money: -10, creator: -8 },
  },
  solo: {
    key: 'solo',
    preferredTags: ['client', 'money', 'sales', 'deadline', 'administration', 'reply', 'task'],
    boosts: { client: 22, money: 20, sales: 15, deadline: 13, administration: 9, reply: 8 },
    sourceBoosts: { mail: 5, task: 5, event: 4, finance: 6, project: 5 },
    intentBoosts: { opportunity: 12, transactional: 10, request: 7 },
    penalties: { academic: -18, creator: -5, social: -7 },
  },
  creator: {
    key: 'creator',
    preferredTags: ['creator', 'deadline', 'sales', 'money', 'reply', 'task', 'calendar'],
    boosts: { creator: 23, deadline: 12, sales: 11, money: 8, reply: 7 },
    sourceBoosts: { task: 7, event: 5, social: 3, project: 5 },
    intentBoosts: { opportunity: 10, request: 5 },
    penalties: { academic: -13, mobility: -8, administration: -3 },
  },
  life: {
    key: 'life',
    preferredTags: ['personal', 'wellbeing', 'deadline', 'administration', 'money', 'task'],
    boosts: { personal: 18, wellbeing: 17, deadline: 10, administration: 8, money: 6 },
    sourceBoosts: { task: 7, event: 6, household: 8, health: 6 },
    intentBoosts: { request: 4, transactional: 3 },
    penalties: { sales: -17, client: -12, creator: -7 },
  },
  nomad: {
    key: 'nomad',
    preferredTags: ['mobility', 'administration', 'deadline', 'language', 'money', 'calendar'],
    boosts: { mobility: 25, administration: 16, deadline: 13, language: 10, money: 8 },
    sourceBoosts: { event: 8, task: 6, mail: 4, learning: 4 },
    intentBoosts: { transactional: 8, request: 6 },
    penalties: { academic: -10, creator: -8, sales: -5 },
  },
};

export function inferTags(signal: Signal, text: string): string[] {
  const hay = ` ${normalizeText(text)} `;
  const tags = new Set<string>();
  for (const [tag, list] of Object.entries(TAG_WORDS)) {
    if (list.some((w) => hay.includes(normalizeText(w)))) tags.add(tag);
  }
  if (signal.sourceType === 'task') tags.add('task');
  if (signal.sourceType === 'event') tags.add('calendar');
  if (signal.sourceType === 'mail') tags.add('communication');
  if (signal.sourceType === 'social') tags.add('social');
  if (signal.sourceType === 'health') tags.add('wellbeing');
  if (signal.sourceType === 'finance') tags.add('money');
  if (signal.sourceType === 'learning') tags.add('learning');
  if (signal.sourceType === 'household') tags.add('personal');
  if (signal.needsReply) tags.add('reply');
  // Deadlines are already priced into urgency; they are not an edition tag.
  return [...tags];
}
