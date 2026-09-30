import { useState } from 'preact/hooks';
import { visibleAttention } from '../../data/actions';
import type { AttentionGroup } from '../../domain/planning';
import type { Decision } from '../../domain/decision';
import { t } from '../../i18n';
import { Card, Empty, PageHeader, Tabs } from '../components';
import { DecisionCard } from '../decision-card';

type Filter = 'all' | AttentionGroup;
const GROUPS: AttentionGroup[] = ['reply', 'opportunity', 'admin', 'execution', 'capacity'];

export function Attention() {
  const [filter, setFilter] = useState<Filter>('all');
  const [source, setSource] = useState('all');
  const groups = visibleAttention.value;
  const all: Decision[] = GROUPS.flatMap((g) => groups[g]).sort((a, b) => b.score - a.score);
  const sources = [...new Set(all.map((d) => d.signal.sourceType))];
  const list = (filter === 'all' ? all : groups[filter]).filter(
    (d) => source === 'all' || d.signal.sourceType === source,
  );

  return (
    <div class="page">
      <PageHeader title={t('nav.attention')} subtitle={t('attention.subtitle')} />
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
    </div>
  );
}
