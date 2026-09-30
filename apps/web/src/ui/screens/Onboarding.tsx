import { useState } from 'preact/hooks';
import type { Currency, EditionKey, Locale } from '../../domain/types';
import { listEditions } from '../../domain/editions';
import { settings, updateSettings } from '../../data/store';
import { seedDemo } from '../../data/seed';
import { t } from '../../i18n';
import { Button, Field, attempt } from '../components';
import { cloudConfigured } from '../../config';
import { navigate } from '../router';

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
];
const CURRENCIES: Currency[] = ['EUR', 'USD', 'GBP', 'CHF', 'CAD'];

export function Onboarding() {
  const s = settings.value;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(s.name);
  const [edition, setEdition] = useState<EditionKey>(s.edition);
  const [goal, setGoal] = useState(s.context.primaryGoal);
  const [focus, setFocus] = useState(s.context.focusHours);
  const [peak, setPeak] = useState(s.context.energyPeak);
  const [busy, setBusy] = useState(false);

  const finish = async (withDemo: boolean) => {
    setBusy(true);
    await attempt(async () => {
      await updateSettings((cur) => ({
        ...cur,
        name: name.trim().slice(0, 60),
        edition,
        onboardingComplete: true,
        context: {
          ...cur.context,
          primaryGoal: goal.trim().slice(0, 200),
          focusHours: focus,
          energyPeak: peak,
        },
      }));
      if (withDemo) await seedDemo(edition, settings.value.locale);
      navigate('today');
    });
    setBusy(false);
  };

  const editions = listEditions(s.locale);
  return (
    <div class="onboarding">
      <div class="onboarding-card">
        <div class="brand brand-lg">
          <span class="brand-mark" aria-hidden="true">
            Σ
          </span>
          <strong>Σ Life OS</strong>
        </div>
        <ol class="steps" aria-label={t('onboarding.progress')}>
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              class={i === step ? 'current' : i < step ? 'done' : ''}
              aria-current={i === step ? 'step' : undefined}
            >
              {t(`onboarding.step${i}`)}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setStep(1);
            }}
          >
            <h1>{t('onboarding.welcome')}</h1>
            <p class="muted">{t('onboarding.promise')}</p>
            <Field label={t('onboarding.name')}>
              {(id) => (
                <input
                  id={id}
                  value={name}
                  maxLength={60}
                  autoComplete="given-name"
                  onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
                />
              )}
            </Field>
            <div class="row">
              <Field label={t('settings.language')}>
                {(id) => (
                  <select
                    id={id}
                    value={s.locale}
                    onChange={(e) =>
                      void updateSettings({ locale: (e.currentTarget as HTMLSelectElement).value as Locale })
                    }
                  >
                    {LOCALES.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={t('settings.currency')}>
                {(id) => (
                  <select
                    id={id}
                    value={s.currency}
                    onChange={(e) =>
                      void updateSettings({
                        currency: (e.currentTarget as HTMLSelectElement).value as Currency,
                      })
                    }
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <div class="modal-actions">
              {cloudConfigured() && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void updateSettings({ onboardingComplete: true }).then(() => navigate('account'))
                  }
                >
                  {t('onboarding.haveAccount')}
                </Button>
              )}
              <Button variant="primary" type="submit">
                {t('common.continue')}
              </Button>
            </div>
          </form>
        )}

        {step === 1 && (
          <div>
            <h1>{t('onboarding.editionTitle')}</h1>
            <p class="muted">{t('onboarding.editionBody')}</p>
            <div class="edition-grid" role="radiogroup" aria-label={t('onboarding.editionTitle')}>
              {editions.map((ed) => (
                <button
                  key={ed.key}
                  type="button"
                  role="radio"
                  aria-checked={edition === ed.key}
                  class={`edition-card ${edition === ed.key ? 'selected' : ''}`}
                  style={{ '--edition-accent': ed.accent } as never}
                  onClick={() => setEdition(ed.key)}
                >
                  <span class="edition-icon" aria-hidden="true">
                    {ed.icon}
                  </span>
                  <strong>{ed.name}</strong>
                  <small class="muted">{ed.promise}</small>
                </button>
              ))}
            </div>
            <div class="modal-actions">
              <Button variant="ghost" onClick={() => setStep(0)}>
                {t('common.back')}
              </Button>
              <Button variant="primary" onClick={() => setStep(2)}>
                {t('common.continue')}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h1>{t('onboarding.contextTitle')}</h1>
            <p class="muted">{t('onboarding.contextBody')}</p>
            <Field label={t('context.primaryGoal')} hint={t('context.primaryGoalHint')}>
              {(id) => (
                <input
                  id={id}
                  value={goal}
                  maxLength={200}
                  onInput={(e) => setGoal((e.currentTarget as HTMLInputElement).value)}
                />
              )}
            </Field>
            <div class="row">
              <Field label={t('context.focusHours')}>
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min={1}
                    max={12}
                    step={0.5}
                    value={focus}
                    onInput={(e) => setFocus(Number((e.currentTarget as HTMLInputElement).value) || 4)}
                  />
                )}
              </Field>
              <Field label={t('context.energyPeak')}>
                {(id) => (
                  <select
                    id={id}
                    value={peak}
                    onChange={(e) => setPeak((e.currentTarget as HTMLSelectElement).value as typeof peak)}
                  >
                    {(['morning', 'afternoon', 'evening'] as const).map((p) => (
                      <option key={p} value={p}>
                        {t(`context.peak.${p}`)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <p class="small muted">{t('onboarding.privacy')}</p>
            <div class="modal-actions">
              <Button variant="ghost" onClick={() => setStep(1)}>
                {t('common.back')}
              </Button>
              <Button onClick={() => void finish(true)} loading={busy}>
                {t('onboarding.withDemo')}
              </Button>
              <Button variant="primary" onClick={() => void finish(false)} loading={busy}>
                {t('onboarding.start')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
