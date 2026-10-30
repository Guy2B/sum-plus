/** UI state shared by Cortex screens (never persisted). */
import { signal } from '@preact/signals';
import type { BlockCategory, ISODate, TimeBlock } from '../../domain/types';
import { isoDay } from '../../domain/dates';

export type Sheet =
  | {
      kind: 'block';
      date: ISODate;
      block: TimeBlock | null;
      start: number;
      end: number;
      category?: BlockCategory;
      title?: string;
    }
  | { kind: 'task'; id: string }
  | { kind: 'habit'; id: string | null }
  | { kind: 'project'; id: string | null; area?: 'pro' | 'writing' | 'personal' }
  | { kind: 'dayOptions'; date: ISODate };

export const sheet = signal<Sheet | null>(null);
export const paletteOpen = signal(false);
export const drawerOpen = signal(false);
export const captureKind = signal<'task' | 'note' | 'idea'>('task');
export const captureFocus = signal(0);

/** Day shown in Planning and in Habits (they move independently). */
export const planDay = signal<ISODate>(isoDay());
export const habitDay = signal<ISODate>(isoDay());
export const focusedHabit = signal<string | null>(null);
export const reviewWeek = signal(0);

/** Focus mode runs on a block of today. */
export const focusBlock = signal<{ date: ISODate; id: string } | null>(null);

/** Estimate picked when adding a task to plan (minutes). */
export const estimatePick = signal(30);
