import { useState } from 'preact/hooks';
import type { HouseholdMember, SchoolItem } from '../../domain/types';
import { create, snapshot, update, clock } from '../../data/store';
import { isoDay } from '../../domain/dates';
import { t, fmtDate } from '../../i18n';
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  IconButton,
  PageHeader,
  ProGate,
  attempt,
  toast,
} from '../components';
import { planMission } from '../../domain/missions';
import { deleteWithUndo } from './Tasks';

const KINDS: SchoolItem['kind'][] = ['homework', 'exam', 'form', 'meeting', 'activity'];

function MemberCard({ m }: { m: HouseholdMember }) {
  const today = isoDay(clock.value);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<SchoolItem['kind']>('homework');
  const [due, setDue] = useState(today);
  const exams = snapshot.value.missions.filter(
    (x) => !x.deletedAt && x.status === 'active' && x.forName === m.name,
  );
  const items = snapshot.value.schoolItems
    .filter((s) => !s.deletedAt && s.memberId === m.id)
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));
  return (
    <Card
      title={m.name}
      actions={
        <>
          <Badge>{t(`household.relation.${m.relation}`)}</Badge>
          <IconButton
            icon="trash"
            label={t('common.delete')}
            onClick={() => void deleteWithUndo('household', m.id, m.name)}
          />
        </>
      }
    >
      {m.school && <p class="muted small">{m.school}</p>}
      {exams.length > 0 && (
        <ul class="plain-list">
          {exams.map((x) => (
            <li key={x.id} class="ledger-row">
              <a href={`#missions/${x.id}`}>📘 {x.title}</a>
              <span class="small muted">
                {x.targetDate && `${fmtDate(x.targetDate)} · `}
                {t(
                  planMission(x, clock.value).forecast.headline.key,
                  planMission(x, clock.value).forecast.headline.params,
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ul class="check-list">
        {items.map((s) => (
          <li key={s.id}>
            <label>
              <input
                type="checkbox"
                checked={s.done}
                onChange={() => void update('schoolItems', s.id, { done: !s.done })}
              />
              <span class={s.done ? 'strike' : ''}>{s.title}</span>
            </label>
            <span class="small muted">
              {t(`household.kind.${s.kind}`)}
              {s.dueDate && ` · ${fmtDate(s.dueDate)}`}
            </span>
            {!s.done && s.dueDate && s.dueDate < today && <Badge tone="bad">{t('household.late')}</Badge>}
            <IconButton
              icon="x"
              label={t('common.delete')}
              onClick={() => void deleteWithUndo('schoolItems', s.id, s.title)}
            />
          </li>
        ))}
      </ul>
      <form
        class="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          if (kind === 'exam') {
            // A test to prepare is a mission: Σ plans the revisions for the child.
            void create('missions', {
              kind: 'exam',
              title: title.trim().slice(0, 200),
              forName: m.name,
              targetDate: due || null,
              status: 'active',
              minutesPerDay: 20,
              daysPerWeek: 5,
              topics: [{ id: 't1', title: title.trim().slice(0, 200), mastery: 2 }],
              log: [],
            }).then(() => {
              setTitle('');
              toast(t('household.examToMission', { name: m.name }), 'good');
            });
            return;
          }
          void create('schoolItems', {
            memberId: m.id,
            title: title.trim().slice(0, 200),
            kind,
            dueDate: due || null,
            done: false,
          }).then(() => setTitle(''));
        }}
      >
        <input
          aria-label={t('household.itemTitle')}
          placeholder={t('household.itemTitle')}
          maxLength={200}
          value={title}
          onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)}
        />
        <select
          aria-label={t('household.itemKind')}
          value={kind}
          onChange={(e) => setKind((e.currentTarget as HTMLSelectElement).value as SchoolItem['kind'])}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`household.kind.${k}`)}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label={t('household.due')}
          value={due}
          onInput={(e) => setDue((e.currentTarget as HTMLInputElement).value)}
        />
        <Button type="submit" size="sm" icon="plus">
          {t('common.add')}
        </Button>
      </form>
    </Card>
  );
}

function HouseholdInner() {
  const [name, setName] = useState('');
  const [relation, setRelation] = useState<HouseholdMember['relation']>('child');
  const [school, setSchool] = useState('');
  const members = snapshot.value.household.filter((m) => !m.deletedAt);
  return (
    <>
      <p class="notice small">{t('household.minorsNotice')}</p>
      <Card title={t('household.addMember')}>
        <form
          class="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void attempt(async () => {
              await create('household', {
                name: name.trim().slice(0, 40),
                relation,
                school: school.trim().slice(0, 120) || undefined,
              });
              setName('');
              setSchool('');
            }, t('common.saved'));
          }}
        >
          <div class="row">
            <Field label={t('household.firstName')} hint={t('household.firstNameHint')}>
              {(id) => (
                <input
                  id={id}
                  required
                  maxLength={40}
                  value={name}
                  onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
                />
              )}
            </Field>
            <Field label={t('household.relationLabel')}>
              {(id) => (
                <select
                  id={id}
                  value={relation}
                  onChange={(e) =>
                    setRelation((e.currentTarget as HTMLSelectElement).value as HouseholdMember['relation'])
                  }
                >
                  {(['child', 'partner', 'parent', 'other'] as const).map((r) => (
                    <option key={r} value={r}>
                      {t(`household.relation.${r}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('household.school')}>
              {(id) => (
                <input
                  id={id}
                  maxLength={120}
                  value={school}
                  onInput={(e) => setSchool((e.currentTarget as HTMLInputElement).value)}
                />
              )}
            </Field>
          </div>
          <Button type="submit" variant="primary" icon="plus">
            {t('common.add')}
          </Button>
        </form>
      </Card>
      {members.length ? (
        <div class="grid grid-2">
          {members.map((m) => (
            <MemberCard key={m.id} m={m} />
          ))}
        </div>
      ) : (
        <Card>
          <Empty icon="home" title={t('household.empty')} />
        </Card>
      )}
    </>
  );
}

export function Household() {
  return (
    <div class="page">
      <PageHeader title={t('nav.household')} subtitle={t('household.subtitle')} />
      <ProGate feature="household">
        <HouseholdInner />
      </ProGate>
    </div>
  );
}
