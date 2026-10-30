/**
 * Cortex strings. Same mechanism as NEXT (French reference, other locales
 * lazy-loaded, identical keys enforced by TypeScript) and the same locale
 * setting, so both apps always speak the same language.
 */
import { signal } from '@preact/signals';
import type { Locale } from '../domain/types';
import { intlLocale, locale } from '../i18n';
import { cfr, type CortexKey } from './i18n/fr';

export type { CortexKey };
type Dict = Record<CortexKey, string>;

const loaded: Partial<Record<Locale, Dict>> = { fr: cfr };
const LOADERS: Record<Exclude<Locale, 'fr'>, () => Promise<Dict>> = {
  en: () => import('./i18n/en').then((m) => m.cen),
  de: () => import('./i18n/de').then((m) => m.cde),
  es: () => import('./i18n/es').then((m) => m.ces),
};
const version = signal(0);

export async function ensureCortexLocale(l: Locale): Promise<void> {
  if (loaded[l]) return;
  loaded[l] = await LOADERS[l as Exclude<Locale, 'fr'>]();
  version.value += 1;
}

export type Params = Record<string, string | number | null | undefined>;

/** Translates a Cortex key; `{name}` placeholders; `_one` variants for count = 1. */
export function ct(key: CortexKey, params?: Params): string {
  void version.value;
  const l = locale.value;
  if (!loaded[l]) void ensureCortexLocale(l).catch(() => undefined);
  const dict = (loaded[l] ?? cfr) as Record<string, string>;
  let k: string = key;
  if (params && typeof params.count === 'number') {
    const one = `${key}_one`;
    if (new Intl.PluralRules(intlLocale.value).select(params.count) === 'one' && one in dict) k = one;
  }
  const tpl = dict[k] ?? (cfr as Record<string, string>)[k] ?? key;
  return params ? tpl.replace(/\{(\w+)\}/g, (_, p: string) => String(params[p] ?? '')) : tpl;
}

/** "1 h 30", "45 min". */
export function fmtDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return ct('unit.min', { m: r });
  return r ? ct('unit.hm', { h, m: String(r).padStart(2, '0') }) : ct('unit.h', { h });
}

/** Every locale's value of `key` (loads the dictionaries it needs). */
export async function allTranslations(key: CortexKey): Promise<string[]> {
  await Promise.all((['en', 'de', 'es'] as const).map((l) => ensureCortexLocale(l).catch(() => undefined)));
  return Object.values(loaded)
    .map((d) => d?.[key])
    .filter((v): v is string => typeof v === 'string');
}
