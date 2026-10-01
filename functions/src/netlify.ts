/**
 * Connector API entry point for Netlify Functions (free tier, no card).
 * Same handlers as Cloud Functions; see docs/DEPLOYMENT.md "API connecteurs".
 */
import { createHandler } from './lib/http-adapter';
import { allowedOrigins, auth, logger } from './lib/runtime';
import { imapConnect, imapDisconnect, imapSync } from './handlers/imap';
import { socialDisconnect, socialOAuthCallback, socialStartAuth, socialSync } from './handlers/social';
import { purgeMyConnectors } from './handlers/connectors';
import { adminRecomputeAnalytics, aggregateDays, dailyJob, recordVisit } from './handlers/analytics';

export const handler = createHandler({
  callables: {
    imapConnect,
    imapSync,
    imapDisconnect,
    socialStartAuth,
    socialSync,
    socialDisconnect,
    purgeMyConnectors,
    adminRecomputeAnalytics,
  },
  requests: { 'oauth/callback': socialOAuthCallback, visit: recordVisit as never },
  // Signature + expiry check only: revocation lookups need Auth admin rights the
  // least-privilege Netlify service account deliberately does not have.
  verifyIdToken: async (token) => auth.verifyIdToken(token),
  allowedOrigins,
  log: (message, detail) => logger.warn(message, detail),
});

/** Scheduled (netlify.toml): last 3 days of anonymous counters → daily aggregates. */
export const aggregateHandler = async () => {
  const days = await aggregateDays();
  return { statusCode: 200, body: JSON.stringify({ days }) };
};

/** Scheduled (netlify.toml): retention by install week, purge, morning digest. */
export const dailyHandler = async () => {
  const result = await dailyJob();
  return { statusCode: 200, body: JSON.stringify(result) };
};
