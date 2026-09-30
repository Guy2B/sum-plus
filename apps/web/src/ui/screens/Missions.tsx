import { useEffect, useState } from 'preact/hooks';
import type { Mission, MissionKind, MissionLogEntry, MissionTopic, PipelineItem } from '../../domain/types';
import {
  MISSION_KINDS,
  MODEL,
  STEPS,
  planMission,
  withLoggedSession,
  type PlannedSession,
} from '../../domain/missions';
import { newId } from '../../domain/ids';
import { addDays, isoDay, toDate } from '../../domain/dates';
import { clock, create, snapshot, update } from '../../data/store';
import { t, fmtDate, fmtMinutes } from '../../i18n';
import { Button, Empty, Field, Modal, PageHeader, Progress, attempt } from '../components';
import { route } from '../router';
import { deleteWithUndo } from './Tasks';

const ICON: Record<MissionKind, string> = {
  exam: '📘',
  interview: '💼',
  book: '📖',
  fitness: '🏃',
  language: '🗣️',
  presentation: '🎤',
  jobsearch: '🧭',
};
const NEEDS_DATE: MissionKind[] = ['exam', 'interview', 'presentation'];
const MINUTES = [15, 20, 30, 45, 60, 90];

export function sessionLabel(m: Mission, s: PlannedSession): string {
  const params: Record<string, string | number> = { mission: m.title, minutes: s.minutes };
  if (s.topic) params.topic = s.topic;
  if (s.fromPage) params.from = s.fromPage;
  if (s.toPage) params.to = s.toPage;
  if (s.company) params.company = s.company;
  return s.step ? t(`mission.step.${m.kind}.${s.step}`, params) : t(`mission.session.${s.kind}`, params);
}

/* --------------------------------- editor --------------------------------- */

type Draft = Partial<Mission> & { kind?: MissionKind; topicsText?: string };

function topicsFromText(text: string, previous: MissionTopic[]): MissionTopic[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map(
      (title, i) =>
        previous.find((p) => p.title === title) ?? { id: `tp${i}-${title.slice(0, 40)}`, title, mastery: 2 },
    );
}

