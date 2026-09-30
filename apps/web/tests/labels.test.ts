import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fr } from '../src/i18n/fr';
import { en } from '../src/i18n/en';
import { de } from '../src/i18n/de';
import { es } from '../src/i18n/es';

describe('labels generated from engine keys', () => {
  it('every "why not" reason has a set-aside group label in all four languages', () => {
    const src = readFileSync(resolve(__dirname, '../src/domain/whynot.ts'), 'utf8');
    const keys = [...new Set([...src.matchAll(/key: 'whynot\.(\w+)'/g)].map((m) => m[1]!))];
    expect(keys.length).toBeGreaterThan(5);
    for (const dict of [fr, en, de, es] as Record<string, string>[])
      for (const k of keys) {
        expect(dict[`whynot.${k}`], `whynot.${k}`).toBeTruthy();
        expect(dict[`today.removed.group.${k}`], `today.removed.group.${k}`).toBeTruthy();
      }
  });
});
