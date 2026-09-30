const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'your',
  'you',
  'this',
  'that',
  'are',
  'was',
  'une',
  'des',
  'les',
  'pour',
  'avec',
  'dans',
  'sur',
  'est',
  'sont',
  'vos',
  'votre',
  'und',
  'der',
  'die',
  'das',
  'mit',
  'fur',
  'von',
  'una',
  'las',
  'los',
  'para',
  'con',
  'del',
]);

export function clamp(value: unknown, min = 0, max = 100): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

/** Lower-case, accent-free, punctuation-light representation used for matching. */
export function normalizeText(value: unknown = ''): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9@.\s_'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(value: unknown = ''): string[] {
  return normalizeText(value)
    .split(/[\s'-]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/** Jaccard-like overlap of significant words, 0..1. */
export function similarity(left: unknown, right: unknown): number {
  const a = new Set(words(left));
  const b = new Set(words(right));
  if (!a.size || !b.size) return 0;
  let common = 0;
  a.forEach((w) => {
    if (b.has(w)) common += 1;
  });
  return common / Math.max(a.size, b.size);
}

export function includesAny(text: unknown, terms: readonly string[]): boolean {
  const value = ` ${normalizeText(text)} `;
  return terms.some((term) => value.includes(normalizeText(term)));
}

export function weightedAverage(entries: { value: number; weight: number }[], fallback = 0): number {
  const valid = entries.filter((e) => Number.isFinite(e.value) && e.weight > 0);
  if (!valid.length) return fallback;
  const total = valid.reduce((s, e) => s + e.weight, 0);
  return valid.reduce((s, e) => s + e.value * e.weight, 0) / total;
}

export function unique<T>(values: readonly (T | null | undefined | false | '')[]): T[] {
  return [...new Set(values.filter(Boolean) as T[])];
}
