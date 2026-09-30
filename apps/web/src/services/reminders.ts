/**
 * In-app reminders: while Σ is open, due items and upcoming events trigger a
 * system notification (if the user opted in) at most once per item per day.
 */
import { effect } from '@preact/signals';
import { clock, settings, snapshot } from '../data/store';
import { toDate, isoDay } from '../domain/dates';

const shown = new Set<string>();

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

function notify(key: string, title: string, body: string) {
  const k = `${isoDay()}:${key}`;
  if (shown.has(k)) return;
  shown.add(k);
  try {
    new Notification(title, { body, tag: key, icon: '/icons/icon-192.png' });
  } catch {
    /* some platforms only allow notifications from a service worker */
  }
}

export function startReminders(texts: () => { eventSoon: string; taskDue: string }): void {
  effect(() => {
    const now = clock.value;
    if (!settings.value.notifications || !('Notification' in window) || Notification.permission !== 'granted')
      return;
    const t = texts();
    for (const e of snapshot.value.events) {
      if (e.deletedAt || e.allDay) continue;
      const start = toDate(e.start);
      if (!start) continue;
      const mins = (start.getTime() - now.getTime()) / 60_000;
      if (mins > 0 && mins <= 15) notify(`event:${e.id}`, t.eventSoon, e.title);
    }
    for (const task of snapshot.value.tasks) {
      if (task.deletedAt || task.status === 'done' || !task.dueDate || task.dueDate.length <= 10) continue;
      const due = toDate(task.dueDate);
      if (!due) continue;
      const mins = (due.getTime() - now.getTime()) / 60_000;
      if (mins > 0 && mins <= 30) notify(`task:${task.id}`, t.taskDue, task.title);
    }
  });
}
