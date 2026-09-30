#!/usr/bin/env node
/**
 * Grants (or revokes) the `admin` custom claim that unlocks the Admin QA
 * console and admin-only Cloud Functions. Replaces the hard-coded owner
 * e-mail list of the legacy app.
 *
 * Usage (Application Default Credentials, e.g. `gcloud auth application-default login`):
 *   node functions/scripts/set-admin.mjs you@example.com [--revoke] [--project project-id]
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const args = process.argv.slice(2);
const email = args.find((a) => a.includes('@'));
const revoke = args.includes('--revoke');
const projectIdx = args.indexOf('--project');
const projectId = projectIdx >= 0 ? args[projectIdx + 1] : process.env.GCLOUD_PROJECT;

if (!email) {
  console.error('Usage: node functions/scripts/set-admin.mjs <email> [--revoke] [--project <id>]');
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();
const user = await auth.getUserByEmail(email);
const claims = { ...(user.customClaims ?? {}) };
if (revoke) delete claims.admin;
else claims.admin = true;
await auth.setCustomUserClaims(user.uid, claims);
// Force a token refresh so the change applies at next sign-in / token renewal.
await auth.revokeRefreshTokens(user.uid);
console.log(
  `${revoke ? 'Revoked' : 'Granted'} admin for ${email} (${user.uid}). The user must sign in again.`,
);
