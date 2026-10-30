/**
 * Dictation: speak, and the words land in a note or the capture bar.
 * Uses the browser's own speech recognition (Chrome, Edge, Safari), in the
 * app's language. One dictation at a time; `target` says where it goes.
 */
import { signal } from '@preact/signals';
import { intlLocale } from '../i18n';
import { toast } from '../ui/components';
import { ct } from './i18n';

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = (): boolean => ctor() !== null;

/** Live dictation: where it goes and the words not yet final. */
export const dictation = signal<{ target: string; interim: string } | null>(null);

let rec: Recognition | null = null;
let keep = false;

/** Moves a running dictation to another target (a note created after it started). */
export function retarget(target: string): void {
  if (dictation.value) dictation.value = { ...dictation.value, target };
}

/**
 * Starts listening; each final phrase goes to `onFinal`. Call it from the
 * click itself (some browsers require a user gesture). Returns false when
 * the browser has no speech recognition.
 */
export function startDictation(target: string, onFinal: (text: string) => void): boolean {
  const C = ctor();
  if (!C) {
    toast(ct('voice.unsupported'), 'info');
    return false;
  }
  stopDictation();
  const r = new C();
  r.lang = intlLocale.value;
  r.continuous = true;
  r.interimResults = true;
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]!;
      const text = res[0].transcript;
      if (res.isFinal) onFinal(text);
      else interim += text;
    }
    if (rec === r && dictation.value) dictation.value = { ...dictation.value, interim: interim.trim() };
  };
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    keep = false;
    toast(
      ct(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'voice.denied' : 'voice.error'),
      'bad',
    );
  };
  // Browsers end a session after a silence: carry on until the person stops.
  r.onend = () => {
    if (rec !== r) return;
    if (keep) {
      try {
        r.start();
        return;
      } catch {
        /* fall through */
      }
    }
    rec = null;
    dictation.value = null;
  };
  rec = r;
  keep = true;
  dictation.value = { target, interim: '' };
  try {
    r.start();
  } catch {
    rec = null;
    keep = false;
    dictation.value = null;
    toast(ct('voice.error'), 'bad');
    return false;
  }
  return true;
}

export function stopDictation(): void {
  keep = false;
  const r = rec;
  if (!r) return;
  rec = null;
  dictation.value = null;
  try {
    r.stop();
  } catch {
    /* already stopped */
  }
}

export const isDictating = (target: string): boolean => dictation.value?.target === target;
