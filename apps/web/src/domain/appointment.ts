/**
 * Finds an appointment in a message pasted from WhatsApp, SMS or a mail:
 * "On se voit mardi à 15h au Café Lou", "Termin beim Zahnarzt am 12.11. um 9:30",
 * "Call tomorrow 3pm", "Cita el 14 de noviembre a las 10". French, English,
 * German and Spanish. Returns null when there is no time and no date.
 */

export interface Appointment {
  title: string;
  start: Date;
  /** True when the message gave a time; otherwise 09:00 is a placeholder. */
  timed: boolean;
  /** True when the message gave a day; otherwise today (or tomorrow if the time has passed). */
  dated: boolean;
  location: string | null;
}

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const WEEKDAYS: Record<string, number> = {
  // 0 = Sunday, like Date#getDay
  dimanche: 0,
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sonntag: 0,
  montag: 1,
  dienstag: 2,
  mittwoch: 3,
  donnerstag: 4,
  freitag: 5,
  samstag: 6,
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

const MONTHS: Record<string, number> = {
  janvier: 0,
  fevrier: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  aout: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  decembre: 11,
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
  januar: 0,
  februar: 1,
  marz: 2,
  juni: 5,
  juli: 6,
  oktober: 9,
  dezember: 11,
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

const TODAY = [
  "aujourd'hui",
  'aujourdhui',
  'ce soir',
  'ce matin',
  'cet apres-midi',
  'today',
  'tonight',
  'heute',
  'heute abend',
  'hoy',
  'esta tarde',
  'esta noche',
];
const TOMORROW = ['demain', 'tomorrow', 'morgen', 'manana'];
const AFTER_TOMORROW = ['apres-demain', 'apres demain', 'day after tomorrow', 'ubermorgen', 'pasado manana'];

const atDay = (now: Date, add: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);

/** Removes the matched phrase from the working title. */
function cut(s: string, re: RegExp): string {
  return s.replace(re, ' ');
}

export function parseAppointment(text: string, now: Date = new Date()): Appointment | null {
  // WhatsApp copies start with "[30/10/26, 09:12] Marc: " (or "30.10.26, 09:12 - Marc: "): that is when
  // the message was sent, not the appointment.
  const raw = text
    .split('\n')
    .map((l) =>
      l.replace(
        /^\s*\[?\d{1,2}[./]\d{1,2}[./]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\]?\s*(?:-\s*)?[^:]{1,40}:\s*/,
        '',
      ),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return null;
  // Same length as `raw` (NFD stripping only removes combining marks we then restore by index-free cuts).
  let low = strip(raw);
  let rest = low;
  let day: Date | null = null;
  let hour: number | null = null;
  let minute = 0;

  // ---- time: 15h, 15h30, 15:30, 3pm, 3:30 pm, um 15 Uhr, a las 10
  const timeRes: RegExp[] = [
    /\b(?:a|at|um|vers|a las|alas)?\s*(\d{1,2})\s*[:h.]\s*(\d{2})\s*(am|pm)?\b(?:\s*uhr)?/,
    /\b(?:a|at|um|vers|a las)?\s*(\d{1,2})\s*(h|uhr|am|pm)\b/,
    /\b(?:a las|um|at)\s+(\d{1,2})\b/,
  ];
  const isDateLike = (tok: string, idx: number, src: string) =>
    // "12.11." or "12.11.2026": a date, not 12:11
    /^\d{1,2}\.\d{2}$/.test(tok.trim()) && /^[.]/.test(src.slice(idx + tok.length));
  timeSearch: for (const re of timeRes) {
    const g = new RegExp(re.source, 'g');
    for (const m of rest.matchAll(g)) {
      let h = Number(m[1]);
      const second = m[2] ?? '';
      const mins = /^\d{2}$/.test(second) ? Number(second) : 0;
      const mer = (/^\d{2}$/.test(second) ? m[3] : second) ?? '';
      if (mer === 'pm' && h < 12) h += 12;
      if (mer === 'am' && h === 12) h = 0;
      if (h > 23 || mins > 59) continue;
      const tok = m[0].replace(/^\D*?(?=\d)/, '');
      if (isDateLike(tok, (m.index ?? 0) + m[0].length - tok.length, rest)) continue;
      hour = h;
      minute = mins;
      rest = rest.slice(0, m.index) + ' ' + rest.slice((m.index ?? 0) + m[0].length);
      break timeSearch;
    }
  }

  // ---- date: 12/11, 12.11.2026, 2026-11-12
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(rest);
  if (m) {
    day = new Date(+m[1]!, +m[2]! - 1, +m[3]!);
    rest = cut(rest, /\b(?:le|am|el|on)?\s*\d{4}-\d{2}-\d{2}\b/);
  }
  if (!day) {
    m = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\.?(?=\s|$|,)/.exec(rest);
    if (m && +m[2]! >= 1 && +m[2]! <= 12 && +m[1]! >= 1 && +m[1]! <= 31) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
      day = new Date(y, +m[2]! - 1, +m[1]!);
      if (!m[3] && day < atDay(now, 0)) day = new Date(y + 1, +m[2]! - 1, +m[1]!);
      rest = cut(rest, /\b(?:le|am|el|on|den)?\s*\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\.?(?=\s|$|,)/);
    }
  }
  // ---- date: 12 novembre, 12. November, 14 de noviembre, November 12
  if (!day) {
    const names = Object.keys(MONTHS)
      .sort((a, b) => b.length - a.length)
      .join('|');
    const re1 = new RegExp(
      `\\b(?:le |am |el |the )?(\\d{1,2})(?:er|st|nd|rd|th|\\.)?\\s+(?:de\\s+)?(${names})\\.?(?:\\s+(\\d{4}))?\\b`,
    );
    const re2 = new RegExp(`\\b(${names})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`);
    const a = re1.exec(rest);
    const b = a ? null : re2.exec(rest);
    if (a || b) {
      const d = Number(a ? a[1] : b![2]);
      const mo = MONTHS[(a ? a[2] : b![1])!]!;
      const yy = a ? a[3] : b![3];
      const y = yy ? +yy : now.getFullYear();
      day = new Date(y, mo, d);
      if (!yy && day < atDay(now, 0)) day = new Date(y + 1, mo, d);
      rest = cut(rest, a ? re1 : re2);
    }
  }
  // ---- relative days
  if (!day) {
    for (const [list, add] of [
      [AFTER_TOMORROW, 2],
      [TOMORROW, 1],
      [TODAY, 0],
    ] as const) {
      const w = list.find((x) => new RegExp(`\\b${x}\\b`).test(rest));
      if (w) {
        day = atDay(now, add);
        rest = cut(rest, new RegExp(`\\b${w}\\b`));
        break;
      }
    }
  }
  // ---- weekday: next occurrence (today counts if the time is still ahead)
  if (!day) {
    const w = Object.keys(WEEKDAYS).find((x) => new RegExp(`\\b${x}\\b`).test(rest));
    if (w) {
      const target = WEEKDAYS[w]!;
      let add = (target - now.getDay() + 7) % 7;
      if (add === 0 && (hour == null || hour * 60 + minute <= now.getHours() * 60 + now.getMinutes()))
        add = 7;
      day = atDay(now, add);
      rest = cut(
        rest,
        new RegExp(`\\b(?:ce |le |am |el |this |next |prochain |nachsten )?${w}( prochain)?\\b`),
      );
    }
  }

  if (!day && hour == null) return null;
  const dated = Boolean(day);
  const timed = hour != null;
  let start = new Date((day ?? atDay(now, 0)).getTime());
  start.setHours(hour ?? 9, minute, 0, 0);
  if (!dated && start <= now) start = new Date(start.getTime() + 86_400_000);

  // ---- place: "au Café Lou", "chez Paul", "at Joe's", "im Büro", "en la oficina"
  let location: string | null = null;
  const lm = /\b(?:au|a la|chez|at|im|in der|bei|en el|en la)\s+([^,.!?\n]{2,40})/i.exec(raw);
  if (lm) location = lm[1]!.trim();

  // ---- title: what is left of the first sentence, in the original casing
  low = rest;
  const words = new Set(low.split(/[^a-z0-9']+/).filter(Boolean));
  const kept = raw
    .split(/(\s+)/)
    .filter((tok) => /^\s+$/.test(tok) || words.has(strip(tok).replace(/[^a-z0-9']/g, '')))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:!?.-]+|[\s,;:!?.-]+$/g, '')
    .trim();
  const title = (kept || raw).split(/(?<=[.!?])\s/)[0]!.slice(0, 80);
  return { title, start, timed, dated, location };
}
