import { useEffect, useState } from 'preact/hooks';
import type { AiMode, Settings } from '../../domain/types';
import { settings, updateSettings } from '../../data/store';
import { aiMode, isSafeEndpoint, testLocal, type LocalTest } from '../../services/llm';
import { browserModelStatus } from '../../services/ai';
import { t } from '../../i18n';
import { Button, Card, Field, PageHeader, Toggle } from '../components';

const PRESETS = [
  { label: 'Ollama', url: 'http://localhost:11434', model: 'qwen3:8b' },
  { label: 'LM Studio', url: 'http://localhost:1234', model: 'qwen/qwen3-8b' },
];

export function Intelligence() {
  const s = settings.value;
  const ai = s.ai;
  const mode = aiMode(ai);
  const [browser, setBrowser] = useState('unavailable');
  const [url, setUrl] = useState(ai.localUrl ?? 'http://localhost:11434');
  const [model, setModel] = useState(ai.localModel ?? 'qwen3:8b');
  const [test, setTest] = useState<LocalTest | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => void browserModelStatus().then(setBrowser), []);

  const set = (patch: Partial<Settings['ai']>) => void updateSettings({ ai: { ...ai, ...patch } });
  const allow = ai.allow ?? { coach: true, capture: true };
  const saveLocal = () => set({ localUrl: url.trim(), localModel: model.trim() });

  const runTest = async () => {
    setTesting(true);
    saveLocal();
    setTest(await testLocal(url, model));
    setTesting(false);
  };

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
          <div class="chips">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                class="chip"
                onClick={() => {
                  setUrl(p.url);
                  setModel(p.model);
                  setTest(null);
                }}
              >
                {p.label}
              </button>
            ))}
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
                  onBlur={saveLocal}
                />
              )}
            </Field>
            <Field label={t('ai.model')}>
              {(id) => (
                <input
                  id={id}
                  value={model}
                  placeholder="qwen3:8b"
                  onInput={(e) => setModel((e.currentTarget as HTMLInputElement).value)}
                  onBlur={saveLocal}
                />
              )}
            </Field>
          </div>
          <div class="row-actions">
            <Button variant="primary" loading={testing} onClick={() => void runTest()}>
              {t('ai.test')}
            </Button>
            {test && (
              <span class={test.ok ? 'good-text small' : 'bad-text small'}>
                {test.ok ? t('ai.testOk', { count: test.models.length }) : t(`ai.testError.${test.error}`)}
              </span>
            )}
          </div>
          {test && !test.ok && test.error === 'model' && test.models.length > 0 && (
            <p class="small muted">
              {t('ai.available')}{' '}
              {test.models.slice(0, 8).map((m) => (
                <button key={m} type="button" class="chip" onClick={() => setModel(m)}>
                  {m}
                </button>
              ))}
            </p>
          )}
          {test?.error === 'unreachable' && (
            <div class="notice warn">
              <span>{t('ai.corsHelp', { origin: location.origin })}</span>
            </div>
          )}
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
