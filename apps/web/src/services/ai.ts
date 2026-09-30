/**
 * Optional AI layers on top of the deterministic coach. None of them can add
 * facts: they may only (1) route a question to an intent, or (2) rephrase an
 * already-grounded answer. Rephrasings that drop or alter any number are
 * rejected and the deterministic text is shown instead.
 */
import type { CoachIntent } from '../domain/coach';
import type { AiPreferences, Locale } from '../domain/types';

/* --------------------------- fact preservation ---------------------------- */

const NUM = /\d+(?:[.,]\d+)?/g;

export function numbersIn(text: string): string[] {
  return (text.match(NUM) ?? []).map((n) => n.replace(',', '.'));
}

/** True when every number of `source` still appears in `candidate`. */
export function preservesFacts(source: string, candidate: string): boolean {
  if (!candidate.trim() || candidate.length > source.length * 2.5 + 200) return false;
  const have = new Set(numbersIn(candidate));
  return numbersIn(source).every((n) => have.has(n));
}

/* ---------------------------- browser model ------------------------------- */

interface PromptSession {
  prompt(input: string): Promise<string>;
  destroy(): void;
}
interface LanguageModelApi {
  availability(opts?: object): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(opts?: object): Promise<PromptSession>;
}

function browserModel(): LanguageModelApi | null {
  return (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel ?? null;
}

export async function browserModelStatus(): Promise<
  'unavailable' | 'downloadable' | 'downloading' | 'available'
> {
  const api = browserModel();
  if (!api) return 'unavailable';
  try {
    return await api.availability();
  } catch {
    return 'unavailable';
  }
}

const LANG_NAMES: Record<Locale, string> = { fr: 'French', en: 'English', de: 'German', es: 'Spanish' };

function rewritePrompt(text: string, locale: Locale, tone: string) {
  return `Rewrite the following coaching note in ${LANG_NAMES[locale]} with a ${tone} tone. Keep every fact, name, date and number exactly. Do not add advice, facts or numbers. Output only the rewritten note.\n\n---\n${text}`;
}

async function rewriteWithBrowser(text: string, locale: Locale, tone: string): Promise<string | null> {
  const api = browserModel();
  if (!api || (await browserModelStatus()) !== 'available') return null;
  const session = await api.create({ expectedOutputs: [{ type: 'text', languages: [locale] }] });
  try {
    return await session.prompt(rewritePrompt(text, locale, tone));
  } finally {
    session.destroy();
  }
}

/* ------------------------------ LLM gateway ------------------------------- */

async function rewriteWithGateway(
  url: string,
  text: string,
  locale: Locale,
  tone: string,
): Promise<string | null> {
  if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url.endsWith('/') ? url : `${url}/`))
    return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, locale, tone }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    return typeof data.text === 'string' ? data.text : null;
  } finally {
    clearTimeout(timer);
  }
}

/** Returns an enhanced version, or null when no provider is enabled/valid. */
export async function enhance(
  text: string,
  locale: Locale,
  tone: string,
  prefs: AiPreferences,
): Promise<{ text: string; by: 'browser' | 'gateway' } | null> {
  try {
    if (prefs.browserModel) {
      const out = await rewriteWithBrowser(text, locale, tone);
      if (out && preservesFacts(text, out)) return { text: out.trim(), by: 'browser' };
    }
    if (prefs.gateway && prefs.gatewayUrl) {
      const out = await rewriteWithGateway(prefs.gatewayUrl, text, locale, tone);
      if (out && preservesFacts(text, out)) return { text: out.trim(), by: 'gateway' };
    }
  } catch {
    /* enhancement is best-effort */
  }
  return null;
}

/* --------------------------- semantic routing ----------------------------- */

const EXAMPLES: Record<Exclude<CoachIntent, 'help'>, string[]> = {
  forgetting: ['what am I forgetting', 'qu’est-ce que j’oublie', 'was vergesse ich', 'qué estoy olvidando'],
  canWait: ['what can wait', 'qu’est-ce qui peut attendre', 'was kann warten', 'qué puede esperar'],
  overload: [
    'why is my week so busy',
    'pourquoi ma semaine est surchargée',
    'warum ist meine Woche so voll',
    'por qué mi semana está sobrecargada',
  ],
  blocked: ['what is blocking me', 'qu’est-ce qui me bloque', 'was blockiert mich', 'qué me está bloqueando'],
  freeUp: [
    'free up my friday afternoon',
    'libère-moi vendredi après-midi',
    'mach meinen Freitagnachmittag frei',
    'libérame el viernes por la tarde',
  ],
  plan_day: ['organise my day', 'plan today', 'organise ma journée', 'was steht heute an', 'organiza mi día'],
  prioritize: [
    'what should I do first',
    'quelle est ma priorité',
    'was ist am wichtigsten',
    'qué hago primero',
  ],
  review: ['weekly review', 'fais le point sur ma semaine', 'Wochenrückblick', 'resumen de la semana'],
  finance: [
    'how is my cash flow',
    'état de ma trésorerie',
    'wie stehen meine Finanzen',
    'cómo van mis finanzas',
  ],
  project: [
    'which project is stuck',
    'quel projet est bloqué',
    'welches Projekt hängt',
    'qué proyecto está bloqueado',
  ],
  energy: ['I feel tired', 'je suis fatigué', 'ich bin müde', 'estoy cansado'],
  replies: [
    'who do I need to answer',
    'à qui dois-je répondre',
    'wem muss ich antworten',
    'a quién debo responder',
  ],
  study: ['help me study for my exam', 'aide-moi à réviser', 'hilf mir lernen', 'ayúdame a estudiar'],
  goals: [
    'how are my goals going',
    'où en sont mes objectifs',
    'wie stehen meine Ziele',
    'cómo van mis objetivos',
  ],
  household: [
    "what's due for the kids",
    'devoirs des enfants cette semaine',
    'Schulsachen der Kinder',
    'deberes de los niños',
  ],
  career: [
    'job applications status',
    'où en sont mes candidatures',
    'Stand meiner Bewerbungen',
    'estado de mis candidaturas',
  ],
};

type Embedder = (texts: string[]) => Promise<number[][]>;
let embedder: Promise<Embedder> | null = null;
let exampleVectors: Promise<{ intent: CoachIntent; v: number[] }[]> | null = null;

async function loadEmbedder(): Promise<Embedder> {
  embedder ??= (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    const extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
      dtype: 'q8',
    });
    return async (texts: string[]) => {
      const out = await extractor(texts, { pooling: 'mean', normalize: true });
      return out.tolist() as number[][];
    };
  })();
  return embedder;
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

/** Multilingual semantic intent; returns null below the confidence threshold. */
export async function semanticIntent(question: string): Promise<CoachIntent | null> {
  const embed = await loadEmbedder();
  exampleVectors ??= (async () => {
    const pairs = Object.entries(EXAMPLES).flatMap(([intent, list]) =>
      list.map((t) => ({ intent: intent as CoachIntent, t })),
    );
    const vs = await embed(pairs.map((p) => p.t));
    return pairs.map((p, i) => ({ intent: p.intent, v: vs[i] as number[] }));
  })();
  const [q] = await embed([question]);
  let best: { intent: CoachIntent; s: number } = { intent: 'help', s: 0 };
  for (const ex of await exampleVectors) {
    const s = dot(q as number[], ex.v);
    if (s > best.s) best = { intent: ex.intent, s };
  }
  return best.s >= 0.55 ? best.intent : null;
}
