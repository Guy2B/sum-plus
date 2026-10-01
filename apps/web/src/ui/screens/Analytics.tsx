/**
 * Admin → Analytics: is the product working for people? Aggregated, anonymous
 * numbers only (personal metrics stay in Plan). Admin QA keeps the technical checks.
 */
import { useEffect, useState } from 'preact/hooks';
import { authUser, clock } from '../../data/store';
import { analyze, FUNNEL, RETENTION_AGES } from '../../domain/analytics';
import { loadAnalytics, recomputeAnalytics, type TestimonialRow } from '../../services/telemetry';
import { founderCandidates } from '../../services/founder';
import { config } from '../../config';
import { t } from '../../i18n';
import { Badge, Button, Card, Empty, PageHeader, Stat, toast } from '../components';

type Data = Awaited<ReturnType<typeof loadAnalytics>>;
const PERIODS = [7, 30, 90] as const;
const LANGS = ['fr', 'en', 'de', 'es'] as const;

const fmtPct = (v: number | null) => (v === null ? '—' : `${v} %`);
const fmtDelta = (v: number | null) =>
  v === null ? undefined : t('analytics.delta', { value: `${v > 0 ? '+' : ''}${v}` });

function Bars({ entries }: { entries: [string, number][] }) {
  const total = entries.reduce((a, [, n]) => a + n, 0);
  if (!total) return <span class="muted">—</span>;
  return (
    <span>
      {entries
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${Math.round((n / total) * 100)} %`)
        .join(' · ')}
    </span>
  );
}

function Pulse({ rows }: { rows: TestimonialRow[] }) {
  const up = rows.filter((r) => r.vote === 'up').length;
  const copy = (r: TestimonialRow) =>
    void navigator.clipboard
      ?.writeText(`“${r.text}”${r.sig ? ` — ${r.sig}` : ''}`)
      .then(() => toast(t('analytics.copied'), 'good'));
  return (
    <Card title={t('analytics.pulse.title')}>
      {rows.length ? (
        <>
          <p class="small">
            {t('analytics.pulse.summary', {
              up,
              down: rows.length - up,
              pct: Math.round((up / rows.length) * 100),
            })}
          </p>
          <ul class="plain-list pulse-list">
            {rows
              .filter((r) => r.text)
              .map((r) => (
                <li key={r.id} class="pulse-row">
                  <span aria-hidden="true">{r.vote === 'up' ? '👍' : '👎'}</span>
                  <div>
                    <p>{r.text}</p>
                    <p class="small muted">
                      {r.sig || t('analytics.pulse.anonymous')} · {r.day} · {r.lang.toUpperCase()} · {r.ed} ·{' '}
                      {t('analytics.pulse.age', { days: r.age })}
                    </p>
                  </div>
                  {r.publish ? (
                    <Button size="sm" variant="ghost" onClick={() => copy(r)}>
                      {t('analytics.pulse.copy')}
                    </Button>
                  ) : (
                    <Badge>{t('analytics.pulse.private')}</Badge>
                  )}
                </li>
              ))}
          </ul>
        </>
      ) : (
        <p class="muted small">{t('analytics.pulse.none')}</p>
      )}
    </Card>
  );
}

export function Analytics() {
  const [days, setDays] = useState<number>(30);
  const [lang, setLang] = useState<string>('');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [founders, setFounders] = useState<{ eligible: number; total: number } | null>(null);

  const load = () => {
    setLoading(true);
    void loadAnalytics(90)
      .then(setData)
      .catch(() => toast(t('analytics.loadError'), 'bad'))
      .finally(() => setLoading(false));
  };
  const admin = Boolean(authUser.value?.isAdmin);
  // Nothing is requested unless the signed-in account is an admin (rules refuse it anyway).
  useEffect(() => {
    if (admin) load();
  }, [admin]);
  useEffect(() => {
    if (!admin) return;
    founderCandidates()
      .then(setFounders)
      .catch(() => setFounders(null));
  }, [admin]);

  if (!admin) return <p class="page muted">{t('admin.forbidden')}</p>;

  const recompute = () => {
    setRecomputing(true);
    void recomputeAnalytics()
      .then((r) => {
        toast(t('analytics.recomputed', { days: r.days, cohorts: r.cohorts, purged: r.purged }), 'good');
        load();
      })
      .catch(() => toast(t('analytics.recomputeError'), 'bad'))
      .finally(() => setRecomputing(false));
  };

  const a = data ? analyze(data.daily, data.cohorts, days, clock.value, lang || undefined) : null;

  return (
    <div class="page analytics">
      <PageHeader
        title={t('analytics.title')}
        subtitle={t('analytics.subtitle')}
        actions={
          <Button icon="refresh" loading={recomputing} onClick={recompute}>
            {t('analytics.recompute')}
          </Button>
        }
      />
      <div class="toolbar">
        <div class="chips" role="group" aria-label={t('analytics.period')}>
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              class={`chip ${days === p ? 'chip-on' : ''}`}
              aria-pressed={days === p}
              onClick={() => setDays(p)}
            >
              {t('analytics.days', { count: p })}
            </button>
          ))}
        </div>
        <select
          aria-label={t('analytics.language')}
          value={lang}
          onChange={(e) => setLang((e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">{t('analytics.allLanguages')}</option>
          {LANGS.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {loading && !data && <p class="muted">{t('analytics.loading')}</p>}
      {a && a.empty && (
        <Card>
          <Empty icon="chart" title={t('analytics.emptyTitle')} body={t('analytics.emptyBody')} />
        </Card>
      )}

      {a && !a.empty && (
        <>
          <section class="card kpis" aria-label={t('analytics.kpis')}>
            <div class="stats">
              <Stat
                label={t('analytics.kpi.activation')}
                value={fmtPct(a.kpis.activation)}
                detail={fmtDelta(a.kpis.activationDelta) ?? t('analytics.kpi.activationHint')}
              />
              <Stat
                label={t('analytics.kpi.d7')}
                value={fmtPct(a.kpis.d7)}
                detail={t('analytics.kpi.d7Hint')}
              />
              <Stat
                label={t('analytics.kpi.acceptance')}
                value={fmtPct(a.kpis.acceptance)}
                detail={fmtDelta(a.kpis.acceptanceDelta) ?? t('analytics.kpi.acceptanceHint')}
              />
              <Stat label={t('analytics.kpi.pro')} value="—" detail={t('analytics.kpi.proHint')} />
            </div>
            {a.biggestLeak && (
              <p class="leak" role="note">
                {t('analytics.leak', {
                  from: t(`analytics.step.${FUNNEL[FUNNEL.indexOf(a.biggestLeak.step) - 1]}`),
                  to: t(`analytics.step.${a.biggestLeak.step}`),
                  loss: Math.round((100 - (a.biggestLeak.rate ?? 100)) * 10) / 10,
                })}
              </p>
            )}
          </section>

          <div class="analytics-grid">
            <Card title={t('analytics.funnel')}>
              <ol class="funnel-steps">
                {a.funnel.map((f) => {
                  const top = a.funnel[0]!.count || 1;
                  return (
                    <li key={f.step}>
                      <div class="funnel-label">
                        <span>{t(`analytics.step.${f.step}`)}</span>
                        <strong>{f.count}</strong>
                      </div>
                      <div class="funnel-bar" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, (f.count / top) * 100)}%` }} />
                      </div>
                      {f.rate !== null && <small class="muted">{t('analytics.kept', { pct: f.rate })}</small>}
                    </li>
                  );
                })}
              </ol>
              <p class="small muted">{t('analytics.optInNote')}</p>
            </Card>

            <Card title={t('analytics.landing')}>
              <div class="stats">
                <Stat label={t('analytics.landingViews')} value={a.landing.views} />
                <Stat label={t('analytics.landingDemo')} value={a.landing.demo} />
                <Stat label={t('analytics.landingMine')} value={a.landing.mine} />
                <Stat label={t('analytics.landingCtr')} value={fmtPct(a.landing.ctr)} />
              </div>
              <p class="small muted">{t('analytics.landingNote')}</p>
            </Card>
          </div>

          <Card title={t('analytics.retention')}>
            {a.retention.length ? (
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('analytics.cohort')}</th>
                      <th scope="col">{t('analytics.installs')}</th>
                      {RETENTION_AGES.map((d) => (
                        <th key={d} scope="col">
                          {t('analytics.dayN', { n: d })}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {a.retention.map((r) => (
                      <tr key={r.cohort}>
                        <th scope="row">{r.cohort}</th>
                        <td>{r.installs}</td>
                        {r.cells.map((c, i) => (
                          <td key={i}>{fmtPct(c)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p class="muted small">{t('analytics.retentionNone')}</p>
            )}
            <p class="small muted">{t('analytics.retentionNote')}</p>
          </Card>

          <Card title={t('analytics.sources')}>
            {a.sources.length ? (
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('analytics.source')}</th>
                      <th scope="col">{t('analytics.step.onboarding_started')}</th>
                      <th scope="col">{t('analytics.step.onboarding_complete')}</th>
                      <th scope="col">{t('analytics.step.first_plan')}</th>
                      <th scope="col">{t('analytics.step.first_decision')}</th>
                      <th scope="col">{t('analytics.kpi.activation')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.sources.map((s) => (
                      <tr key={s.src}>
                        <th scope="row">{t(`analytics.src.${s.src}`)}</th>
                        <td>{s.started}</td>
                        <td>{s.completed}</td>
                        <td>{s.firstPlan}</td>
                        <td>{s.firstDecision}</td>
                        <td>{fmtPct(s.activation)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p class="muted small">—</p>
            )}
          </Card>

          <div class="analytics-grid">
            <Card title={t('analytics.engine')}>
              <div class="stats">
                <Stat label={t('analytics.e.proposed')} value={a.engine.proposed} />
                <Stat label={t('analytics.e.startRate')} value={fmtPct(a.engine.startRate)} />
                <Stat label={t('analytics.e.completion')} value={fmtPct(a.engine.completionAfterStart)} />
                <Stat
                  label={t('analytics.e.wrongTime')}
                  value={fmtPct(a.engine.wrongTime)}
                  tone={(a.engine.wrongTime ?? 0) > 20 ? 'warn' : undefined}
                />
              </div>
              <p class="small">
                {t('analytics.e.more', {
                  deferral: fmtPct(a.engine.deferral),
                  rejection: fmtPct(a.engine.rejection),
                  avoided: a.engine.avoidedAvg ?? '—',
                })}
              </p>
              {a.engine.estimateBefore !== null && (
                <p class="small">
                  {t('analytics.e.estimates', {
                    before: a.engine.estimateBefore,
                    after: a.engine.estimateAfter ?? '—',
                  })}
                </p>
              )}
              <p class="small muted">{t('analytics.e.note', { count: a.engine.summaries })}</p>
            </Card>

            <Card title={t('analytics.personal')}>
              <p class="better">
                {t('analytics.p.better', {
                  early: fmtPct(a.personalization.acceptanceEarly),
                  late: fmtPct(a.personalization.acceptanceLate),
                })}
              </p>
              <div class="stats">
                <Stat label={t('analytics.p.with5')} value={fmtPct(a.personalization.with5)} />
                <Stat label={t('analytics.p.with20')} value={fmtPct(a.personalization.with20)} />
                <Stat label={t('analytics.p.rules')} value={a.personalization.rulesAvg ?? '—'} />
              </div>
            </Card>
          </div>

          <Card title={t('analytics.engagement')}>
            <div class="stats">
              <Stat label={t('analytics.g.opens')} value={a.engagement.opens} />
              <Stat label={t('analytics.g.perOpen')} value={a.engagement.perOpen ?? '—'} />
              <Stat
                label={t('analytics.g.coach')}
                value={a.engagement.coach}
                detail={t('analytics.g.applied', { count: a.engagement.coachApplied })}
              />
              <Stat label={t('analytics.g.replans')} value={a.engagement.replans} />
            </div>
            <p class="small">
              {t('analytics.g.ai')} <Bars entries={Object.entries(a.engagement.ai)} />
            </p>
            <p class="small">
              {t('analytics.g.pf')} <Bars entries={Object.entries(a.engagement.pf)} />
            </p>
          </Card>
        </>
      )}

      {a && (
        <Card title={t('analytics.pro.title')}>
          {config.openAccess && <p class="small notice">{t('analytics.pro.beta')}</p>}
          <div class="stats">
            <Stat label={t('analytics.pro.seen')} value={a.pro.seen} />
            <Stat label={t('analytics.pro.clicked')} value={a.pro.clicked} detail={fmtPct(a.pro.clickRate)} />
            <Stat label={t('analytics.pro.checkout')} value={a.pro.checkout} />
            <Stat label={t('analytics.pro.bought')} value="—" detail={t('analytics.pro.boughtHint')} />
          </div>
          {a.pro.byTrigger.length > 0 && (
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('analytics.pro.trigger')}</th>
                    <th scope="col">{t('analytics.pro.seen')}</th>
                    <th scope="col">{t('analytics.pro.clicked')}</th>
                    <th scope="col">{t('analytics.pro.checkout')}</th>
                  </tr>
                </thead>
                <tbody>
                  {a.pro.byTrigger.map((r) => (
                    <tr key={r.from}>
                      <th scope="row">{t(`analytics.from.${r.from}`)}</th>
                      <td>{r.seen}</td>
                      <td>{r.clicked}</td>
                      <td>{r.checkout}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3 class="sub-title">{t('analytics.pro.priceTitle', { price: config.payments.monthlyPrice })}</h3>
          {a.pro.answers ? (
            <ul class="plain-list">
              {a.pro.price.map((p) => (
                <li key={p.answer} class="ledger-row">
                  <span>{t(`price.${p.answer}`)}</span>
                  <strong>
                    {p.count} · {fmtPct(p.share)}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p class="small muted">{t('analytics.pro.priceNone')}</p>
          )}
          {founders && (
            <p class="small">
              {t('analytics.pro.founders', {
                eligible: founders.eligible,
                total: founders.total,
                seats: config.founder.seats,
                days: config.founder.minDays,
              })}
            </p>
          )}
        </Card>
      )}

      {data && <Pulse rows={data.testimonials} />}
    </div>
  );
}
