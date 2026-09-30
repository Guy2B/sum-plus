/**
 * Σ Life OS — Cloud Functions (2nd gen, europe-west1).
 *
 * account  : GDPR export / erasure, client error reporting
 * billing  : Lemon Squeezy webhook → entitlements (only path to Pro)
 * imap     : server-side IMAP for providers browsers cannot reach
 * social   : OAuth + sync for LinkedIn, X, TikTok (secret-bearing flows)
 * admin    : diagnostics, manual entitlements, housekeeping
 */
export { deleteMyAccount, exportMyData, reportClientError, onAuthUserDeleted } from './handlers/account';
export { lemonSqueezyWebhook } from './handlers/billing';
export { imapConnect, imapSync, imapDisconnect } from './handlers/imap';
export { socialStartAuth, socialOAuthCallback, socialSync, socialDisconnect } from './handlers/social';
export { adminDiagnostics, adminSetEntitlement, housekeeping } from './handlers/admin';
