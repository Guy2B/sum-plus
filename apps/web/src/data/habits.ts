/**
 * The single way to record a habit for a day, used by NEXT and Cortex alike.
 * One live log per habit and day: duplicates (two devices offline, an older
 * client) are folded into the latest one so an undo never resurrects them.
 */
import type { Habit, ISODate } from '../domain/types';
import { indexLogs, logOn } from '../domain/habits';
import { create, snapshot, update } from './store';

export async function writeHabitDay(
  h: Habit,
  date: ISODate,
  next: { value: number; skipped?: boolean },
): Promise<void> {
  const live = snapshot.value.habitLogs.filter((l) => !l.deletedAt && l.habitId === h.id && l.date === date);
  const keep = logOn(indexLogs(live), h, date);
  const now = new Date().toISOString();
  for (const l of live) if (l.id !== keep?.id) await update('habitLogs', l.id, { deletedAt: now });
  const empty = next.value <= 0 && !next.skipped;
  if (keep) {
    await update('habitLogs', keep.id, {
      value: Math.max(0, next.value),
      skipped: Boolean(next.skipped),
      deletedAt: empty ? now : null,
    });
  } else if (!empty) {
    await create('habitLogs', {
      habitId: h.id,
      date,
      value: Math.max(0, next.value),
      skipped: Boolean(next.skipped),
    });
  }
}
