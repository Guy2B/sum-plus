import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.algbr.sigma',
  appName: 'Σ Life OS',
  // The native shells bundle the same production build as the web app.
  webDir: '../apps/web/dist',
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
