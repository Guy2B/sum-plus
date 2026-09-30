import { useEffect, useState } from 'preact/hooks';
import { create, snapshot, clock, settings, updateSettings, remove } from '../../data/store';
import { healthTrend } from '../../domain/wellbeing';
import { isoDay } from '../../domain/dates';
import { getEdition } from '../../domain/editions';
import {
  importNativeHealth,
  nativeHealthAvailable,
  nativePlatform,
  parseHealthCsv,
  upsertDaily,
} from '../../services/health-bridge';
import { t, fmtDate, fmtNumber } from '../../i18n';
import {
  Button,
  Card,
  Field,
  IconButton,
  PageHeader,
  ProGate,
  Sparkline,
  Stat,
  attempt,
  confirmDialog,
  toast,
} from '../components';
import { update } from '../../data/store';

function Consent() {
  return (
    <Card title={t('health.consentTitle')}>
      <p>{t('health.consentBody')}</p>
      <ul class="plain-list small">
        <li>• {t('health.consentLocal')}</li>
        <li>• {t('health.consentSync')}</li>
        <li>• {t('health.consentNotMedical')}</li>
        <li>• {t('health.consentWithdraw')}</li>
      </ul>
      <div class="modal-actions">
        <Button
          variant="primary"
          onClick={() =>
            void updateSettings({ consent: { ...settings.value.consent, health: new Date().toISOString() } })
          }
        >
          {t('health.consentAccept')}
        </Button>
      </div>
    </Card>
  );
}

