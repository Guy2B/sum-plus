import type { ISODate } from './types';

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value);
  // A bare calendar date is interpreted as the end of that local day (a deadline).
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T23:59:00`) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function hoursUntil(value: unknown, now: Date): number | null {
  const d = toDate(value);
  return d ? (d.getTime() - now.getTime()) / 3_600_000 : null;
}

export function ageHours(value: unknown, now: Date): number {
  const d = toDate(value);
  return d ? Math.max(0, (now.getTime() - d.getTime()) / 3_600_000) : 0;
}

/** Local calendar date (not UTC) as YYYY-MM-DD. */
export function isoDay(date: Date = new Date()): ISODate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Monday of the ISO week containing `date`. */
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const shift = (d.getDay() + 6) % 7;
  return addDays(d, -shift);
}

export function monthKey(date: Date | string): string {
  const d = typeof date === 'string' ? (toDate(date) ?? new Date(NaN)) : date;
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function sameDay(a: Date, b: Date): boolean {
  return isoDay(a) === isoDay(b);
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

/** Parses "HH:MM" onto the given day. */
export function atTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map((x) => Number(x));
  const d = new Date(day);
  d.setHours(Number.isFinite(h) ? (h as number) : 9, Number.isFinite(m) ? (m as number) : 0, 0, 0);
  return d;
}

export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
