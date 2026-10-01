#!/usr/bin/env node
/**
 * Source images for `npx capacitor-assets generate`, drawn from the same Σ as
 * the web icon (apps/web/public/icons/icon.svg): ink background, white Σ.
 * Writes mobile/assets/{icon-only,icon-foreground,icon-background,splash,splash-dark}.png.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const out = resolve(import.meta.dirname, '..', 'assets');
mkdirSync(out, { recursive: true });

const INK = '#1d1c1a';
const PAPER = '#fbfaf8';
// The Σ glyph of the web icon, drawn in a 512 box.
const SIGMA = 'M351 129H156l91 126-91 128h200v-53H254l63-76-60-72h94z';

/** Σ centred in a size×size canvas, scaled to `scale` of the canvas. */
const glyph = (size, scale, fill, background) => {
  const s = (size * scale) / 512;
  const offset = (size - 512 * s) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  ${background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ''}
  <path d="${SIGMA}" fill="${fill}" transform="translate(${offset} ${offset}) scale(${s})"/>
</svg>`);
};

const png = (svg, file) => sharp(svg).png().toFile(join(out, file));

await Promise.all([
  // Legacy square icon (pre-Android 8): full-bleed ink with the Σ.
  png(glyph(1024, 1, PAPER, INK), 'icon-only.png'),
  // Adaptive icon: the system masks the shape; keep the Σ inside the 66 % safe zone.
  png(glyph(1024, 0.62, PAPER), 'icon-foreground.png'),
  png(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${INK}"/></svg>`), 'icon-background.png'),
  // Splash: calm paper background (light) / ink (dark), small Σ.
  png(glyph(2732, 0.18, INK, PAPER), 'splash.png'),
  png(glyph(2732, 0.18, PAPER, INK), 'splash-dark.png'),
]);
console.log('• assets written to', out);
