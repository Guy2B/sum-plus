import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.algbr.lifeos',
  appName: 'Σ Life OS',
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
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: 'automatic',
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
