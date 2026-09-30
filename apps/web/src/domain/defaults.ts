import type { ContextProfile, Locale, Settings } from './types';

export const SCHEMA_VERSION = 1;

export const DEFAULT_CONTEXT: ContextProfile = {
  primaryGoal: '',
  secondaryGoal: '',
  successDefinition: '',
  weeklyHours: 35,
  focusHours: 4,
  energyPeak: 'morning',
  workDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  workStart: '09:00',
  workEnd: '18:00',
  fixedCommitments: '',
  constraints: '',
  coachingTone: 'balanced',
  coachingDepth: 'detailed',
  allowCrossAnalysis: true,
  includedDomains: {
    mail: true,
    social: true,
    health: true,
    finance: true,
    journal: true,
    learning: true,
    calendar: true,
    household: true,
    career: true,
  },
};

export function detectLocale(): Locale {
  const nav = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2).toLowerCase() : 'fr';
  return (['fr', 'en', 'de', 'es'] as const).includes(nav as Locale) ? (nav as Locale) : 'fr';
}

export function defaultSettings(locale: Locale = detectLocale()): Settings {
  return {
    name: '',
    edition: 'solo',
    locale,
    currency: 'EUR',
    theme: 'system',
    onboardingComplete: false,
    context: structuredClone(DEFAULT_CONTEXT),
    ai: { semantic: false, browserModel: false, gateway: false, gatewayUrl: '' },
    notifications: false,
    consent: { health: null, cloudSync: null },
    usage: { coachDate: '', coachCount: 0 },
    schemaVersion: SCHEMA_VERSION,
  };
}

/** Deep-merges persisted settings over defaults so new fields always exist. */
export function normalizeSettings(raw: unknown, locale?: Locale): Settings {
  const base = defaultSettings(locale);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Settings>;
  return {
    ...base,
    ...r,
    context: {
      ...base.context,
      ...(r.context ?? {}),
      includedDomains: { ...base.context.includedDomains, ...(r.context?.includedDomains ?? {}) },
    },
    ai: { ...base.ai, ...(r.ai ?? {}) },
    consent: { ...base.consent, ...(r.consent ?? {}) },
    usage: { ...base.usage, ...(r.usage ?? {}) },
    schemaVersion: SCHEMA_VERSION,
  };
}
