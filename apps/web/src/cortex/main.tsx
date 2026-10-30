/**
 * Cortex entry point. Same store, account, sync and settings as NEXT (same
 * origin, same IndexedDB), its own interface.
 */
import { render } from 'preact';
import '../styles/app.css';
import './cortex.css';
import { initStore, settings } from '../data/store';
import { initAuth } from '../services/auth';
import { installGlobalHandlers, reportError } from '../services/monitoring';
import { toast } from '../ui/components';
import { t } from '../i18n';
import { CortexApp } from './ui/App';
import { ensureCortexLocale } from './i18n';
import { flushNotes } from './data';

async function boot() {
  installGlobalHandlers();
  render(<CortexApp />, document.getElementById('app') as HTMLElement);
  try {
    await initStore();
    await ensureCortexLocale(settings.value.locale).catch(() => undefined);
  } catch (err) {
    reportError(err, { where: 'cortex-initStore' });
    toast(t('error.storage'), 'bad');
  }
  void initAuth();
  // Never lose the last keystrokes of a note when the tab goes away.
  window.addEventListener('pagehide', flushNotes);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushNotes());

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ onRegisterError: (err: unknown) => reportError(err, { where: 'cortex-sw' }) });
  }
}

void boot();
