/**
 * Natural language → structure with the optional model, validated by the
 * deterministic engine (domain/command.ts). Returns null when the model is
 * off, not allowed for capture, unavailable, or inconsistent with the text.
 */
import type { AiPreferences } from '../domain/types';
import { fromModel, structurePrompt, type Interpretation } from '../domain/command';
import { complete, extractJson } from './llm';

export async function structureWithModel(
  prefs: AiPreferences,
  text: string,
  now: Date = new Date(),
): Promise<Interpretation | null> {
  const answer = await complete(prefs, 'capture', structurePrompt(now), text, true);
  return fromModel(extractJson(answer), text, now);
}
