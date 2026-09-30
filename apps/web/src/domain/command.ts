/**
 * One bar to capture, plan and ask. A line of natural language is interpreted
 * as exactly one thing, shown to the user before it is executed:
 *  - day   "je suis épuisé", "il me reste 2h", "je pars à 15h"   → today's constraints
 *  - ask   "que dois-je abandonner cette semaine ?"              → coach
 *  - event "déjeuner vendredi 13h avec Marc"                      → calendar event
 *  - mission "contrôle de maths jeudi"                            → preparation plan
 *  - task  "rappeler assurance mardi"                             → task
 */
import { addDays, atTime, isoDay } from './dates';
import { detectMission, parseCapture, type Captured } from './capture';
import { normalizeText } from './text';

export type Energy = 'low' | 'normal' | 'high';

export type Interpretation =
  | { kind: 'day'; energy?: Energy; minutesLeft?: number; endAt?: string }
  | { kind: 'ask'; question: string }
  | { kind: 'event'; title: string; start: Date; end: Date }
  | { kind: 'mission'; mission: 'exam' | 'interview' | 'presentation'; title: string; date: string }
  | { kind: 'task'; captured: Captured };

const LOW = [
  'epuise',
  'epuisee',
  'fatigue',
  'fatiguee',
  'creve',
  'crevee',
  'claque',
  'exhausted',
  'tired',
  'drained',
  'mude',
  'erschopft',
  'kaputt',
  'cansado',
  'cansada',
  'agotado',
  'agotada',
];
const HIGH = [
  'en forme',
  'plein d energie',
  'pleine d energie',
  'motive',
  'motivee',
  'energized',
  'full of energy',
  'great today',
  'voller energie',
  'fit heute',
  'con energia',
  'lleno de energia',
];
const ASK_START = [
  'que ',
  'qu est',
  'quoi',
  'pourquoi',
  'comment',
  'quand',
  'quel',
  'quelle',
  'est ce',
  'what',
  'why',
  'how',
  'when',
  'which',
  'should',
  'was ',
  'warum',
  'wie ',
  'wann',
  'welche',
  'soll',
  'que ',
  'por que',
  'como',
  'cuando',
  'cual',
  'deberia',
];
const EVENT_WORDS = [
  'dejeuner',
  'diner',
  'rdv',
  'rendez',
  'reunion',
  'meeting',
  'lunch',
  'dinner',
  'call',
  'visio',
  'medecin',
  'dentiste',
  'termin',
  'treffen',
  'mittagessen',
  'besprechung',
  'reunion',
  'cita',
  'comida',
  'cena',
  'cafe',
  'coffee',
  'kaffee',
];
const LEAVE = [
  'pars',
  'partir',
  'finis',
  'finir',
  'termine',
  'arrete',
  'leave',
  'stop',
  'finish',
  'gehe',
  'aufhoren',
  'salgo',
  'termino',
  'acabo',
];

/** "13h", "13h30", "13:30", "à 9h", "at 9", "9am", "um 15 uhr". */
const TIME =
  /(?:^|\s)((?:à|a|at|um|vers|a las|las)\s+)?(\d{1,2})(?:(\s?(?:h|:|uhr)\s?)(\d{2})?|\s?(am|pm))?(?=\s|$|[,.!?])/gi;

function clockTime(text: string, eventLike: boolean): { h: number; m: number; raw: string } | null {
  for (const m of text.matchAll(TIME)) {
    const [raw, prefix, hours, unit, minutes, ampm] = m;
    if (!unit && !ampm && !prefix) continue; // a bare number is not a time
    let h = Number(hours);
    const min = minutes ? Number(minutes) : 0;
    if (ampm?.toLowerCase() === 'pm' && h < 12) h += 12;
    if (h > 23 || min > 59) continue;
    // "2h" alone is a duration unless it clearly reads as a clock time.
    const explicit = Boolean(minutes) || Boolean(ampm) || Boolean(prefix);
    if (!explicit && !(eventLike && h >= 7)) continue;
    return { h, m: min, raw };
  }
  return null;
}

