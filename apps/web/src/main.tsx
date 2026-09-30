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

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
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
