/**
 * First opening of Cortex: a clean, real workspace.
 * - NEXT's demo examples (fictional tasks, mails, events…) are removed, so
 *   Cortex never shows made-up data as if it were the person's.
 * - Five everyday habits are added once, so the habit tracker is useful from
 *   the first minute instead of an empty screen. The person edits or deletes
 *   them freely; they never come back.
 */
import type { Habit } from '../domain/types';
import { authUser, create, entitlement, snapshot, syncState } from '../data/store';
import { getKV, setKV } from '../data/db';
import { clearDemo, hasDemoData } from '../data/seed';
import { isDemoRecord } from '../domain/demo';
import { FREE_LIMITS, isPro } from '../domain/entitlements';
import { cloudConfigured } from '../config';
import { ct, type CortexKey } from './i18n';
import { cadenceFor } from './data';

const FLAG = 'cortex:starters';

type Starter = Pick<Habit, 'icon' | 'color' | 'moment' | 'days' | 'target'> & {
  name: CortexKey;
  unit?: CortexKey;
};

/** Order matters: a free plan keeps the first ones (FREE_LIMITS.habits). */
export const STARTER_HABITS: readonly Starter[] = [
  { name: 'starter.sport', icon: 'dumbbell', color: 0, moment: 'any', days: [0, 2, 4], target: 1 },
  {
    name: 'starter.water',
    unit: 'starter.waterUnit',
    icon: 'drop',
    color: 1,
    moment: 'any',
    days: [0, 1, 2, 3, 4, 5, 6],
    target: 8,
  },
  { name: 'starter.sleep', icon: 'bed', color: 2, moment: 'pm', days: [0, 1, 2, 3, 4, 5, 6], target: 1 },
  { name: 'starter.reading', icon: 'book', color: 3, moment: 'pm', days: [0, 1, 2, 3, 4, 5, 6], target: 1 },
  {
    name: 'starter.screen',
    icon: 'phoneOff',
    color: 4,
    moment: 'pm',
    days: [0, 1, 2, 3, 4, 5, 6],
    target: 1,
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolves true once the local data can be trusted to reflect the account
 * (signed out, or the first sync pass is in), false when it cannot be known
 * yet (offline, still syncing): then nothing is seeded, to never duplicate
 * habits that already exist on another device.
 */
async function settled(): Promise<boolean> {
  if (!cloudConfigured()) return true;
  await sleep(2500); // auth state and entitlement arrive asynchronously
  if (!authUser.value) return true;
  for (let i = 0; i < 30 && syncState.value.status === 'syncing'; i++) await sleep(500);
  const s = syncState.value;
  return s.status === 'idle' || s.status === 'off' || s.status === 'blocked';
}

/** True when the person has never had a habit of their own (deleted ones count). */
function neverHadHabits(): boolean {
  return !snapshot.value.habits.some((h) => !isDemoRecord(h));
}

export async function prepareWorkspace(): Promise<void> {
  if (hasDemoData()) await clearDemo();
  if (await getKV(FLAG)) return;
  if (!neverHadHabits()) {
    await setKV(FLAG, 'existing');
    return;
  }
  if (!(await settled())) return; // try again next time
  if (!neverHadHabits()) {
    await setKV(FLAG, 'existing');
    return;
  }
  const max = isPro(entitlement.value) ? STARTER_HABITS.length : FREE_LIMITS.habits;
  const list = STARTER_HABITS.slice(0, max);
  for (const [i, s] of list.entries()) {
    const days = s.days ?? [0, 1, 2, 3, 4, 5, 6];
    await create('habits', {
      name: ct(s.name),
      unit: s.unit ? ct(s.unit) : '',
      icon: s.icon,
      color: s.color,
      moment: s.moment,
      target: s.target,
      days,
      cadence: cadenceFor(days),
      domain: 'personal',
      order: i,
    } as Habit);
  }
  await setKV(FLAG, new Date().toISOString());
}