export function interpret(input: string, now: Date = new Date()): Interpretation {
  const text = input.trim();
  const n = normalizeText(text).replace(/'/g, ' ');
  const words = n.split(/[^a-z0-9]+/).filter(Boolean);
  const has = (list: string[]) => list.some((w) => (w.includes(' ') ? n.includes(w) : words.includes(w)));

  // 1. Today's constraints.
  const left =
    /(?:il me reste|reste|only have|i have|ich habe noch|noch|me quedan|tengo)\s*(\d{1,3})\s*(h|min|m|heures?|hours?|stunden?|horas?)/i.exec(
      n,
    );
  const leaving = has(LEAVE) ? /(\d{1,2})\s*(?:h|:|uhr)\s*(\d{2})?/.exec(n) : null;
  const energy: Energy | undefined = has(LOW) ? 'low' : has(HIGH) ? 'high' : undefined;
  if (left || leaving || (energy && words.length <= 10)) {
    const out: Extract<Interpretation, { kind: 'day' }> = { kind: 'day' };
    if (energy) out.energy = energy;
    if (left) out.minutesLeft = Number(left[1]) * (/^h|heure|hour|stunde|hora/.test(left[2]!) ? 60 : 1);
    if (leaving) out.endAt = `${leaving[1]!.padStart(2, '0')}:${leaving[2] ?? '00'}`;
    return out;
  }

  // 2. Questions go to the coach.
  if (text.endsWith('?') || ASK_START.some((s) => n.startsWith(s))) return { kind: 'ask', question: text };

  // 3. A clock time makes it an event.
  const eventLike = has(EVENT_WORDS);
  const time = clockTime(text, eventLike);
  if (time) {
    const rest = text.replace(time.raw, ' ').replace(/\s+/g, ' ').trim();
    const c = parseCapture(rest, now);
    const day = c.dueDate ? new Date(`${c.dueDate}T00:00:00`) : now;
    let start = atTime(day, `${String(time.h).padStart(2, '0')}:${String(time.m).padStart(2, '0')}`);
    if (!c.dueDate && start < now) start = addDays(start, 1);
    const minutes =
      c.estimateMinutes ?? (has(['call', 'appel', 'visio', 'cafe', 'coffee', 'kaffee']) ? 30 : 60);
    return { kind: 'event', title: c.title, start, end: new Date(start.getTime() + minutes * 60_000) };
  }

  // 4. Something to prepare for, with a date: a mission.
  const c = parseCapture(text, now);
  const mission = detectMission(text);
  if (mission && c.dueDate && c.dueDate > isoDay(now))
    return { kind: 'mission', mission, title: c.title, date: c.dueDate };

  return { kind: 'task', captured: c };
}

/* ----------------------- model output → validated action ----------------------- */

/** Instructions for a language model: structure only, never invention. */
export function structurePrompt(now: Date): string {
  const day = now.toLocaleDateString('en-GB', { weekday: 'long' });
  return [
    `Today is ${day} ${isoDay(now)}. Convert the user's sentence into ONE JSON object and nothing else.`,
    'Fields: kind ("task" | "event" | "day" | "ask"), title (short, in the user\'s language, words taken from the sentence),',
    'date ("YYYY-MM-DD" or null), time ("HH:MM" or null), minutes (number or null), promisedTo (person or null),',
    'energy ("low" | "normal" | "high" or null), endAt ("HH:MM" or null), minutesLeft (number or null).',
    '"day" = the user describes their energy or how much time they have today. "ask" = a question.',
    'Use null for anything not stated. Never invent people, dates or times.',
  ].join(' ');
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function wordsOf(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/**
 * Accepts a model's structure only if it is consistent with the sentence:
 * title words and people must come from the input, dates must be real and
 * within a year. Anything else falls back to the deterministic interpreter.
 */
export function fromModel(raw: unknown, input: string, now: Date): Interpretation | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const str = (k: string) =>
    typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim() : null;
  const num = (k: string) =>
    typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) > 0
      ? Math.round(o[k] as number)
      : null;
  const inputWords = new Set(wordsOf(input));
  const title = str('title');
  if (title) {
    const tw = wordsOf(title);
    if (tw.length && tw.filter((w) => inputWords.has(w)).length / tw.length < 0.6) return null;
  }
  const promisedTo = str('promisedTo');
  if (promisedTo && !normalizeText(input).includes(normalizeText(promisedTo))) return null;
  const date = str('date');
  if (date) {
    const d = new Date(`${date}T12:00:00`);
    if (!YMD.test(date) || Number.isNaN(d.getTime())) return null;
    const days = (d.getTime() - now.getTime()) / 86_400_000;
    if (days < -1 || days > 366) return null;
  }
  const time = str('time');
  if (time && !HHMM.test(time)) return null;
  switch (o.kind) {
    case 'ask':
      return { kind: 'ask', question: input.trim() };
    case 'day': {
      const energy = str('energy');
      const endAt = str('endAt');
      const out: Extract<Interpretation, { kind: 'day' }> = { kind: 'day' };
      if (energy === 'low' || energy === 'normal' || energy === 'high') out.energy = energy;
      if (num('minutesLeft')) out.minutesLeft = Math.min(720, num('minutesLeft')!);
      if (endAt && HHMM.test(endAt)) out.endAt = endAt.padStart(5, '0');
      return out.energy || out.minutesLeft || out.endAt ? out : null;
    }
    case 'event': {
      if (!title || !time) return null;
      const start = atTime(date ? new Date(`${date}T12:00:00`) : now, time.padStart(5, '0'));
      const minutes = Math.min(600, num('minutes') ?? 60);
      return { kind: 'event', title, start, end: new Date(start.getTime() + minutes * 60_000) };
    }
    case 'task': {
      if (!title) return null;
      const base = parseCapture(input, now);
      return {
        kind: 'task',
        captured: {
          ...base,
          title,
          dueDate: date ?? base.dueDate,
          estimateMinutes: num('minutes') ?? base.estimateMinutes,
          promisedTo: promisedTo ?? base.promisedTo,
        },
      };
    }
    default:
      return null;
  }
}
