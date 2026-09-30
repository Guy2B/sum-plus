import { useEffect, useState } from 'preact/hooks';
import type { AiMode, Settings } from '../../domain/types';
import type { Interpretation } from '../../domain/command';
import { settings, updateSettings } from '../../data/store';
import {
  LOCAL_PRESETS,
  aiMode,
  detectLocal,
  isChatModel,
  isSafeEndpoint,
  recommendModel,
  testLocal,
  type Detected,
  type LocalTest,
} from '../../services/llm';
import { browserModelStatus } from '../../services/ai';
import { structureWithModel } from '../../services/structure';
import { t } from '../../i18n';
import { Button, Card, Field, PageHeader, Toggle } from '../components';
import { describe } from '../composer';

type TryResult = { interp: Interpretation | null; ms: number } | null;

function titleOf(i: Interpretation): string {
  if (i.kind === 'task') return i.captured.title;
  if (i.kind === 'event' || i.kind === 'mission') return i.title;
  return '';
}

export function Intelligence() {
  const s = settings.value;
  const ai = s.ai;
  const mode = aiMode(ai);
  const [browser, setBrowser] = useState('unavailable');
  const [url, setUrl] = useState(ai.localUrl ?? LOCAL_PRESETS[0].url);
  const [model, setModel] = useState(ai.localModel ?? LOCAL_PRESETS[0].model);
  const [test, setTest] = useState<LocalTest | null>(null);
  const [testing, setTesting] = useState(false);
  const [detected, setDetected] = useState<Detected[] | null>(null);
  const [sample, setSample] = useState(t('ai.tryExample'));
  const [trying, setTrying] = useState(false);
  const [tried, setTried] = useState<TryResult>(null);
  useEffect(() => void browserModelStatus().then(setBrowser), []);

  const set = (patch: Partial<Settings['ai']>) =>
    void updateSettings({ ai: { ...settings.value.ai, ...patch } });
  const allow = ai.allow ?? { coach: true, capture: true };
  const saveLocal = (u = url, m = model) => set({ localUrl: u.trim(), localModel: m.trim() });

  // Local mode: look for servers already running on this machine.
  useEffect(() => {
    if (mode !== 'local') return;
    void detectLocal().then((found) => {
      setDetected(found);
      const current = found.find((d) => d.url === url);
      if (current) setTest({ ok: current.models.includes(model), models: current.models, hasModel: true });
    });
  }, [mode]);

  const choose = (d: Detected) => {
    const keep = d.models.includes(model) ? model : (recommendModel(d.models) ?? model);
    setUrl(d.url);
    setModel(keep);
    setTest({ ok: d.models.includes(keep), models: d.models, hasModel: true });
    setTried(null);
    saveLocal(d.url, keep);
  };

  const runTest = async () => {
    setTesting(true);
    saveLocal();
    setTest(await testLocal(url, model));
    setTesting(false);
  };

  const runTry = async () => {
    setTrying(true);
    saveLocal();
    const started = performance.now();
    const prefs = {
      ...ai,
      mode: 'local' as const,
      localUrl: url,
      localModel: model,
      allow: { ...allow, capture: true },
    };
    const interp = await structureWithModel(prefs, sample.trim()).catch(() => null);
    setTried({ interp, ms: Math.round(performance.now() - started) });
    setTrying(false);
  };

  const models = (test?.models ?? []).filter(isChatModel);
  const recommended = recommendModel(models);

  const modes: { key: AiMode; disabled?: boolean }[] = [
    { key: 'core' },
    { key: 'browser', disabled: browser === 'unavailable' },
    { key: 'local' },
  ];

  return (
    <div class="page page-narrow">
      <PageHeader title={t('nav.intelligence')} subtitle={t('ai.subtitle')} />

      <Card title={t('ai.modeTitle')}>
        <div class="kind-grid" role="radiogroup" aria-label={t('ai.modeTitle')}>
          {modes.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={mode === m.key}
              disabled={m.disabled}
              class={`kind-card ${mode === m.key ? 'selected' : ''}`}
              onClick={() => set({ mode: m.key, browserModel: m.key === 'browser', gateway: false })}
            >
              <strong>{t(`ai.mode.${m.key}`)}</strong>
              <small class="muted">
                {m.key === 'browser'
                  ? t('ai.modeHint.browser', { status: t(`account.aiStatus.${browser}`) })
                  : t(`ai.modeHint.${m.key}`)}
              </small>
            </button>
          ))}
        </div>
      </Card>

      {mode === 'local' && (
        <Card title={t('ai.localTitle')}>
          <p class="small muted" aria-live="polite">
            {detected === null
              ? t('ai.detecting')
              : detected.length
                ? t('ai.detected')
                : t('ai.detectedNone')}
          </p>
          <div class="chips">
            {(detected?.length ? detected : LOCAL_PRESETS.map((p) => ({ ...p, models: [] as string[] }))).map(
              (d) => (
                <button
                  key={d.label}
                  type="button"
                  class={`chip ${url === d.url ? 'chip-on' : ''}`}
                  aria-pressed={url === d.url}
                  onClick={() =>
                    d.models.length
                      ? choose(d)
                      : (setUrl(d.url), setModel(LOCAL_PRESETS.find((p) => p.url === d.url)?.model ?? model))
                  }
                >
                  {d.models.length
                    ? `✓ ${d.label} · ${t('ai.modelCount', { count: d.models.filter(isChatModel).length })}`
                    : d.label}
                </button>
              ),
            )}
          </div>
          <div class="row">
            <Field label={t('ai.url')} error={url && !isSafeEndpoint(url) ? t('ai.urlUnsafe') : null}>
              {(id) => (
                <input
                  id={id}
                  type="url"
                  value={url}
                  placeholder="http://localhost:11434"
                  onInput={(e) => setUrl((e.currentTarget as HTMLInputElement).value)}
                  onBlur={() => saveLocal()}
                />
              )}
            </Field>
            <Field label={t('ai.model')}>
              {(id) =>
                models.length ? (
                  <select
                    id={id}
                    value={model}
                    onChange={(e) => {
                      const m = (e.currentTarget as HTMLSelectElement).value;
                      setModel(m);
                      setTried(null);
                      saveLocal(url, m);
                    }}
                  >
                    {!models.includes(model) && <option value={model}>{model}</option>}
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m === recommended ? `${m} — ${t('ai.recommended')}` : m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    value={model}
                    placeholder="qwen3:8b"
                    onInput={(e) => setModel((e.currentTarget as HTMLInputElement).value)}
                    onBlur={() => saveLocal()}
                  />
                )
              }
            </Field>
          </div>
          <div class="row-actions">
            <Button variant="ghost" loading={testing} onClick={() => void runTest()}>
              {t('ai.test')}
            </Button>
            {test && (
              <span class={test.ok ? 'good-text small' : 'bad-text small'}>
                {test.ok
                  ? t('ai.testOk', { count: models.length })
                  : test.error
                    ? t(`ai.testError.${test.error}`)
                    : t('ai.testError.model')}
              </span>
            )}
          </div>
          {test?.error === 'unreachable' && (
            <div class="notice warn">
              <span>{t('ai.corsHelp', { origin: location.origin })}</span>
            </div>
          )}

          <div class="try-model">
            <Field label={t('ai.tryLabel')} hint={t('ai.tryHint')}>
              {(id) => (
                <input
                  id={id}
                  value={sample}
                  maxLength={200}
                  onInput={(e) => setSample((e.currentTarget as HTMLInputElement).value)}
                />
              )}
            </Field>
            <Button
              variant="primary"
              loading={trying}
              disabled={!sample.trim()}
              onClick={() => void runTry()}
            >
              {t('ai.try')}
            </Button>
            {tried && (
              <div class={`notice ${tried.interp ? 'good' : 'warn'}`} role="status">
                {tried.interp ? (
                  <span>
                    <strong>{titleOf(tried.interp) || t(`ai.kind.${tried.interp.kind}`)}</strong> →{' '}
                    {describe(tried.interp)}
                    <br />
                    <small>{t('ai.tryOk', { model, ms: tried.ms })}</small>
                  </span>
                ) : (
                  <span>{t('ai.tryFail', { ms: tried.ms })}</span>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {mode !== 'core' && (
        <Card title={t('ai.allowTitle')}>
          <Toggle
            label={t('ai.allow.coach')}
            hint={t('ai.allow.coachHint')}
            checked={allow.coach}
            onChange={(v) => set({ allow: { ...allow, coach: v } })}
          />
          <Toggle
            label={t('ai.allow.capture')}
            hint={t('ai.allow.captureHint')}
            checked={allow.capture}
            onChange={(v) => set({ allow: { ...allow, capture: v } })}
          />
          <Toggle
            label={t('account.aiSemantic')}
            hint={t('account.aiSemanticHint')}
            checked={ai.semantic}
            onChange={(v) => set({ semantic: v })}
          />
          <p class="small muted">{t('ai.never')}</p>
        </Card>
      )}

      <p class="small muted">{t('ai.principle')}</p>
    </div>
  );
}
