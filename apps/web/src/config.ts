/**
 * Runtime configuration, resolved at build time from VITE_* variables.
 * Only public identifiers belong here (Firebase web config, OAuth client IDs,
 * checkout links). Secrets live in Cloud Functions / Secret Manager.
 */
declare const __APP_VERSION__: string;

const env = import.meta.env;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const bool = (v: unknown) => str(v) === 'true' || str(v) === '1';

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

export const config = Object.freeze({
  firebase: {
    apiKey: str(env.VITE_FIREBASE_API_KEY),
    authDomain: str(env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: str(env.VITE_FIREBASE_PROJECT_ID),
    storageBucket: str(env.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: str(env.VITE_FIREBASE_MESSAGING_SENDER_ID),
    appId: str(env.VITE_FIREBASE_APP_ID),
  },
  appCheckSiteKey: str(env.VITE_APPCHECK_RECAPTCHA_SITE_KEY),
  functionsRegion: str(env.VITE_FUNCTIONS_REGION) || 'europe-west1',
  useEmulators: bool(env.VITE_USE_EMULATORS),
  /** Cloud Functions deployed (requires the Blaze plan). Off = free Spark mode. */
  functionsEnabled: bool(env.VITE_FUNCTIONS_ENABLED),
  /** Launch mode: every feature unlocked for everyone until payments go live. */
  openAccess: bool(env.VITE_OPEN_ACCESS),
  /** Connector API hosted outside Cloud Functions (e.g. Netlify), same callable protocol. */
  functionsUrl: str(env.VITE_FUNCTIONS_URL).replace(/\/$/, ''),
  google: {
    clientId: str(env.VITE_GOOGLE_CLIENT_ID),
  },
  microsoft: {
    clientId: str(env.VITE_MICROSOFT_CLIENT_ID),
    tenant: str(env.VITE_MICROSOFT_TENANT) || 'common',
  },
  social: {
    linkedin: bool(env.VITE_SOCIAL_LINKEDIN_ENABLED),
    x: bool(env.VITE_SOCIAL_X_ENABLED),
    tiktok: bool(env.VITE_SOCIAL_TIKTOK_ENABLED),
    meta: bool(env.VITE_SOCIAL_META_ENABLED),
  },
  /** Beta founder offer: shown while openAccess is on, honoured with a Lemon Squeezy code at launch. */
  founder: {
    annualPrice: str(env.VITE_FOUNDER_ANNUAL) || '39 €',
    monthlyPrice: str(env.VITE_FOUNDER_MONTHLY) || '4,90 €',
    years: 5,
    seats: 100,
    minDays: 14,
  },
  payments: {
    mode: (str(env.VITE_PAYMENT_MODE) || 'test') as 'test' | 'live',
    monthlyCheckoutUrl: str(env.VITE_CHECKOUT_MONTHLY_URL),
    annualCheckoutUrl: str(env.VITE_CHECKOUT_ANNUAL_URL),
    monthlyPrice: str(env.VITE_PRICE_MONTHLY) || '8,90 €',
    annualPrice: str(env.VITE_PRICE_ANNUAL) || '69 €',
  },
  legal: {
    entity: str(env.VITE_LEGAL_ENTITY),
    address: str(env.VITE_LEGAL_ADDRESS),
    supportEmail: str(env.VITE_SUPPORT_EMAIL),
  },
  publicUrl: str(env.VITE_PUBLIC_URL) || (typeof location !== 'undefined' ? location.origin : ''),
});

export const cloudConfigured = (): boolean =>
  Boolean(config.firebase.apiKey && config.firebase.projectId && config.firebase.appId);

/** Server-side connectors (IMAP, LinkedIn, X, TikTok) are reachable. */
export const connectorServerAvailable = (): boolean =>
  cloudConfigured() && (config.functionsEnabled || Boolean(config.functionsUrl));
