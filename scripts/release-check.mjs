#!/usr/bin/env node
/**
 * Commercial release gate. Fails (exit 1) unless the production build is
 * configured for real customers: live payments, legal identity, App Check,
 * no emulators, no leaked secrets in the bundle, locked-down rules.
 *
 * Usage: VITE_* variables in the environment (or apps/web/.env.production),
 *        after `npm run build`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envFile = join(root, 'apps/web/.env.production');
const fileEnv = existsSync(envFile)
  ? Object.fromEntries(
      readFileSync(envFile, 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^\s*VITE_/.test(l))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    )
  : {};
const env = (k) => (process.env[k] ?? fileEnv[k] ?? '').trim();

const checks = [];
const check = (name, ok, hint = '') => checks.push({ name, ok: Boolean(ok), hint });

for (const k of [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_AUTH_DOMAIN',
])
  check(`${k} set`, env(k));
check(
  'App Check site key set',
  env('VITE_APPCHECK_RECAPTCHA_SITE_KEY'),
  'reCAPTCHA Enterprise key for Firebase App Check',
);
check('Emulators disabled', env('VITE_USE_EMULATORS') !== 'true');
check('Payment mode is live', env('VITE_PAYMENT_MODE') === 'live');
for (const k of ['VITE_CHECKOUT_MONTHLY_URL', 'VITE_CHECKOUT_ANNUAL_URL'])
  check(`${k} is https`, /^https:\/\//.test(env(k)));
check('Legal entity set', env('VITE_LEGAL_ENTITY'));
check('Legal address set', env('VITE_LEGAL_ADDRESS'));
check('Support email set', /@/.test(env('VITE_SUPPORT_EMAIL')));
check('Public URL is https', /^https:\/\//.test(env('VITE_PUBLIC_URL')));

// Security rules must stay deny-by-default and never open writes broadly.
const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');
check(
  'Firestore rules deny by default',
  /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/.test(rules),
);
check('No "if true" in Firestore rules', !/if\s+true/.test(rules));
check(
  'Entitlements are not client-writable',
  /match \/entitlements\/\{uid\}\s*\{[^}]*allow write: if false;/.test(rules),
);

// Built bundle must not contain secrets.
const dist = join(root, 'apps/web/dist');
check('Web build exists', existsSync(dist), 'run npm run build first');
const SECRET_PATTERNS = [
  /GOCSPX-[\w-]{10,}/,
  /sk_live_[\w]{10,}/,
  /-----BEGIN (RSA )?PRIVATE KEY-----/,
  /"type":\s*"service_account"/,
  /xox[baprs]-[\w-]{10,}/,
];
const leaks = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html|json|css|webmanifest)$/.test(f)) {
      const text = readFileSync(p, 'utf8');
      for (const re of SECRET_PATTERNS)
        if (re.test(text)) leaks.push(`${p.replace(root, '')} (${re.source.slice(0, 16)}…)`);
    }
  }
};
if (existsSync(dist)) walk(dist);
check('No secrets in the web bundle', leaks.length === 0, leaks.join(', '));

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${!c.ok && c.hint ? ` — ${c.hint}` : ''}`);
if (failed.length) {
  console.error(`\nRelease blocked: ${failed.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nRelease gate passed.');