function HealthInner() {
  const now = clock.value;
  const [date, setDate] = useState(isoDay(now));
  const [sleep, setSleep] = useState('');
  const [energy, setEnergy] = useState(3);
  const [stress, setStress] = useState(3);
  const [steps, setSteps] = useState('');
  const [native, setNative] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => void nativeHealthAvailable().then(setNative), []);

  const metrics = snapshot.value.health.filter((h) => !h.deletedAt);
  const trend = healthTrend(metrics, now, 14);
  const recent = [...metrics].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);

  const save = async (e: Event) => {
    e.preventDefault();
    const sleepHours = sleep ? Math.min(24, Math.max(0, Number(sleep.replace(',', '.')))) : null;
    const fields = {
      date,
      sleepHours: Number.isFinite(sleepHours) ? sleepHours : null,
      energy,
      stress,
      steps: steps ? Math.max(0, Math.round(Number(steps))) || null : null,
      source: 'manual' as const,
    };
    const existing = metrics.find((m) => m.date === date && m.source === 'manual');
    await attempt(async () => {
      if (existing) await update('health', existing.id, fields);
      else await create('health', fields);
      setSleep('');
      setSteps('');
    }, t('common.saved'));
  };

  const withdraw = async () => {
    const ok = await confirmDialog({
      title: t('health.withdrawTitle'),
      body: t('health.withdrawBody'),
      confirmLabel: t('health.withdrawConfirm'),
      danger: true,
    });
    if (!ok) return;
    for (const m of metrics) await remove('health', m.id);
    await updateSettings({ consent: { ...settings.value.consent, health: null } });
    toast(t('health.withdrawn'), 'good');
  };

  return (
    <>
      <Card title={t('health.trend')}>
        <div class="stats">
          <Stat
            label={t('health.readiness')}
            value={trend.readiness == null ? '—' : `${trend.readiness}/100`}
            detail={t('health.readinessHint')}
          />
          <Stat
            label={t('health.avgSleep')}
            value={trend.avgSleep == null ? '—' : t('health.hours', { value: fmtNumber(trend.avgSleep, 1) })}
            detail={trend.sleepTrend ? t(`health.trendValue.${trend.sleepTrend}`) : undefined}
          />
          <Stat
            label={t('health.avgEnergy')}
            value={trend.avgEnergy == null ? '—' : `${fmtNumber(trend.avgEnergy, 1)}/5`}
          />
          <Stat
            label={t('health.avgSteps')}
            value={trend.avgSteps == null ? '—' : fmtNumber(trend.avgSteps)}
          />
        </div>
        <div class="sparks">
          <div>
            <span class="small muted">{t('health.sleep')}</span>
            <Sparkline values={trend.series.map((s) => s.sleepHours)} label={t('health.sleep')} />
          </div>
          <div>
            <span class="small muted">{t('health.energy')}</span>
            <Sparkline values={trend.series.map((s) => s.energy)} label={t('health.energy')} />
          </div>
          <div>
            <span class="small muted">{t('health.steps')}</span>
            <Sparkline values={trend.series.map((s) => s.steps)} label={t('health.steps')} />
          </div>
        </div>
        <p class="small muted">{t('health.disclaimer')}</p>
      </Card>

      <div class="grid grid-2">
        <Card title={t('health.checkin')}>
          <form class="form" onSubmit={save}>
            <div class="row">
              <Field label={t('health.date')}>
                {(id) => (
                  <input
                    id={id}
                    type="date"
                    max={isoDay(now)}
                    value={date}
                    onInput={(e) => setDate((e.currentTarget as HTMLInputElement).value)}
                  />
                )}
              </Field>
              <Field label={t('health.sleepHours')}>
                {(id) => (
                  <input
                    id={id}
                    inputMode="decimal"
                    placeholder="7,5"
                    value={sleep}
                    onInput={(e) => setSleep((e.currentTarget as HTMLInputElement).value)}
                  />
                )}
              </Field>
            </div>
            <Field label={t('health.energyLevel', { value: energy })}>
              {(id) => (
                <input
                  id={id}
                  type="range"
                  min={1}
                  max={5}
                  value={energy}
                  onInput={(e) => setEnergy(Number((e.currentTarget as HTMLInputElement).value))}
                />
              )}
            </Field>
            <Field label={t('health.stressLevel', { value: stress })}>
              {(id) => (
                <input
                  id={id}
                  type="range"
                  min={1}
                  max={5}
                  value={stress}
                  onInput={(e) => setStress(Number((e.currentTarget as HTMLInputElement).value))}
                />
              )}
            </Field>
            <Field label={t('health.steps')}>
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={0}
                  value={steps}
                  onInput={(e) => setSteps((e.currentTarget as HTMLInputElement).value)}
                />
              )}
            </Field>
            <Button type="submit" variant="primary">
              {t('common.save')}
            </Button>
          </form>
        </Card>

        <Card title={t('health.sources')}>
          {native ? (
            <Button
              icon="heart"
              loading={busy}
              onClick={() => {
                setBusy(true);
                void attempt(async () => {
                  const n = await importNativeHealth(14);
                  toast(t('health.imported', { count: n }), 'good');
                }).finally(() => setBusy(false));
              }}
            >
              {nativePlatform() === 'ios' ? t('health.importApple') : t('health.importHealthConnect')}
            </Button>
          ) : (
            <p class="small muted">{t('health.nativeHint')}</p>
          )}
          <label class="btn btn-secondary btn-md file-btn">
            <input
              type="file"
              accept=".csv,text/csv"
              class="sr-only"
              onChange={(e) => {
                const f = (e.currentTarget as HTMLInputElement).files?.[0];
                (e.currentTarget as HTMLInputElement).value = '';
                if (!f) return;
                void attempt(async () => {
                  const rows = parseHealthCsv(await f.text());
                  const n = await upsertDaily(rows, 'import');
                  for (const r of rows.filter((x) => x.energy || x.stress)) {
                    const m = snapshot.value.health.find((h) => h.date === r.date && h.source === 'import');
                    if (m)
                      await update('health', m.id, { energy: r.energy ?? null, stress: r.stress ?? null });
                  }
                  toast(t('health.imported', { count: n }), 'good');
                });
              }}
            />
            <span>{t('health.importCsv')}</span>
          </label>
          <p class="small muted">{t('health.csvHint')}</p>
          <hr />
          <Button variant="danger" size="sm" onClick={() => void withdraw()}>
            {t('health.withdraw')}
          </Button>
        </Card>
      </div>

      <Card title={t('health.history')}>
        {recent.length ? (
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">{t('health.date')}</th>
                <th scope="col">{t('health.sleep')}</th>
                <th scope="col">{t('health.energy')}</th>
                <th scope="col">{t('health.stress')}</th>
                <th scope="col">{t('health.steps')}</th>
                <th scope="col">{t('health.source')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDate(m.date)}</td>
                  <td>{m.sleepHours ?? '—'}</td>
                  <td>{m.energy ?? '—'}</td>
                  <td>{m.stress ?? '—'}</td>
                  <td>{m.steps != null ? fmtNumber(m.steps) : '—'}</td>
                  <td class="muted small">{t(`health.sourceValue.${m.source}`)}</td>
                  <td>
                    <IconButton
                      icon="trash"
                      label={t('common.delete')}
                      onClick={() => void remove('health', m.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="muted">{t('health.empty')}</p>
        )}
      </Card>
    </>
  );
}

export function Health() {
  const ed = getEdition(settings.value.edition, settings.value.locale);
  return (
    <div class="page">
      <PageHeader title={ed.nav.health} subtitle={t('health.subtitle')} />
      <ProGate feature="health">{settings.value.consent.health ? <HealthInner /> : <Consent />}</ProGate>
    </div>
  );
}
