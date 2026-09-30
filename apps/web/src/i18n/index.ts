import { computed, effect, signal } from '@preact/signals';
import type { Locale } from '../domain/types';
import { settings } from '../data/store';
import { fr, type MessageKey } from './fr';

export type { MessageKey };

type Dict = Record<MessageKey, string>;

/** French ships in the main bundle (reference + fallback); other locales load on demand. */
const loaded: Partial<Record<Locale, Dict>> = { fr };
const LOADERS: Record<Exclude<Locale, 'fr'>, () => Promise<Dict>> = {
  en: () => import('./en').then((m) => m.en),
  de: () => import('./de').then((m) => m.de),
  es: () => import('./es').then((m) => m.es),
};
/** Bumped when a dictionary finishes loading so rendered text refreshes. */
const dictVersion = signal(0);

export async function ensureLocale(l: Locale): Promise<void> {
  if (loaded[l]) return;
  loaded[l] = await LOADERS[l as Exclude<Locale, 'fr'>]();
  dictVersion.value += 1;
}

const INTL_LOCALE: Record<Locale, string> = { fr: 'fr-FR', en: 'en-GB', de: 'de-DE', es: 'es-ES' };

export const locale = computed<Locale>(() => settings.value.locale);
export const intlLocale = computed(() => INTL_LOCALE[locale.value]);

effect(() => {
  void ensureLocale(locale.value).catch(() => undefined);
});

export type Params = Record<string, string | number | null | undefined>;

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    return v == null ? '' : String(v);
  });
}

/**
 * Translates `key`. Plurals: when `params.count` is a number and `${key}_one`
 * exists, the CLDR plural category picks the variant. Missing keys fall back
 * to French, then to the key itself (visible in QA, reported in dev).
 */
export function t(key: MessageKey | string, params?: Params): string {
  void dictVersion.value;
  const dict = (loaded[locale.value] ?? fr) as Record<string, string>;
  let k = key;
  if (params && typeof params.count === 'number') {
    const cat = new Intl.PluralRules(intlLocale.value).select(params.count);
    const candidate = `${key}_one`;
    if (cat === 'one' && candidate in dict) k = candidate;
  }
  const template = dict[k] ?? (fr as Record<string, string>)[k];
  if (template == null) {
    if (import.meta.env.DEV) console.warn('[i18n] missing key', key);
    return key;
  }
  return interpolate(template, params);
}

/* ------------------------------ formatters -------------------------------- */

export function fmtDate(
  value: string | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
): string {
  if (!value) return '';
  const d =
    typeof value === 'string'
      ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)
      : value;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(intlLocale.value, opts).format(d);
}

export function fmtTime(value: string | Date): string {
  return fmtDate(value, { hour: '2-digit', minute: '2-digit' });
}

export function fmtLongDate(value: string | Date): string {
  return fmtDate(value, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function fmtRelative(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return '';
  const d =
    typeof value === 'string'
      ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:00` : value)
      : value;
  const diff = d.getTime() - now.getTime();
  const rtf = new Intl.RelativeTimeFormat(intlLocale.value, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}

export function fmtNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat(intlLocale.value, { maximumFractionDigits: digits }).format(n);
}

export function fmtMoney(minor: number): string {
  return new Intl.NumberFormat(intlLocale.value, {
    style: 'currency',
    currency: settings.value.currency,
  }).format(minor / 100);
}

export function fmtMinutes(min: number): string {
  if (min < 60) return t('unit.minutes', { count: Math.round(min) });
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? t('unit.hoursMinutes', { h, m }) : t('unit.hours', { count: h });
}
