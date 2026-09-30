/**
 * Two-minute onboarding: say what is on your mind → pick a profile → see the
 * first plan. Captures describing a test, an interview or a talk with a date
 * become missions; everything else becomes a task.
 */
import { useState } from 'preact/hooks';
import type { EditionKey, Locale } from '../../domain/types';
import { detectMission, parseCapture } from '../../domain/capture';
import { createMany, settings, updateSettings } from '../../data/store';
import { seedDemo } from '../../data/seed';
import { t, fmtDate } from '../../i18n';
import { Button, Field, attempt, toast } from '../components';
import { cloudConfigured } from '../../config';
import { googleAvailable, syncGoogleCalendar } from '../../services/connectors/google';
import { navigate } from '../router';

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
];

const PROFILES: { key: string; edition: EditionKey; icon: string }[] = [
  { key: 'employee', edition: 'life', icon: '🧑‍💼' },
  { key: 'solo', edition: 'solo', icon: '💼' },
  { key: 'student', edition: 'student', icon: '🎓' },
  { key: 'parent', edition: 'life', icon: '👨‍👩‍👧' },
  { key: 'creator', edition: 'creator', icon: '✦' },
  { key: 'nomad', edition: 'nomad', icon: '◎' },
];

interface Understood {
  text: string;
  mission: 'exam' | 'interview' | 'presentation' | null;
  title: string;
  dueDate: string | null;
  minutes: number | null;
}

function understand(lines: string[]): Understood[] {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => {
      const c = parseCapture(text);
      const kind = detectMission(text);
      return {
        text,
        mission: kind && c.dueDate ? kind : null,
        title: c.title,
        dueDate: c.dueDate,
        minutes: c.estimateMinutes,
      };
    });
}

export function Onboarding() {
  const s = settings.value;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(s.name);
  const [lines, setLines] = useState(['', '', '']);
  const [profile, setProfile] = useState('employee');
  const [peak, setPeak] = useState(s.context.energyPeak);
  const [busy, setBusy] = useState(false);
  const [calendar, setCalendar] = useState<number | null>(null);
  const items = understand(lines);

  const saveProfile = () => {
    const p = PROFILES.find((x) => x.key === profile) ?? PROFILES[0]!;
    return updateSettings((cur) => ({
      ...cur,
      name: name.trim().slice(0, 60),
      edition: p.edition,
      context: { ...cur.context, energyPeak: peak },
    }));
  };

  const finish = async (withDemo: boolean) => {
    setBusy(true);
    await attempt(async () => {
      await saveProfile();
      const tasks = items.filter((i) => !i.mission);
      const missions = items.filter((i) => i.mission);
      if (tasks.length)
        await createMany(
          'tasks',
          tasks.map((i) => {
            const c = parseCapture(i.text);
            return {
              title: c.title.slice(0, 300),
              category: c.category ?? 'work',
              status: 'todo' as const,
              priority: c.priority,
              dueDate: c.dueDate,
              scheduledFor: c.dueDate ? c.scheduledFor : 'today',
              estimateMinutes: c.estimateMinutes ?? undefined,
              essential: tasks.length === 1,
            };
          }),
        );
      if (missions.length)
        await createMany(
          'missions',
          missions.map((i) => ({
            kind: i.mission!,
            title: i.title.slice(0, 200),
            targetDate: i.dueDate,
            status: 'active' as const,
            minutesPerDay: 30,
            daysPerWeek: 5,
            topics: i.mission === 'exam' ? [{ id: 't1', title: i.title.slice(0, 200), mastery: 2 }] : [],
            log: [],
          })),
        );
      if (withDemo) await seedDemo(settings.value.edition, settings.value.locale);
      await updateSettings({ onboardingComplete: true });
      navigate('today');
    });
    setBusy(false);
  };

  const connectCalendar = async () => {
    setBusy(true);
    await attempt(async () => {
      const r = await syncGoogleCalendar();
      setCalendar(r.added + r.updated);
      toast(t('onboarding.calendarConnected', { count: r.added + r.updated }), 'good');
    });
    setBusy(false);
  };

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
              {t(`onboarding.stepNew${i}`)}
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
            <h1>{t('onboarding.mindTitle')}</h1>
            <p class="muted">{t('onboarding.mindBody')}</p>
            {lines.map((value, i) => (
              <Field key={i} label={t('onboarding.mindLabel', { n: i + 1 })}>
                {(id) => (
                  <input
                    id={id}
                    value={value}
                    maxLength={300}
                    placeholder={t(`onboarding.mindExample${i + 1}`)}
                    onInput={(e) => {
                      const next = [...lines];
                      next[i] = (e.currentTarget as HTMLInputElement).value;
                      setLines(next);
                    }}
                  />
                )}
              </Field>
            ))}
            <div class="row">
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
            <h1>{t('onboarding.profileTitle')}</h1>
            <p class="muted">{t('onboarding.profileBody')}</p>
            <div class="edition-grid compact" role="radiogroup" aria-label={t('onboarding.profileTitle')}>
              {PROFILES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="radio"
                  aria-checked={profile === p.key}
                  class={`edition-card ${profile === p.key ? 'selected' : ''}`}
                  onClick={() => setProfile(p.key)}
                >
                  <span class="edition-icon" aria-hidden="true">
                    {p.icon}
                  </span>
                  <strong>{t(`onboarding.profile.${p.key}`)}</strong>
                </button>
              ))}
            </div>
            <p class="label">{t('onboarding.peakTitle')}</p>
            <div class="segmented" role="radiogroup" aria-label={t('onboarding.peakTitle')}>
              {(['morning', 'afternoon', 'evening'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={peak === p}
                  class={peak === p ? 'active' : ''}
                  onClick={() => setPeak(p)}
                >
                  {t(`context.peak.${p}`)}
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
            <h1>{t('onboarding.planTitle')}</h1>
            {items.length ? (
              <>
                <p class="muted">{t('onboarding.planBody')}</p>
                <ul class="understood">
                  {items.map((i) => (
                    <li key={i.text}>
                      <span class="badge">
                        {i.mission ? t(`mission.kind.${i.mission}`) : t('onboarding.asTask')}
                      </span>
                      <strong>{i.title}</strong>
                      <span class="muted small">
                        {i.dueDate && ` · ${fmtDate(i.dueDate)}`}
                        {i.minutes && ` · ${i.minutes} min`}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p class="muted">{t('onboarding.planEmpty')}</p>
            )}
            {googleAvailable() && (
              <div class="notice">
                <span>
                  {calendar === null
                    ? t('onboarding.calendarHint')
                    : t('onboarding.calendarConnected', { count: calendar })}
                </span>
                {calendar === null && (
                  <Button size="sm" icon="calendar" loading={busy} onClick={() => void connectCalendar()}>
                    {t('onboarding.connectCalendar')}
                  </Button>
                )}
              </div>
            )}
            <p class="small muted">{t('onboarding.privacy')}</p>
            <div class="modal-actions">
              <Button variant="ghost" onClick={() => setStep(1)}>
                {t('common.back')}
              </Button>
              <Button onClick={() => void finish(true)} loading={busy}>
                {t('onboarding.withDemo')}
              </Button>
              <Button variant="primary" onClick={() => void finish(false)} loading={busy}>
                {t('onboarding.seePlan')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
