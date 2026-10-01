import { render } from 'preact';
import './styles/app.css';
import { App, updateAvailable } from './ui/App';
import { initStore } from './data/store';
import { loadSnoozes } from './data/actions';
import { initAuth } from './services/auth';
import { installGlobalHandlers, reportError } from './services/monitoring';
import { startReminders } from './services/reminders';
import { ensureInstalled, track } from './services/telemetry';
import { toast } from './ui/components';
import { t } from './i18n';
import { isNative } from './config';

/** Android back button: go back in the app, leave it only from the first screen. */
function installNativeShell() {
  type AppPlugin = {
    addListener(e: 'backButton', cb: (ev: { canGoBack: boolean }) => void): void;
    exitApp(): void;
  };
  const app = (window as { Capacitor?: { Plugins?: { App?: AppPlugin } } }).Capacitor?.Plugins?.App;
  app?.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && history.length > 1) history.back();
    else app.exitApp();
  });
}

async function boot() {
  installGlobalHandlers();
  const root = document.getElementById('app') as HTMLElement;
  render(<App />, root);

  try {
    const { migratedLegacy } = await initStore();
    await loadSnoozes();
    await ensureInstalled();
    void track('app_open');
    if (migratedLegacy) {
      const total = Object.values(migratedLegacy).reduce((a, b) => a + b, 0);
      if (total) toast(t('app.legacyMigrated', { count: total }), 'good');
    }
  } catch (err) {
    reportError(err, { where: 'initStore' });
    toast(t('error.storage'), 'bad');
  }

  void initAuth();
  startReminders(() => ({ eventSoon: t('reminder.eventSoon'), taskDue: t('reminder.taskDue') }));

  if (isNative()) installNativeShell();

  // The installed app ships its own files: the offline service worker is for the website.
  if ('serviceWorker' in navigator && import.meta.env.PROD && !isNative()) {
    const { registerSW } = await import('virtual:pwa-register');
    const update = registerSW({
      onNeedRefresh() {
        updateAvailable.value = () => void update(true);
      },
      onRegisterError(err: unknown) {
        reportError(err, { where: 'sw-register' });
      },
    });
  }
}

void boot();
