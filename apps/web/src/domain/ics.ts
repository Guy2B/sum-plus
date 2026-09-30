/**
 * Minimal, dependency-free iCalendar (RFC 5545) reader for VEVENTs: line
 * unfolding, text unescaping, UTC / floating / TZID times, all-day dates and
 * simple DAILY/WEEKLY/MONTHLY recurrences expanded over a bounded horizon.
 */

export interface IcsEvent {
  uid: string;
  title: string;
  start: string; // ISO UTC
  end: string; // ISO UTC
  allDay: boolean;
  location?: string;
  description?: string;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function parseLine(line: string): Prop | null {
  const idx = line.indexOf(':');
  if (idx < 0) return null;
  const head = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const [name, ...rawParams] = head.split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const [k, v] = p.split('=');
    if (k && v) params[k.toUpperCase()] = v.replace(/^"|"$/g, '');
  }
  return { name: (name ?? '').toUpperCase(), params, value };
}

const unescape = (v: string) =>
  v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

/** Offset in ms of `tz` at the given UTC instant (positive east of UTC). */
function tzOffset(utcMs: number, tz: string): number {
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(
      +parts.year!,
      +parts.month! - 1,
      +parts.day!,
      +parts.hour!,
      +parts.minute!,
      +parts.second!,
    );
    return asUtc - utcMs;
  } catch {
    return 0;
  }
}

function parseDate(prop: Prop): { date: Date; allDay: boolean } | null {
  const v = prop.value.trim();
  if (/^\d{8}$/.test(v) || prop.params.VALUE === 'DATE') {
    const y = +v.slice(0, 4);
    const m = +v.slice(4, 6) - 1;
    const d = +v.slice(6, 8);
    return { date: new Date(y, m, d), allDay: true };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, z] = match;
  const wall = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +(s ?? 0));
  if (z) return { date: new Date(wall), allDay: false };
  if (prop.params.TZID) {
    // Two-pass to settle DST boundaries.
    let guess = wall - tzOffset(wall, prop.params.TZID);
    guess = wall - tzOffset(guess, prop.params.TZID);
    return { date: new Date(guess), allDay: false };
  }
  // Floating time: interpret in the user's local zone.
  return { date: new Date(+y!, +mo! - 1, +d!, +h!, +mi!, +(s ?? 0)), allDay: false };
}

function parseRrule(value: string): Record<string, string> {
  return Object.fromEntries(value.split(';').map((kv) => kv.split('=') as [string, string]));
}

export function parseIcs(
  text: string,
  opts: { now?: Date; horizonDays?: number; maxEvents?: number } = {},
): IcsEvent[] {
  const now = opts.now ?? new Date();
  const horizon = new Date(now.getTime() + (opts.horizonDays ?? 120) * 86_400_000);
  const max = opts.maxEvents ?? 2000;
  const out: IcsEvent[] = [];
  let current: Prop[] | null = null;

  for (const raw of unfold(text)) {
    const line = raw.trimEnd();
    if (line === 'BEGIN:VEVENT') {
      current = [];
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) expand(current);
      current = null;
      continue;
    }
    if (current) {
      const p = parseLine(line);
      if (p) current.push(p);
    }
    if (out.length >= max) break;
  }
  return out.slice(0, max);

  function expand(props: Prop[]) {
    const get = (n: string) => props.find((p) => p.name === n);
    const dtStart = get('DTSTART');
    if (!dtStart) return;
    const start = parseDate(dtStart);
    if (!start) return;
    const dtEnd = get('DTEND');
    const endParsed = dtEnd ? parseDate(dtEnd) : null;
    const duration = endParsed
      ? endParsed.date.getTime() - start.date.getTime()
      : start.allDay
        ? 86_400_000
        : 3_600_000;
    if (get('STATUS')?.value === 'CANCELLED') return;
    const base = {
      uid: get('UID')?.value ?? `${start.date.getTime()}-${Math.random().toString(36).slice(2)}`,
      title: unescape(get('SUMMARY')?.value ?? '(untitled)'),
      allDay: start.allDay,
      location: get('LOCATION') ? unescape(get('LOCATION')!.value) : undefined,
      description: get('DESCRIPTION') ? unescape(get('DESCRIPTION')!.value).slice(0, 2000) : undefined,
    };
    const push = (d: Date, n: number) => {
      out.push({
        ...base,
        uid: n ? `${base.uid}#${n}` : base.uid,
        start: d.toISOString(),
        end: new Date(d.getTime() + duration).toISOString(),
      });
    };
    const rrule = get('RRULE');
    if (!rrule) {
      push(start.date, 0);
      return;
    }
    const r = parseRrule(rrule.value);
    const freq = r.FREQ;
    const interval = Math.max(1, Number(r.INTERVAL ?? 1));
    const count = r.COUNT ? Number(r.COUNT) : Infinity;
    const untilProp = r.UNTIL ? parseDate({ name: 'UNTIL', params: {}, value: r.UNTIL }) : null;
    const until = untilProp ? untilProp.date : horizon;
    const exdates = new Set(
      props
        .filter((p) => p.name === 'EXDATE')
        .flatMap((p) => p.value.split(',').map((v) => parseDate({ ...p, value: v })?.date.getTime()))
        .filter((x): x is number => x != null),
    );
    let d = new Date(start.date);
    for (let n = 0; n < Math.min(count, 500) && d <= until && d <= horizon; n++) {
      if (!exdates.has(d.getTime()) && d.getTime() + duration >= now.getTime() - 86_400_000 * 30) push(d, n);
      d = new Date(d);
      if (freq === 'DAILY') d.setDate(d.getDate() + interval);
      else if (freq === 'WEEKLY') d.setDate(d.getDate() + 7 * interval);
      else if (freq === 'MONTHLY') d.setMonth(d.getMonth() + interval);
      else if (freq === 'YEARLY') d.setFullYear(d.getFullYear() + interval);
      else break;
    }
  }
}

/** Serialises events back to a portable .ics file. */
export function toIcs(
  events: {
    id: string;
    title: string;
    start: string;
    end: string;
    allDay?: boolean;
    location?: string;
    description?: string;
  }[],
): string {
  const esc = (v: string) =>
    v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = (iso: string) => iso.slice(0, 10).replace(/-/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sigma Life OS//EN', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@sigma-life-os`, `DTSTAMP:${stamp(new Date().toISOString())}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${day(e.start)}`, `DTEND;VALUE=DATE:${day(e.end)}`);
    else lines.push(`DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`);
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