function MissionEditor({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  const [form, setForm] = useState<Draft>(draft ?? {});
  useEffect(
    () => setForm(draft ? { ...draft, topicsText: (draft.topics ?? []).map((x) => x.title).join('\n') } : {}),
    [draft],
  );
  const set = (patch: Draft) => setForm((f) => ({ ...f, ...patch }));
  const kind = form.kind;
  const model = kind ? MODEL[kind] : null;
  const topics = topicsFromText(form.topicsText ?? '', form.topics ?? []);
  const v = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  const members = snapshot.value.household.filter((h) => !h.deletedAt).map((h) => h.name);

  const save = async (e: Event) => {
    e.preventDefault();
    if (!kind || !(form.title ?? '').trim()) return;
    const fields = {
      kind,
      title: (form.title ?? '').trim().slice(0, 200),
      targetDate: form.targetDate || null,
      minutesPerDay: form.minutesPerDay ?? 30,
      daysPerWeek: form.daysPerWeek ?? (kind === 'fitness' ? 3 : 5),
      topics: model === 'topics' ? topics : [],
      totalPages: kind === 'book' ? Number(form.totalPages) || 1 : null,
      startPage: kind === 'book' ? Number(form.startPage) || 0 : null,
      level: kind === 'fitness' ? (form.level ?? 'beginner') : null,
      forName: kind === 'exam' ? form.forName || null : null,
      ...(kind === 'jobsearch' && !form.id ? { pipeline: [] } : {}),
    };
    await attempt(
      async () => {
        if (form.id) await update('missions', form.id, fields);
        else await create('missions', { ...fields, status: 'active', log: [] });
        onClose();
      },
      form.id ? t('common.saved') : t('mission.created'),
    );
  };

  return (
    <Modal
      open={draft !== null}
      onClose={onClose}
      title={form.id ? t('mission.edit') : t('mission.new')}
      wide
    >
      {!kind ? (
        <div class="kind-grid" role="list">
          {MISSION_KINDS.map((k) => (
            <button key={k} type="button" role="listitem" class="kind-card" onClick={() => set({ kind: k })}>
              <span class="kind-icon" aria-hidden="true">
                {ICON[k]}
              </span>
              <strong>{t(`mission.kind.${k}`)}</strong>
              <small class="muted">{t(`mission.kindHint.${k}`)}</small>
            </button>
          ))}
        </div>
      ) : (
        <form class="form" onSubmit={save}>
          <Field label={t('mission.field.title')}>
            {(id) => (
              <input
                id={id}
                required
                maxLength={200}
                value={form.title ?? ''}
                placeholder={t(`mission.placeholder.${kind}`)}
                onInput={(e) => set({ title: v(e) })}
              />
            )}
          </Field>
          <div class="row">
            <Field
              label={NEEDS_DATE.includes(kind) ? t('mission.field.date') : t('mission.field.dateOptional')}
            >
              {(id) => (
                <input
                  id={id}
                  type="date"
                  required={NEEDS_DATE.includes(kind)}
                  min={isoDay(clock.value)}
                  value={form.targetDate ?? ''}
                  onInput={(e) => set({ targetDate: v(e) })}
                />
              )}
            </Field>
            <Field label={t('mission.field.minutes')}>
              {(id) => (
                <select
                  id={id}
                  value={form.minutesPerDay ?? 30}
                  onChange={(e) => set({ minutesPerDay: Number(v(e)) })}
                >
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>
                      {fmtMinutes(m)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {model !== 'steps' && (
              <Field label={kind === 'jobsearch' ? t('mission.field.appsPerWeek') : t('mission.field.days')}>
                {(id) => (
                  <select
                    id={id}
                    value={form.daysPerWeek ?? (kind === 'fitness' ? 3 : 5)}
                    onChange={(e) => set({ daysPerWeek: Number(v(e)) })}
                  >
                    {(kind === 'jobsearch' ? [1, 2, 3, 5, 7, 10] : [1, 2, 3, 4, 5, 6, 7]).map((d) => (
                      <option key={d} value={d}>
                        {t('mission.perWeek', { count: d })}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </div>

          {kind === 'exam' && members.length > 0 && (
            <Field label={t('mission.field.forWho')}>
              {(id) => (
                <select id={id} value={form.forName ?? ''} onChange={(e) => set({ forName: v(e) || null })}>
                  <option value="">{t('mission.forMe')}</option>
                  {members.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          {model === 'topics' && (
            <>
              <Field label={t('mission.field.topics')} hint={t('mission.field.topicsHint')}>
                {(id) => (
                  <textarea
                    id={id}
                    rows={4}
                    value={form.topicsText ?? ''}
                    placeholder={t(`mission.topicsPlaceholder.${kind}`)}
                    onInput={(e) => set({ topicsText: v(e) })}
                  />
                )}
              </Field>
              {topics.length > 0 && (
                <div class="mastery-list">
                  <p class="small muted">{t('mission.field.mastery')}</p>
                  {topics.map((tp) => (
                    <div key={tp.id} class="mastery-row">
                      <span>{tp.title}</span>
                      <div
                        class="segmented"
                        role="radiogroup"
                        aria-label={t('mission.masteryOf', { topic: tp.title })}
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={tp.mastery === n}
                            class={tp.mastery === n ? 'active' : ''}
                            onClick={() =>
                              set({ topics: topics.map((x) => (x.id === tp.id ? { ...x, mastery: n } : x)) })
                            }
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {kind === 'book' && (
            <div class="row">
              <Field label={t('mission.field.pages')}>
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min={1}
                    required
                    value={form.totalPages ?? ''}
                    onInput={(e) => set({ totalPages: Number(v(e)) })}
                  />
                )}
              </Field>
              <Field label={t('mission.field.startPage')}>
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min={0}
                    value={form.startPage ?? 0}
                    onInput={(e) => set({ startPage: Number(v(e)) })}
                  />
                )}
              </Field>
            </div>
          )}

          {kind === 'fitness' && (
            <Field label={t('mission.field.level')}>
              {(id) => (
                <select
                  id={id}
                  value={form.level ?? 'beginner'}
                  onChange={(e) => set({ level: v(e) as Mission['level'] })}
                >
                  {(['beginner', 'intermediate', 'advanced'] as const).map((l) => (
                    <option key={l} value={l}>
                      {t(`mission.level.${l}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          <div class="modal-actions">
            {!form.id && <Button onClick={() => set({ kind: undefined })}>{t('common.back')}</Button>}
            <Button type="submit" variant="primary">
              {form.id ? t('common.save') : t('mission.create')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ------------------------------- session log ------------------------------ */

function LogSession({
  mission,
  session,
  onClose,
}: {
  mission: Mission | null;
  session: PlannedSession | null;
  onClose: () => void;
}) {
  const [minutes, setMinutes] = useState(30);
  const [rating, setRating] = useState<NonNullable<MissionLogEntry['rating']>>('good');
  const [page, setPage] = useState<number | ''>('');
  useEffect(() => {
    setMinutes(session?.minutes ?? 30);
    setRating('good');
    setPage(session?.toPage ?? '');
  }, [session, mission]);
  if (!mission) return null;
  const save = async (e: Event) => {
    e.preventDefault();
    const entry: MissionLogEntry = {
      date: isoDay(clock.value),
      minutes: Math.max(1, Math.min(600, minutes)),
      topicId: session?.topicId ?? null,
      step:
        session?.step ??
        (session?.kind === 'apply' ? 'apply' : session?.itemId ? `${session.kind}:${session.itemId}` : null),
      rating,
      page: mission.kind === 'book' && page !== '' ? Number(page) : null,
    };
    await attempt(async () => {
      await update('missions', mission.id, withLoggedSession(mission, entry));
      onClose();
    }, t('mission.logged'));
  };
  return (
    <Modal open onClose={onClose} title={session ? sessionLabel(mission, session) : t('mission.logFree')}>
      <form class="form" onSubmit={save}>
        <div class="row">
          <Field label={t('mission.field.minutesDone')}>
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                max={600}
                value={minutes}
                onInput={(e) => setMinutes(Number((e.currentTarget as HTMLInputElement).value))}
              />
            )}
          </Field>
          {mission.kind === 'book' && (
            <Field label={t('mission.field.pageReached')}>
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={0}
                  max={mission.totalPages ?? undefined}
                  value={page}
                  onInput={(e) => setPage(Number((e.currentTarget as HTMLInputElement).value))}
                />
              )}
            </Field>
          )}
        </div>
        <p class="small muted">{t('mission.field.rating')}</p>
        <div class="segmented" role="radiogroup" aria-label={t('mission.field.rating')}>
          {(['easy', 'good', 'hard'] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={rating === r}
              class={rating === r ? 'active' : ''}
              onClick={() => setRating(r)}
            >
              {t(`mission.rating.${r}`)}
            </button>
          ))}
        </div>
        <div class="modal-actions">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" icon="check">
            {t('mission.saveSession')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------- pipeline -------------------------------- */

const STAGES: PipelineItem['stage'][] = ['wishlist', 'applied', 'interview', 'offer', 'accepted', 'rejected'];

function Pipeline({ m, onPrepare }: { m: Mission; onPrepare: (item: PipelineItem) => void }) {
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const items = m.pipeline ?? [];
  const save = (pipeline: PipelineItem[]) => void update('missions', m.id, { pipeline });
  const today = isoDay(clock.value);
  return (
    <div class="pipeline">
      {items.length ? (
        <ul class="plain-list">
          {items.map((it) => (
            <li key={it.id} class="ledger-row">
              <span>
                <strong>{it.company}</strong> <span class="muted">· {it.role}</span>
                {it.appliedAt && <small class="muted"> · {fmtDate(it.appliedAt)}</small>}
              </span>
              <select
                aria-label={t('career.stage')}
                value={it.stage}
                onChange={(e) => {
                  const stage = (e.currentTarget as HTMLSelectElement).value as PipelineItem['stage'];
                  save(
                    items.map((x) =>
                      x.id === it.id
                        ? { ...x, stage, appliedAt: x.appliedAt ?? (stage === 'wishlist' ? null : today) }
                        : x,
                    ),
                  );
                }}
              >
                {STAGES.map((st) => (
                  <option key={st} value={st}>
                    {t(`career.stageValue.${st}`)}
                  </option>
                ))}
              </select>
              {it.stage === 'interview' && (
                <Button size="sm" variant="ghost" onClick={() => onPrepare(it)}>
                  {t('mission.pipeline.prepare')}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon="x"
                onClick={() => save(items.filter((x) => x.id !== it.id))}
              >
                <span class="sr-only">{t('common.delete')}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="small muted">{t('mission.pipeline.empty')}</p>
      )}
      <form
        class="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!company.trim()) return;
          save([
            ...items,
            {
              id: newId('app'),
              company: company.trim().slice(0, 120),
              role: role.trim().slice(0, 120),
              stage: 'applied',
              appliedAt: today,
            },
          ]);
          setCompany('');
          setRole('');
        }}
      >
        <input
          aria-label={t('mission.pipeline.company')}
          placeholder={t('mission.pipeline.company')}
          value={company}
          maxLength={120}
          onInput={(e) => setCompany((e.currentTarget as HTMLInputElement).value)}
        />
        <input
          aria-label={t('mission.pipeline.role')}
          placeholder={t('mission.pipeline.role')}
          value={role}
          maxLength={120}
          onInput={(e) => setRole((e.currentTarget as HTMLInputElement).value)}
        />
        <Button type="submit" size="sm" icon="plus">
          {t('mission.pipeline.add')}
        </Button>
      </form>
    </div>
  );
}

/* ---------------------------------- card ---------------------------------- */

function MissionCard({
  m,
  onLog,
  onEdit,
  onDraft,
}: {
  m: Mission;
  onLog: (m: Mission, s: PlannedSession | null) => void;
  onEdit: (m: Mission) => void;
  onDraft: (d: Draft) => void;
}) {
  const [open, setOpen] = useState(false);
  const now = clock.value;
  const plan = planMission(m, now);
  const f = plan.forecast;
  const target = toDate(m.targetDate);
  const upcoming = plan.sessions.filter((s) => s.date !== plan.today?.date).slice(0, 6);
  const steps = MODEL[m.kind] === 'steps' ? STEPS[m.kind as 'interview' | 'presentation'] : null;
  const done = new Set((m.log ?? []).map((l) => l.step));
  return (
    <article class="card mission" aria-labelledby={`m-${m.id}`}>
      <header class="mission-head">
        <span class="kind-icon" aria-hidden="true">
          {ICON[m.kind]}
        </span>
        <div class="mission-title">
          <h2 id={`m-${m.id}`}>{m.title}</h2>
          <p class="small muted">
            {t(`mission.kind.${m.kind}`)}
            {m.forName && ` · ${m.forName}`}
            {target && ` · ${fmtDate(target)}`}
            {plan.daysLeft !== null &&
              plan.daysLeft > 0 &&
              ` · ${t('mission.daysLeft', { count: plan.daysLeft })}`}
          </p>
        </div>
        <span class={`mission-status ${f.onTrack ? 'ok' : 'late'}`}>
          {f.onTrack ? t('mission.onTrack') : t('mission.offTrack')}
        </span>
      </header>

      <p class="mission-headline">{t(f.headline.key, f.headline.params)}</p>
      <Progress value={f.readiness ?? f.progress} label={t(f.headline.key, f.headline.params)} />
      <ul class="mission-reasons">
        {f.reasons.slice(0, 3).map((r) => (
          <li key={r.key}>{t(r.key, r.params)}</li>
        ))}
        {f.projectedFinish && MODEL[m.kind] === 'pace' && (
          <li>{t('mission.finishOn', { date: fmtDate(f.projectedFinish) })}</li>
        )}
      </ul>

      <div class="mission-today">
        {plan.today ? (
          <>
            <span>
              <strong>{t('mission.today')}</strong> · {sessionLabel(m, plan.today)} ·{' '}
              {fmtMinutes(plan.today.minutes)}
            </span>
            <Button size="sm" variant="primary" icon="check" onClick={() => onLog(m, plan.today)}>
              {t('mission.done')}
            </Button>
          </>
        ) : (
          <>
            <span class="muted">{t('mission.noSessionToday')}</span>
            <Button size="sm" variant="ghost" icon="plus" onClick={() => onLog(m, null)}>
              {t('mission.logFree')}
            </Button>
          </>
        )}
      </div>

      {m.kind === 'jobsearch' && (
        <Pipeline
          m={m}
          onPrepare={(it) =>
            onDraft({ kind: 'interview', title: it.role ? `${it.company} — ${it.role}` : it.company })
          }
        />
      )}

      {steps && (
        <ul class="check-list mission-steps">
          {steps.map(([step, offset, minutes]) => (
            <li key={step}>
              <label>
                <input
                  type="checkbox"
                  checked={done.has(step)}
                  onChange={() =>
                    void update('missions', m.id, {
                      log: done.has(step)
                        ? (m.log ?? []).filter((l) => l.step !== step)
                        : [...(m.log ?? []), { date: isoDay(now), minutes, step, rating: 'good' }],
                    })
                  }
                />
                <span>{t(`mission.step.${m.kind}.${step}`, { mission: m.title })}</span>
                <small class="muted">
                  {target ? fmtDate(addDays(target, offset)) : ''} · {fmtMinutes(minutes)}
                </small>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div class="mission-actions">
        {!steps && upcoming.length > 0 && (
          <button type="button" class="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t('mission.hidePlan') : t('mission.showPlan', { count: upcoming.length })}
          </button>
        )}
        <span class="spacer" />
        <Button size="sm" variant="ghost" icon="edit" onClick={() => onEdit(m)}>
          {t('common.edit')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void attempt(() => update('missions', m.id, { status: 'done' }), t('mission.completed'))
          }
        >
          {t('mission.finish')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="trash"
          onClick={() => void deleteWithUndo('missions', m.id, m.title)}
        >
          <span class="sr-only">{t('common.delete')}</span>
        </Button>
      </div>

      {open && !steps && (
        <ol class="mission-plan">
          {upcoming.map((s) => (
            <li key={`${s.date}-${s.kind}-${s.topicId ?? ''}`}>
              <time>{fmtDate(s.date)}</time>
              <span>{sessionLabel(m, s)}</span>
              <small class="muted">{fmtMinutes(s.minutes)}</small>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

/* --------------------------------- screen --------------------------------- */

export function Missions() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [logging, setLogging] = useState<{ m: Mission; s: PlannedSession | null } | null>(null);
  const all = snapshot.value.missions.filter((m) => !m.deletedAt);
  const active = all.filter((m) => m.status === 'active');
  const finished = all.filter((m) => m.status !== 'active');

  // #missions/<id> (e.g. from a decision) scrolls to that mission.
  useEffect(() => {
    const id = route.value.param;
    if (id?.startsWith('new:')) {
      const [, kind, who] = id.split(':');
      setDraft({ kind: kind as MissionKind, forName: who || null });
      return;
    }
    if (id) setTimeout(() => document.getElementById(`m-${id}`)?.scrollIntoView({ block: 'center' }), 50);
  }, [route.value.param]);

  return (
    <div class="page page-narrow">
      <PageHeader
        title={t('nav.missions')}
        subtitle={t('mission.subtitle')}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setDraft({})}>
            {t('mission.new')}
          </Button>
        }
      />
      {active.length ? (
        active.map((m) => (
          <MissionCard
            key={m.id}
            m={m}
            onLog={(mm, s) => setLogging({ m: mm, s })}
            onEdit={(mm) => setDraft(mm)}
            onDraft={setDraft}
          />
        ))
      ) : (
        <div class="card">
          <Empty icon="flame" title={t('mission.emptyTitle')} body={t('mission.emptyBody')} />
          <div class="kind-grid">
            {MISSION_KINDS.map((k) => (
              <button key={k} type="button" class="kind-card" onClick={() => setDraft({ kind: k })}>
                <span class="kind-icon" aria-hidden="true">
                  {ICON[k]}
                </span>
                <strong>{t(`mission.kind.${k}`)}</strong>
                <small class="muted">{t(`mission.kindHint.${k}`)}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {finished.length > 0 && (
        <details class="section">
          <summary class="muted">{t('mission.finished', { count: finished.length })}</summary>
          <ul class="plain-list">
            {finished.map((m) => (
              <li key={m.id} class="ledger-row">
                <span>
                  {ICON[m.kind]} {m.title}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void update('missions', m.id, { status: 'active' })}
                >
                  {t('mission.reopen')}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <MissionEditor draft={draft} onClose={() => setDraft(null)} />
      <LogSession
        mission={logging?.m ?? null}
        session={logging?.s ?? null}
        onClose={() => setLogging(null)}
      />
    </div>
  );
}
