/**
 * Android / iOS app: local notifications scheduled on the phone itself (no
 * server, nothing leaves the device):
 *  - every morning, 15 minutes before the work day: "your day is ready";
 *  - the day before a promise is due, at 16:00: who it was promised to.
 * Re-scheduled each time the app opens or syncs. Only when notifications are on.
 */
import { settings, snapshot } from '../data/store';
import { addDays, atTime, isoDay } from '../domain/dates';
import { t } from '../i18n';

interface Scheduled {
  id: number;
  title: string;
  body: string;
  schedule: { at?: Date; on?: { hour: number; minute: number }; allowWhileIdle?: boolean };
}
interface LocalNotificationsPlugin {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(o: { notifications: Scheduled[] }): Promise<unknown>;
  getPending(): Promise<{ notifications: { id: number }[] }>;
  cancel(o: { notifications: { id: number }[] }): Promise<void>;
}

const plugin = () =>
  (window as { Capacitor?: { Plugins?: { LocalNotifications?: LocalNotificationsPlugin } } }).Capacitor
    ?.Plugins?.LocalNotifications ?? null;

const MORNING_ID = 1;
const PROMISE_BASE = 1000;

/** Asks Android for the notification permission (Android 13+). */
export async function requestNativeNotifications(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  const cur = await p.checkPermissions().catch(() => ({ display: 'denied' }));
  if (cur.display === 'granted') return true;
  return (await p.requestPermissions().catch(() => ({ display: 'denied' }))).display === 'granted';
}

/** Morning time: 15 minutes before the start of the work day (08:45 by default). */
export function morningTime(workStart: string | undefined): { hour: number; minute: number } {
  const [h, m] = (workStart || '09:00').split(':').map(Number);
  const total = Math.max(5 * 60, (h ?? 9) * 60 + (m ?? 0) - 15);
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

/** Promises due tomorrow, as notifications for today 16:00 (none once 16:00 has passed: no repeats). */
export function promiseReminders(now: Date): Scheduled[] {
  const tomorrow = isoDay(addDays(now, 1));
  if (atTime(now, '16:00') <= now) return [];
  return snapshot.value.tasks
    .filter(
      (x) => !x.deletedAt && x.status !== 'done' && x.promisedTo && x.dueDate?.slice(0, 10) === tomorrow,
    )
    .slice(0, 20)
    .map((x, i) => {
      const at = atTime(now, '16:00');
      return {
        id: PROMISE_BASE + i,
        title: t('notify.promiseTitle', { to: x.promisedTo ?? '' }),
        body: x.title,
        schedule: { at, allowWhileIdle: true },
      };
    });
}

export async function scheduleNativeNotifications(now = new Date()): Promise<void> {
  const p = plugin();
  if (!p) return;
  try {
    const pending = await p.getPending();
    if (pending.notifications.length)
      await p.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    if (!settings.value.notifications) return;
    if ((await p.checkPermissions()).display !== 'granted') return;
    await p.schedule({
      notifications: [
        {
          id: MORNING_ID,
          title: t('notify.morningTitle'),
          body: t('notify.morningBody'),
          schedule: { on: morningTime(settings.value.context.workStart), allowWhileIdle: true },
        },
        ...promiseReminders(now),
      ],
    });
  } catch {
    /* notifications are a convenience: never block the app */
  }
}
