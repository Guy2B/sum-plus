import { useState } from 'preact/hooks';
import type { LearningResource, ResourceType, Skill } from '../../domain/types';
import { create, snapshot, update, clock, settings } from '../../data/store';
import { scheduleReview, resourceProgress } from '../../domain/learning';
import { isoDay } from '../../domain/dates';
import { newId } from '../../domain/ids';
import { getEdition } from '../../domain/editions';
import { t, fmtDate } from '../../i18n';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  IconButton,
  PageHeader,
  Progress,
  attempt,
  toast,
} from '../components';
import { deleteWithUndo } from './Tasks';

const TYPES: ResourceType[] = ['book', 'course', 'video', 'podcast', 'article'];

function SkillCard({ s }: { s: Skill }) {
  const now = clock.value;
  const due = s.nextReviewAt && s.nextReviewAt <= isoDay(now);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ResourceType>('book');
  const [url, setUrl] = useState('');
  const setResources = (resources: LearningResource[]) => void update('skills', s.id, { resources });
  const review = (outcome: 'easy' | 'good' | 'hard') =>
    void attempt(async () => {
      const next = scheduleReview(s, outcome, new Date());
      await update('skills', s.id, next);
      toast(t('learning.nextReview', { date: fmtDate(next.nextReviewAt ?? '') }), 'good');
    });
  return (
    <Card
      title={s.name}
      actions={
        <>
          {due && <Badge tone="warn">{t('learning.reviewDue')}</Badge>}
          <IconButton
            icon="trash"
            label={t('common.delete')}
            onClick={() => void deleteWithUndo('skills', s.id, s.name)}
          />
        </>
      }
    >
      {s.target && <p class="muted small">{t('learning.target', { target: s.target })}</p>}
      <Progress value={s.progress} label={s.name} />
      <p class="small muted">
        {t('learning.progress', { value: s.progress })}
        {s.resources.length > 0 && ` · ${t('learning.resourcesDone', { value: resourceProgress(s) })}`}
        {s.nextReviewAt && ` · ${t('learning.nextOn', { date: fmtDate(s.nextReviewAt) })}`}
      </p>
      <div class="row-actions" role="group" aria-label={t('learning.review')}>
        <span class="small">{t('learning.review')}</span>
        <Button size="sm" onClick={() => review('hard')}>
          {t('learning.hard')}
        </Button>
        <Button size="sm" onClick={() => review('good')}>
          {t('learning.good')}
        </Button>
        <Button size="sm" onClick={() => review('easy')}>
          {t('learning.easy')}
        </Button>
      </div>
      <ul class="check-list">
        {s.resources.map((r) => (
          <li key={r.id}>
            <select
              aria-label={t('learning.status')}
              value={r.status}
              onChange={(e) =>
                setResources(
                  s.resources.map((x) =>
                    x.id === r.id
                      ? {
                          ...x,
                          status: (e.currentTarget as HTMLSelectElement).value as LearningResource['status'],
                        }
                      : x,
                  ),
                )
              }
            >
              {(['todo', 'doing', 'done'] as const).map((st) => (
                <option key={st} value={st}>
                  {t(`learning.statusValue.${st}`)}
                </option>
              ))}
            </select>
            <span>
              {r.url ? (
                <a href={r.url} target="_blank" rel="noopener noreferrer">
                  {r.title}
                </a>
              ) : (
                r.title
              )}{' '}
              <small class="muted">· {t(`learning.type.${r.type}`)}</small>
            </span>
            <IconButton
              icon="x"
              label={t('common.delete')}
              onClick={() => setResources(s.resources.filter((x) => x.id !== r.id))}
            />
          </li>
        ))}
      </ul>
      <form
        class="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          const safeUrl = /^https?:\/\//i.test(url.trim()) ? url.trim().slice(0, 500) : undefined;
          setResources([
            ...s.resources,
            { id: newId(), title: title.trim().slice(0, 200), type, url: safeUrl, status: 'todo' },
          ]);
          setTitle('');
          setUrl('');
        }}
      >
        <input
          aria-label={t('learning.resourceTitle')}
          placeholder={t('learning.resourceTitle')}
          value={title}
          maxLength={200}
          onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)}
        />
        <select
          aria-label={t('learning.resourceType')}
          value={type}
          onChange={(e) => setType((e.currentTarget as HTMLSelectElement).value as ResourceType)}
        >
          {TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`learning.type.${x}`)}
            </option>
          ))}
        </select>
        <input
          type="url"
          aria-label={t('learning.url')}
          placeholder="https://"
          value={url}
          onInput={(e) => setUrl((e.currentTarget as HTMLInputElement).value)}
        />
        <Button type="submit" size="sm" icon="plus">
          {t('common.add')}
        </Button>
      </form>
    </Card>
  );
}

export function Learning() {
  const ed = getEdition(settings.value.edition, settings.value.locale);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const skills = snapshot.value.skills
    .filter((s) => !s.deletedAt)
    .sort((a, b) => (a.nextReviewAt ?? '9').localeCompare(b.nextReviewAt ?? '9'));
  return (
    <div class="page">
      <PageHeader title={ed.nav.learning} subtitle={t('learning.subtitle')} />
      <Card title={t('learning.new')}>
        <form
          class="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void attempt(async () => {
              await create('skills', {
                name: name.trim().slice(0, 120),
                target: target.trim().slice(0, 200),
                progress: 0,
                reviewIntervalDays: 1,
                nextReviewAt: isoDay(),
                resources: [],
              });
              setName('');
              setTarget('');
            }, t('common.saved'));
          }}
        >
          <div class="row">
            <Field label={t('learning.name')}>
              {(id) => (
                <input
                  id={id}
                  required
                  maxLength={120}
                  value={name}
                  onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
                />
              )}
            </Field>
            <Field label={t('learning.targetLabel')}>
              {(id) => (
                <input
                  id={id}
                  maxLength={200}
                  value={target}
                  onInput={(e) => setTarget((e.currentTarget as HTMLInputElement).value)}
                />
              )}
            </Field>
          </div>
          <Button type="submit" variant="primary" icon="plus">
            {t('common.add')}
          </Button>
        </form>
      </Card>
      {skills.length ? (
        <div class="grid grid-2">
          {skills.map((s) => (
            <SkillCard key={s.id} s={s} />
          ))}
        </div>
      ) : (
        <Card>
          <Empty icon="graduation" title={t('learning.empty')} />
        </Card>
      )}
    </div>
  );
}
