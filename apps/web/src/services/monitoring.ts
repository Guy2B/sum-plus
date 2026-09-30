/**
 * Privacy-preserving error reporting. Errors are scrubbed of e-mail addresses,
 * tokens and long numbers, rate-limited, and sent to the `reportClientError`
 * function which writes them to Cloud Logging (alerting is configured there).
 * No third-party tracker is loaded.
 */
import { APP_VERSION, cloudConfigured, config } from '../config';

const MAX_PER_SESSION = 20;
let sent = 0;
const seen = new Set<string>();

export function scrub(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/(ya29\.|eyJ)[A-Za-z0-9._-]{10,}/g, '<token>')
    .replace(/([?&](code|token|access_token|id_token|state)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/\b\d{9,}\b/g, '<number>')
    .slice(0, 4000);
}

export function reportError(err: unknown, context: Record<string, string> = {}): void {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error('[sigma]', context.where ?? '', e);
  if (!cloudConfigured() || !config.functionsEnabled || sent >= MAX_PER_SESSION) return;
  const fingerprint = `${e.name}:${e.message}`.slice(0, 200);
  if (seen.has(fingerprint)) return;
  seen.add(fingerprint);
  sent += 1;
  const payload = {
    message: scrub(e.message),
    stack: scrub(e.stack ?? ''),
    where: scrub(context.where ?? ''),
    version: APP_VERSION,
    url: scrub(location.pathname + location.hash),
    ua: navigator.userAgent.slice(0, 200),
  };
  void import('./firebase').then(({ call }) => call('reportClientError', payload)).catch(() => undefined);
}

export function installGlobalHandlers(): void {
  window.addEventListener('error', (ev) => reportError(ev.error ?? ev.message, { where: 'window.onerror' }));
  window.addEventListener('unhandledrejection', (ev) =>
    reportError(ev.reason, { where: 'unhandledrejection' }),
  );
}
