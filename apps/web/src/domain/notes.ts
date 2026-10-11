/**
 * Notes coming from the phone (shared from Samsung Notes, Google Keep, Apple
 * Notes…) or imported as .txt/.md files. A note is split into candidate tasks
 * the person confirms; the full text can be kept as a journal note.
 */

const BULLET = /^\s*(?:[-*•–·▪◦]|\[\s?\]|☐|□|\d{1,2}[.)])\s+/;
const CHECKED = /^\s*(?:\[[xX✓]\]|☑|✅|✓|✔)\s*/;
const MAX_TASK_CHARS = 140;

export interface SplitNote {
  /** First meaningful line, used as the note title. */
  title: string;
  /** Lines proposed as tasks (bullets/checkbox items, or every line of a short list-like note). */
  tasks: string[];
  /** Ticked items found in the note: already done, not proposed. */
  done: number;
  /** The whole note, for the journal. */
  text: string;
}

const clean = (line: string) => line.replace(BULLET, '').replace(/\s+/g, ' ').trim();

export function splitNote(raw: string): SplitNote {
  const text = raw.replace(/\r\n?/g, '\n').trim().slice(0, 20_000);
  const lines = text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  const done = lines.filter((l) => CHECKED.test(l)).length;
  const open = lines.filter((l) => !CHECKED.test(l));
  const title = clean(open[0] ?? lines[0] ?? '').slice(0, 120);

  const bullets = open.filter((l) => BULLET.test(l)).map(clean);
  let tasks: string[];
  if (bullets.length) tasks = bullets;
  else if (open.length >= 2 && open.length <= 12 && open.every((l) => l.trim().length <= MAX_TASK_CHARS))
    // A short list without bullets ("Call bank\nBuy milk"): every line is an item.
    tasks = open.map(clean);
  else if (open.length === 1 && open[0]!.trim().length <= MAX_TASK_CHARS) tasks = [clean(open[0]!)];
  else tasks = []; // prose: keep as a note only
  tasks = [...new Set(tasks.filter(Boolean).map((t) => t.slice(0, 300)))].slice(0, 50);
  return { title, tasks, done, text };
}

/** Text from a share intent: title and text often both carry content; links are appended. */
export function sharedText(params: URLSearchParams): string {
  const parts = [params.get('title'), params.get('text'), params.get('url')]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  return [...new Set(parts)].join('\n');
}
