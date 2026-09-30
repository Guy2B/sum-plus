/**
 * Σ Intelligence: one entry point to an optional language model.
 *  - core    : no model at all (default) — Σ stays 100 % deterministic;
 *  - browser : the browser's built-in model (Chrome LanguageModel), on device;
 *  - local   : Ollama / LM Studio / any OpenAI-compatible endpoint on this machine.
 * The model never decides: it rephrases grounded answers or turns a sentence
 * into structure that the deterministic engine validates. Finance and health
 * data are never sent, whatever the settings.
 */
import type { AiMode, AiPreferences } from '../domain/types';

export type Purpose = 'coach' | 'capture';

export function aiMode(p: AiPreferences): AiMode {
  return p.mode ?? (p.browserModel ? 'browser' : p.gateway ? 'local' : 'core');
}

/** Short name of the model in use, shown next to anything it produced. */
export function modelLabel(p: AiPreferences): string {
  return aiMode(p) === 'local' ? p.localModel || 'local' : 'Chrome';
}

export function allowed(p: AiPreferences, purpose: Purpose): boolean {
  if (aiMode(p) === 'core') return false;
  return p.allow?.[purpose] ?? true;
}

/** Only this machine (localhost) or HTTPS endpoints: data never goes to an arbitrary plain-HTTP host. */
export function isSafeEndpoint(url: string): boolean {
  return /^https:\/\/[^/\s]+|^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url.trim());
}

const base = (url: string) => url.trim().replace(/\/+$/, '').replace(/\/v1$/, '');

export interface LocalTest {
  ok: boolean;
  models: string[];
  hasModel: boolean;
  error?: 'url' | 'unreachable' | 'http' | 'model';
}

/** Lists the models of an OpenAI-compatible server and checks the chosen one exists. */
export async function testLocal(url: string, model: string): Promise<LocalTest> {
  if (!isSafeEndpoint(url)) return { ok: false, models: [], hasModel: false, error: 'url' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${base(url)}/v1/models`, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, models: [], hasModel: false, error: 'http' };
    const data = (await res.json()) as { data?: { id: string }[] };
    const models = (data.data ?? []).map((m) => m.id);
    const hasModel = models.some((m) => m === model || m.startsWith(`${model}:`) || model.startsWith(m));
    return { ok: hasModel, models, hasModel, error: hasModel ? undefined : 'model' };
  } catch {
    // Network error: server stopped, or its CORS settings do not allow this site.
    return { ok: false, models: [], hasModel: false, error: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

export const LOCAL_PRESETS = [
  { label: 'Ollama', url: 'http://localhost:11434', model: 'qwen3:8b' },
  { label: 'LM Studio', url: 'http://localhost:1234', model: 'qwen/qwen3-8b' },
] as const;

export interface Detected {
  label: string;
  url: string;
  models: string[];
}

/** Finds local servers already running on this machine (Ollama, LM Studio). */
export async function detectLocal(): Promise<Detected[]> {
  const found = await Promise.all(
    LOCAL_PRESETS.map(async (p): Promise<Detected | null> => {
      const r = await testLocal(p.url, '');
      return r.error === 'model' || r.ok ? { label: p.label, url: p.url, models: r.models } : null;
    }),
  );
  return found.filter((x): x is Detected => Boolean(x));
}

/** Embedding / reranking models cannot chat: never offer them. */
export const isChatModel = (id: string) => !/embed|bge|nomic|minilm|rerank|e5-|clip/i.test(id);

/** Good instruction-following models of a size that answers in seconds on a laptop. */
const PREFERRED = [
  /qwen3[:/-]?8b/i,
  /qwen3\.5[:/-]?9b/i,
  /qwen2\.5[:/-]?7b/i,
  /qwen3[:/-]?4b/i,
  /gemma3[:/-]?12b/i,
  /llama3\.[12][:/-]?8b/i,
  /mistral/i,
];

export function recommendModel(models: string[]): string | null {
  const chat = models.filter(isChatModel);
  for (const re of PREFERRED) {
    const m = chat.find((x) => re.test(x) && !/vl|vision/i.test(x));
    if (m) return m;
  }
  return chat[0] ?? null;
}

export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^[\s\S]*?<\/think>/, '')
    .trim();
}

async function localChat(
  p: AiPreferences,
  system: string,
  user: string,
  json: boolean,
): Promise<string | null> {
  const url = p.localUrl || p.gatewayUrl;
  if (!url || !isSafeEndpoint(url) || !p.localModel) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${base(url)}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: p.localModel,
        temperature: 0.1,
        stream: false,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    // Reasoning models (Qwen3, DeepSeek-R1…) may inline their thinking; keep only the answer.
    const content = data.choices?.[0]?.message?.content;
    return content ? stripThinking(content) || null : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface PromptSession {
  prompt(input: string): Promise<string>;
  destroy(): void;
}
interface LanguageModelApi {
  availability(opts?: object): Promise<string>;
  create(opts?: object): Promise<PromptSession>;
}

async function browserChat(system: string, user: string): Promise<string | null> {
  const api = (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel;
  if (!api) return null;
  try {
    if ((await api.availability()) !== 'available') return null;
    const session = await api.create({ initialPrompts: [{ role: 'system', content: system }] });
    try {
      return await session.prompt(user);
    } finally {
      session.destroy();
    }
  } catch {
    return null;
  }
}

/** Runs a prompt with the configured model, if allowed for this purpose. */
export async function complete(
  p: AiPreferences,
  purpose: Purpose,
  system: string,
  user: string,
  json = false,
): Promise<string | null> {
  if (!allowed(p, purpose)) return null;
  return aiMode(p) === 'browser' ? browserChat(system, user) : localChat(p, system, user, json);
}

/** First JSON object found in a model answer (models sometimes wrap it in prose or ``` fences). */
export function extractJson(text: string | null): unknown {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
