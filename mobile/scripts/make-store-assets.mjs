#!/usr/bin/env node
/**
 * Google Play listing images (mobile/store/):
 *  - icon-512.png             hi-res icon (512×512, 32-bit PNG)
 *  - feature-graphic.png      1024×500
 *  - phone-*.png              phone screenshots, padded to Play's max 2:1 ratio (1200×2400)
 * Screenshots come from the emulator test (branch android-screens).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const out = resolve(import.meta.dirname, '..', 'store');
mkdirSync(out, { recursive: true });
const INK = '#1d1c1a';
const PAPER = '#fbfaf8';
const ACCENT = '#e08a63';
const SIGMA = 'M351 129H156l91 126-91 128h200v-53H254l63-76-60-72h94z';

// Hi-res icon: same as the launcher icon.
await sharp(
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" fill="${INK}"/><path d="${SIGMA}" fill="${PAPER}"/></svg>`),
)
  .png()
  .toFile(join(out, 'icon-512.png'));

// Feature graphic (one per language).
const taglines = {
  fr: [
    '3 décisions. Le reste peut attendre.',
    'Tâches, agenda, mails : ce qui compte aujourd’hui, et pourquoi.',
  ],
  en: ['3 decisions. The rest can wait.', 'Tasks, calendar, mail: what matters today, and why.'],
  de: ['3 Entscheidungen. Der Rest kann warten.', 'Aufgaben, Kalender, Mails: was heute zählt – und warum.'],
  es: ['3 decisiones. El resto puede esperar.', 'Tareas, agenda, correo: lo que importa hoy, y por qué.'],
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
for (const [lang, [title, sub]] of Object.entries(taglines)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500">
  <rect width="1024" height="500" fill="${INK}"/>
  <rect x="64" y="150" width="200" height="200" rx="46" fill="${PAPER}"/>
  <path d="${SIGMA}" fill="${INK}" transform="translate(64 150) scale(0.390625)"/>
  <text x="310" y="215" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="600" fill="${ACCENT}">Σ Life OS</text>
  <text x="310" y="275" font-family="Georgia, 'Times New Roman', serif" font-size="44" fill="${PAPER}">${esc(title)}</text>
  <text x="310" y="330" font-family="Segoe UI, Arial, sans-serif" font-size="22" fill="#cfccc4">${esc(sub)}</text>
</svg>`;
  await sharp(Buffer.from(svg))
    .png()
    .toFile(join(out, `feature-graphic-${lang}.png`));
}

// Phone screenshots from the emulator test (Play: long side ≤ 2× short side).
const base = 'https://raw.githubusercontent.com/Guy2B/sum-plus/android-screens/';
const shots = {
  '02-today.png': 'phone-1-today',
  '03-attention.png': 'phone-2-attention',
  '04-plan.png': 'phone-3-plan',
  '05-coach.png': 'phone-4-coach',
  '07-capture.png': 'phone-5-capture',
};
for (const [file, name] of Object.entries(shots)) {
  const res = await fetch(base + file);
  if (!res.ok) {
    console.warn(`skip ${file} (${res.status})`);
    continue;
  }
  const img = Buffer.from(await res.arrayBuffer());
  // 1080×2400 is wider than 2:1: add paper-coloured side margins → 1200×2400 (exactly 2:1), nothing cut.
  await sharp(img)
    .extend({ left: 60, right: 60, background: PAPER })
    .png()
    .toFile(join(out, `${name}.png`));
}
writeFileSync(join(out, 'README.txt'), 'Images for the Google Play listing. See docs/PLAY-STORE.md.\n');
console.log('• store assets written to', out);
