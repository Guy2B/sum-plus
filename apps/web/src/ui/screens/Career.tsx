import { useEffect, useState } from 'preact/hooks';
import type { ApplicationStage, JobApplication } from '../../domain/types';
import { create, snapshot, update, clock } from '../../data/store';
import { isoDay } from '../../domain/dates';
import { t, fmtDate } from '../../i18n';
import { Badge, Button, Card, Field, Modal, PageHeader, ProGate, attempt } from '../components';
import { route } from '../router';
import { deleteWithUndo } from './Tasks';

const STAGES: ApplicationStage[] = ['wishlist', 'applied', 'interview', 'offer', 'accepted', 'rejected'];

function AppEditor({ app, onClose }: { app: Partial<JobApplication> | null; onClose: () => void }) {
  const [f, setF] = useState<Partial<JobApplication>>({});
  useEffect(() => setF(app ?? {}), [app]);
  const v = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  const save = async (e: Event) => {
    e.preventDefault();
    if (!(f.company ?? '').trim() || !(f.role ?? '').trim()) return;
    const url = (f.url ?? '').trim();
    const fields = {
      company: (f.company ?? '').trim().slice(0, 120),
      role: (f.role ?? '').trim().slice(0, 160),
      stage: f.stage ?? 'wishlist',
      appliedAt: f.appliedAt ?? (f.stage && f.stage !== 'wishlist' ? isoDay() : null),
      nextAction: (f.nextAction ?? '').slice(0, 200),
      nextActionAt: f.nextActionAt ?? null,
      url: /^https?:\/\//i.test(url) ? url.slice(0, 500) : undefined,
      notes: (f.notes ?? '').slice(0, 5000),
    };
    await attempt(async () => {
      if (f.id) await update('applications', f.id, fields);
      else await create('applications', fields);
      onClose();
    }, t('common.saved'));
  };
  return (
    <Modal open={app !== null} onClose={onClose} title={f.id ? t('career.edit') : t('career.new')}>
      <form class="form" onSubmit={save}>
        <div class="row">
          <Field label={t('career.company')}>
            {(id) => (
              <input
                id={id}
                required
                maxLength={120}
                value={f.company ?? ''}
                onInput={(e) => setF({ ...f, company: v(e) })}
              />
            )}
          </Field>
          <Field label={t('career.role')}>
            {(id) => (
              <input
                id={id}
                required
                maxLength={160}
                value={f.role ?? ''}
                onInput={(e) => setF({ ...f, role: v(e) })}
              />
            )}
          </Field>
        </div>
        <div class="row">
          <Field label={t('career.stage')}>
            {(id) => (
              <select
                id={id}
                value={f.stage ?? 'wishlist'}
                onChange={(e) => setF({ ...f, stage: v(e) as ApplicationStage })}
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {t(`career.stageValue.${s}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('career.appliedAt')}>
            {(id) => (
              <input
                id={id}
                type="date"
                value={f.appliedAt ?? ''}
                onInput={(e) => setF({ ...f, appliedAt: v(e) || null })}
              />
            )}
          </Field>
        </div>
        <div class="row">
          <Field label={t('career.nextAction')}>
            {(id) => (
              <input
                id={id}
                maxLength={200}
                value={f.nextAction ?? ''}
                onInput={(e) => setF({ ...f, nextAction: v(e) })}
              />
            )}
          </Field>
          <Field label={t('career.nextActionAt')}>
            {(id) => (
              <input
                id={id}
                type="date"
                value={f.nextActionAt ?? ''}
                onInput={(e) => setF({ ...f, nextActionAt: v(e) || null })}
              />
            )}
          </Field>
        </div>
        <Field label={t('career.url')}>
          {(id) => (
            <input
              id={id}
              type="url"
              placeholder="https://"
              value={f.url ?? ''}
              onInput={(e) => setF({ ...f, url: v(e) })}
            />
          )}
        </Field>
        <Field label={t('career.notes')}>
          {(id) => (
            <textarea
              id={id}
              rows={3}
              maxLength={5000}
              value={f.notes ?? ''}
              onInput={(e) => setF({ ...f, notes: v(e) })}
            />
          )}
        </Field>
        <p class="small muted">{t('career.fairness')}</p>
        <div class="modal-actions">
          {f.id && (
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                void deleteWithUndo('applications', f.id!, f.company ?? '');
                onClose();
              }}
            >
              {t('common.delete')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CareerInner() {
  const [editing, setEditing] = useState<Partial<JobApplication> | null>(null);
  const today = isoDay(clock.value);
  const apps = snapshot.value.applications.filter((a) => !a.deletedAt);
  useEffect(() => {
    const found = apps.find((a) => a.id === route.value.param);
    if (found) setEditing(found);
  }, [route.value.param]);
  return (
    <>
      <div class="toolbar">
        <Button variant="primary" icon="plus" onClick={() => setEditing({ stage: 'wishlist' })}>
          {t('career.new')}
        </Button>
      </div>
      <div class="kanban">
        {STAGES.map((stage) => {
          const list = apps
            .filter((a) => a.stage === stage)
            .sort((a, b) => (a.nextActionAt ?? '9').localeCompare(b.nextActionAt ?? '9'));
          return (
            <Card
              key={stage}
              title={`${t(`career.stageValue.${stage}`)} (${list.length})`}
              class="kanban-col"
            >
              <ul class="plain-list">
                {list.map((a) => (
                  <li key={a.id} class="kanban-item">
                    <button type="button" class="link-title" onClick={() => setEditing(a)}>
                      {a.role}
                    </button>
                    <span class="muted small">{a.company}</span>
                    {a.nextAction && (
                      <span class="small">
                        → {a.nextAction}
                        {a.nextActionAt && (
                          <>
                            {' '}
                            <Badge
                              tone={
                                a.nextActionAt < today ? 'bad' : a.nextActionAt === today ? 'warn' : 'neutral'
                              }
                            >
                              {fmtDate(a.nextActionAt)}
                            </Badge>
                          </>
                        )}
                      </span>
                    )}
                    <select
                      aria-label={t('career.moveTo')}
                      value={a.stage}
                      onChange={(e) =>
                        void update('applications', a.id, {
                          stage: (e.currentTarget as HTMLSelectElement).value as ApplicationStage,
                        })
                      }
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>
                          {t(`career.stageValue.${s}`)}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      <AppEditor app={editing} onClose={() => setEditing(null)} />
    </>
  );
}

export function Career() {
  return (
    <div class="page">
      <PageHeader title={t('nav.career')} subtitle={t('career.subtitle')} />
      <ProGate feature="career">
        <CareerInner />
      </ProGate>
    </div>
  );
}
