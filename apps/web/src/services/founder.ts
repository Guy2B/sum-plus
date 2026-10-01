/**
 * Founder programme (beta only): counts the days a signed-in account used Σ,
 * so the first testers who used it for real keep the founder price at launch.
 * Stored in founders/{uid}: active days, first and last day — nothing else.
 */
import { config, cloudConfigured } from '../config';
import { authUser, settings, updateSettings } from '../data/store';
import { isoDay } from '../domain/dates';
import { cloud } from './firebase';

/** Counts today once for the signed-in account (no-op outside the beta). */
export async function recordFounderDay(now = new Date()): Promise<void> {
  const user = authUser.value;
  const today = isoDay(now);
  if (!config.openAccess || !cloudConfigured() || !user || settings.value.usage.founderDay === today) return;
  try {
    const [{ db }, fs] = await Promise.all([cloud(), import('firebase/firestore')]);
    const ref = fs.doc(db, 'founders', user.uid);
    const days = await fs.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists()
        ? (snap.data() as { activeDays: number; lastSeen: string; firstSeen: string })
        : null;
      if (cur?.lastSeen === today) return cur.activeDays;
      const next = (cur?.activeDays ?? 0) + 1;
      tx.set(ref, {
        activeDays: next,
        firstSeen: cur?.firstSeen ?? today,
        lastSeen: today,
        updatedAt: fs.serverTimestamp(),
      });
      return next;
    });
    await updateSettings((cur) => ({
      ...cur,
      usage: { ...cur.usage, founderDay: today, founderDays: days },
    }));
  } catch {
    /* best-effort: counting never gets in the way */
  }
}

/** Admin: how many accounts already qualify for the founder price. */
export async function founderCandidates(): Promise<{ eligible: number; total: number }> {
  const [{ db }, fs] = await Promise.all([cloud(), import('firebase/firestore')]);
  const col = fs.collection(db, 'founders');
  const [eligible, total] = await Promise.all([
    fs.getCountFromServer(fs.query(col, fs.where('activeDays', '>=', config.founder.minDays))),
    fs.getCountFromServer(col),
  ]);
  return { eligible: eligible.data().count, total: total.data().count };
}
