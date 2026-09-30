import { useState } from 'preact/hooks';
import { visibleAttention, visibleDecisions } from '../../data/actions';
import { clock, snapshot } from '../../data/store';
import type { AttentionGroup } from '../../domain/planning';
import type { Decision } from '../../domain/decision';
import { detectRisks, type Risk } from '../../domain/risks';
import { t } from '../../i18n';
import { Card, Empty, PageHeader, Tabs } from '../components';
import { DecisionCard, decisionTitle, openRecord } from '../decision-card';
import { StagnationPanel } from '../stagnation';

type Filter = 'all' | AttentionGroup;
const GROUPS: AttentionGroup[] = ['reply', 'opportunity', 'admin', 'execution', 'capacity'];

function RiskRow({ r }: { r: Risk }) {
  const title = r.decision && !r.title ? decisionTitle(r.decision) : r.title;
  const open = () => openRecord(r.ref.collection, r.ref.id);
  return (
    <li class={`risk risk-${r.level}`}>
      <span class="risk-dot" aria-hidden="true" />
      <div class="risk-body">
        <span class="sr-only">{t(`risk.level.${r.level}`)} · </span>
        <strong>{title}</strong>
        <span class="small muted">
          {t(`risk.kind.${r.kind}`)} · {t(r.detail.key, r.detail.params)}
        </span>
      </div>
      {r.kind === 'stalled' ? (
        <a class="btn btn-ghost btn-sm" href="#stagnation-title">
          {t('stagnant.unblock')}
        </a>
      ) : (
        <button type="button" class="btn btn-ghost btn-sm" onClick={open}>
          {t('risk.open')}
        </button>
      )}
    </li>
  );
}

export function Attention() {
  const [filter, setFilter] = useState<Filter>('all');
  const [source, setSource] = useState('all');
  const groups = visibleAttention.value;
  const all: Decision[] = GROUPS.flatMap((g) => groups[g]).sort((a, b) => b.score - a.score);
  const sources = [...new Set(all.map((d) => d.signal.sourceType))];
  const list = (filter === 'all' ? all : groups[filter]).filter(
    (d) => source === 'all' || d.signal.sourceType === source,
  );
  const risks = detectRisks(visibleDecisions.value, snapshot.value, clock.value);

  return (
    <div class="page">
      <PageHeader title={t('nav.attention')} subtitle={t('risk.subtitle')} />

      <section class="card risks" aria-labelledby="risks-title">
        <h2 id="risks-title">{t('risk.title')}</h2>
        {risks.length ? (
          <ul class="plain-list">
            {risks.map((r) => (
              <RiskRow key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <p class="muted">{t('risk.none')}</p>
        )}
      </section>

      <StagnationPanel />

      <details class="attention-rest">
        <summary>{t('risk.rest', { count: all.length })}</summary>
        <div class="toolbar">
          <Tabs
            label={t('attention.filter')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all' as Filter, label: t('attention.all'), count: all.length },
              ...GROUPS.map((g) => ({
                value: g as Filter,
                label: t(`attention.group.${g}`),
                count: groups[g].length,
              })),
            ]}
          />
          {sources.length > 1 && (
            <select
              aria-label={t('attention.source')}
              value={source}
              onChange={(e) => setSource((e.currentTarget as HTMLSelectElement).value)}
            >
              <option value="all">{t('attention.allSources')}</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {t(`source.${s}`)}
                </option>
              ))}
            </select>
          )}
        </div>
        <Card>
          {list.length ? (
            <div class="decision-list">
              {list.map((d) => (
                <DecisionCard key={d.signal.id} d={d} compact />
              ))}
            </div>
          ) : (
            <Empty icon="check" title={t('attention.emptyTitle')} body={t('attention.emptyBody')} />
          )}
        </Card>
      </details>
    </div>
  );
}
