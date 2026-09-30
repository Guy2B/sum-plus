#!/usr/bin/env node
/**
 * Grants (or revokes) the `admin` custom claim using the Firebase CLI login
 * (`firebase login`), so no gcloud / service-account setup is needed.
 *
 *   node scripts/grant-admin.mjs you@example.com [--revoke] [--project sum-plus-app]
 *
 * The user must sign out and back in (or wait up to 1 h) for the claim to apply.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

const args = process.argv.slice(2);
const email = args.find((a) => a.includes('@'));
const revoke = args.includes('--revoke');
const pIdx = args.indexOf('--project');
const project = pIdx >= 0 ? args[pIdx + 1] : 'sum-plus-app';
if (!email) {
  console.error('Usage: node scripts/grant-admin.mjs <email> [--revoke] [--project <id>]');
  process.exit(1);
}

const tools = join(process.env.APPDATA ?? join(process.env.HOME ?? '', '.npm-global'), 'npm/node_modules/firebase-tools/lib/');
const require = createRequire(import.meta.url);
const { getAccessToken } = require(join(tools, 'auth'));
const { configstore } = require(join(tools, 'configstore'));
const refresh = configstore.get('tokens')?.refresh_token;
if (!refresh) {
  console.error('Run `firebase login` first.');
  process.exit(1);
}
const { access_token: token } = await getAccessToken(refresh, []);
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Goog-User-Project': project };
const base = `https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts`;

const lookup = await fetch(`${base}:lookup`, { method: 'POST', headers, body: JSON.stringify({ email: [email] }) });
const user = (await lookup.json()).users?.[0];
if (!user) {
  console.error(`No account for ${email} in ${project}. Sign in to the app once first.`);
  process.exit(1);
}
const claims = JSON.parse(user.customAttributes ?? '{}');
if (revoke) delete claims.admin;
else claims.admin = true;
const res = await fetch(`${base}:update`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ localId: user.localId, customAttributes: JSON.stringify(claims) }),
});
if (!res.ok) {
  console.error('Update failed:', res.status, await res.text());
  process.exit(1);
}
console.log(`${revoke ? 'Revoked' : 'Granted'} admin for ${email} (${project}). Sign out and back in to apply.`);
