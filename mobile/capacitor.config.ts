import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.algbr.lifeos',
  appName: 'NEXT',
  // The production web build with app.html as the entry page (scripts/prepare-web.mjs):
  // the installed app opens on the app itself, never on the landing page.
  webDir: 'www',
  backgroundColor: '#fbfaf8',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    // Default: WebView debugging on in debug builds (automated tests), off in release builds.
  },
  plugins: {
    // Keep the Σ splash until the app has rendered (hidden from main.tsx), never a blank screen.
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#fbfaf8',
      androidScaleType: 'CENTER_INSIDE',
      showSpinner: false,
    },
    // Native Google / Microsoft sign-in: the plugin only returns the credential; the
    // Firebase JavaScript SDK in the web layer stays the single source of the session.
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ['google.com', 'microsoft.com'],
    },
  },
  ios: {
    contentInset: 'automatic',
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
