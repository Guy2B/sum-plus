#!/usr/bin/env node
/**
 * Copies the production web build into mobile/www for Capacitor, with the app
 * (app.html) as index.html: the native shell starts on Today, not on the landing.
 */
import { cpSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '..', '..', 'apps', 'web', 'dist');
const www = resolve(import.meta.dirname, '..', 'www');
if (!existsSync(join(dist, 'app.html'))) {
  console.error('apps/web/dist/app.html missing: run the web build first.');
  process.exit(1);
}
rmSync(www, { recursive: true, force: true });
cpSync(dist, www, { recursive: true });
copyFileSync(join(www, 'app.html'), join(www, 'index.html'));
// The service worker is for the website; the native app ships its files itself.
for (const f of ['sw.js', 'service-worker.js', 'registerSW.js']) rmSync(join(www, f), { force: true });
console.log('• www ready (index.html = app.html)');
