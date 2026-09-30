/**
 * Connector API entry point for Netlify Functions (free tier, no card).
 * Same handlers as Cloud Functions; see docs/DEPLOYMENT.md "API connecteurs".
 */
import { createHandler } from './lib/http-adapter';
import { allowedOrigins, auth, logger } from './lib/runtime';
import { imapConnect, imapDisconnect, imapSync } from './handlers/imap';
import { socialDisconnect, socialOAuthCallback, socialStartAuth, socialSync } from './handlers/social';
import { purgeMyConnectors } from './handlers/connectors';

export const handler = createHandler({
  callables: {
    imapConnect,
    imapSync,
    imapDisconnect,
    socialStartAuth,
    socialSync,
    socialDisconnect,
    purgeMyConnectors,
  },
  requests: { 'oauth/callback': socialOAuthCallback },
  verifyIdToken: async (token) => auth.verifyIdToken(token, true),
  allowedOrigins,
  log: (message, detail) => logger.warn(message, detail),
});
