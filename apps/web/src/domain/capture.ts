import type { Priority, TaskCategory } from './types';
import { addDays, isoDay } from './dates';
import { normalizeText } from './text';

export interface Captured {
  title: string;
  dueDate: string | null;
  priority: Priority;
  estimateMinutes: number | null;
  category: TaskCategory | null;
  scheduledFor: 'today' | null;
}

const TODAY = ["aujourd'hui", 'aujourdhui', 'today', 'heute', 'hoy'];
const TOMORROW = ['demain', 'tomorrow', 'morgen', 'manana'];
const WEEKDAYS: Record<string, number> = {
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
  dimanche: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
  montag: 1,
  dienstag: 2,
  mittwoch: 3,
  donnerstag: 4,
  freitag: 5,
  samstag: 6,
  sonntag: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 0,
};
const CATEGORY_TAGS: Record<string, TaskCategory> = {
  travail: 'work',
  work: 'work',
  arbeit: 'work',
  trabajo: 'work',
  maison: 'home',
  home: 'home',
  haus: 'home',
  casa: 'home',
  sante: 'health',
  health: 'health',
  gesundheit: 'health',
  salud: 'health',
  admin: 'admin',
  projet: 'projects',
  project: 'projects',
  projekt: 'projects',
  proyecto: 'projects',
  famille: 'family',
  family: 'family',
  familie: 'family',
  familia: 'family',
  apprendre: 'learning',
  learning: 'learning',
  lernen: 'learning',
  aprender: 'learning',
};

/**
 * Parses a quick-capture line: "Appeler Marc demain 30min !" →
 * title "Appeler Marc", due tomorrow, 30 minutes, high priority.
 * Recognised tokens are removed from the title; everything else is kept verbatim.
 */
export function parseCapture(input: string, now: Date = new Date()): Captured {
  let title = input.trim();
  let dueDate: string | null = null;
  let priority: Priority = 'medium';
  let estimateMinutes: number | null = null;
  let category: TaskCategory | null = null;
  let scheduledFor: 'today' | null = null;

  const strip = (re: RegExp) => {
    title = title.replace(re, ' ').replace(/\s+/g, ' ').trim();
  };

  if (/(^|\s)!{1,3}(\s|$)|(^|\s)!(urgent|important)\b/i.test(title)) {
    priority = 'high';
    strip(/(^|\s)!+(urgent|important)?(?=\s|$)/gi);
  }

  const dur = /(?:^|\s)(\d{1,3})\s?(min|mn|m|h)(?=\s|$)/i.exec(title);
  if (dur) {
    const n = Number(dur[1]);
    estimateMinutes = /^h$/i.test(dur[2] ?? '') ? n * 60 : n;
    strip(new RegExp(`(^|\\s)${dur[1]}\\s?${dur[2]}(?=\\s|$)`, 'i'));
  }

  const date = /(?:^|\s)(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?=\s|$)/.exec(title);
  if (date) {
    const raw = date[1] as string;
    if (raw.includes('-')) dueDate = raw;
    else {
      const [d, m, y] = raw.split('/').map(Number);
      const year = y ? (y < 100 ? 2000 + y : y) : now.getFullYear();
      dueDate = isoDay(new Date(year, (m as number) - 1, d as number));
    }
    strip(new RegExp(`(^|\\s)${raw.replace(/[/-]/g, '\\$&')}(?=\\s|$)`));
  }

  const words = title.split(' ');
  const kept: string[] = [];
  for (const w of words) {
    const n = normalizeText(w);
    if (!dueDate && TODAY.includes(n)) {
      dueDate = isoDay(now);
      scheduledFor = 'today';
      continue;
    }
    if (!dueDate && TOMORROW.includes(n)) {
      dueDate = isoDay(addDays(now, 1));
      continue;
    }
    if (!dueDate && WEEKDAYS[n] !== undefined) {
      const target = WEEKDAYS[n] as number;
      const delta = (target - now.getDay() + 7) % 7 || 7;
      dueDate = isoDay(addDays(now, delta));
      continue;
    }
    if (w.startsWith('#') && w.length > 1) {
      const c = CATEGORY_TAGS[normalizeText(w.slice(1))];
      if (c) {
        category = c;
        continue;
      }
    }
    kept.push(w);
  }
  title = kept.join(' ').trim() || input.trim();
  return { title, dueDate, priority, estimateMinutes, category, scheduledFor };
}
