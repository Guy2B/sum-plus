/**
 * Bridge to native health stores inside the Capacitor apps:
 * - iOS: Apple Health / Apple Watch (HealthKit)
 * - Android: Health Connect (also receives Samsung Health / Galaxy Watch data)
 * Only daily summaries are read, after the user's explicit, separate consent.
 */
import type { HealthMetric, HealthSource } from '../domain/types';
import { createMany, snapshot, update } from '../data/store';

export type NativeProvider = 'apple-health' | 'health-connect';

export interface NativeEntry {
  date: string;
  sleep?: number;
  steps?: number;
  activeMinutes?: number;
  restingHR?: number;
}

interface SigmaHealthPlugin {
  isAvailable(o: {
    provider: NativeProvider;
  }): Promise<{ available: boolean; platform: string; reason?: string }>;
  requestAuthorization(o: { provider: NativeProvider; metrics: string[] }): Promise<{ granted: boolean }>;
  readSummary(o: { provider: NativeProvider; days: number }): Promise<{ entries: NativeEntry[] }>;
}

interface CapacitorGlobal {
  getPlatform?: () => string;
  Plugins?: { SigmaHealth?: SigmaHealthPlugin };
}

function plugin(): SigmaHealthPlugin | null {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor?.Plugins?.SigmaHealth ?? null;
}

export function nativePlatform(): 'ios' | 'android' | 'web' {
  const p = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor?.getPlatform?.();
  return p === 'ios' || p === 'android' ? p : 'web';
}

export function nativeProvider(): NativeProvider | null {
  const p = nativePlatform();
  return p === 'ios' ? 'apple-health' : p === 'android' ? 'health-connect' : null;
}

export async function nativeHealthAvailable(): Promise<boolean> {
  const provider = nativeProvider();
  const p = plugin();
  if (!provider || !p) return false;
  try {
    return (await p.isAvailable({ provider })).available;
  } catch {
    return false;
  }
}

/** Reads daily summaries and upserts them as one record per day and source. */
export async function importNativeHealth(days = 14): Promise<number> {
  const provider = nativeProvider();
  const p = plugin();
  if (!provider || !p) throw new Error('native-health-unavailable');
  const auth = await p.requestAuthorization({
    provider,
    metrics: ['sleep', 'steps', 'activeMinutes', 'restingHeartRate'],
  });
  if (!auth.granted) throw new Error('health-permission-denied');
  const { entries } = await p.readSummary({ provider, days });
  return upsertDaily(entries, provider);
}

export async function upsertDaily(entries: NativeEntry[], source: HealthSource): Promise<number> {
  const existing = new Map(
    snapshot.value.health.filter((h) => !h.deletedAt && h.source === source).map((h) => [h.date, h]),
  );
  const fresh: Omit<HealthMetric, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>[] = [];
  let changed = 0;
  for (const e of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
    const fields = {
      date: e.date,
      sleepHours: e.sleep ? Math.round(e.sleep * 10) / 10 : null,
      steps: e.steps ? Math.round(e.steps) : null,
      activeMinutes: e.activeMinutes ? Math.round(e.activeMinutes) : null,
      restingHeartRate: e.restingHR ? Math.round(e.restingHR) : null,
      source,
    };
    const prev = existing.get(e.date);
    if (prev) {
      await update('health', prev.id, fields);
      changed += 1;
    } else fresh.push(fields);
  }
  if (fresh.length) await createMany('health', fresh);
  return changed + fresh.length;
}

/** CSV import: header row with date + any of sleep, steps, activeMinutes, restingHR, energy, stress. */
export function parseHealthCsv(text: string): (NativeEntry & { energy?: number; stress?: number })[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = (lines[0] as string).includes(';') ? ';' : ',';
  const header = (lines[0] as string).split(sep).map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
  const col = {
    date: idx(['date', 'day', 'jour', 'datum', 'fecha']),
    sleep: idx(['sleep', 'sleephours', 'sommeil', 'schlaf', 'sueno']),
    steps: idx(['steps', 'pas', 'schritte', 'pasos']),
    active: idx(['activeminutes', 'active', 'activite']),
    hr: idx(['restinghr', 'restingheartrate', 'fc_repos']),
    energy: idx(['energy', 'energie']),
    stress: idx(['stress']),
  };
  if (col.date < 0) return [];
  const num = (cells: string[], i: number) =>
    i >= 0 ? Number((cells[i] ?? '').replace(',', '.')) || undefined : undefined;
  return lines.slice(1).flatMap((line) => {
    const cells = line.split(sep).map((c) => c.trim());
    const date = (cells[col.date] ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const energy = num(cells, col.energy);
    const stress = num(cells, col.stress);
    return [
      {
        date,
        sleep: num(cells, col.sleep),
        steps: num(cells, col.steps),
        activeMinutes: num(cells, col.active),
        restingHR: num(cells, col.hr),
        energy: energy ? Math.max(1, Math.min(5, Math.round(energy))) : undefined,
        stress: stress ? Math.max(1, Math.min(5, Math.round(stress))) : undefined,
      },
    ];
  });
}
