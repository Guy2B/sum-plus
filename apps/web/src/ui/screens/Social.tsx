import { useState } from 'preact/hooks';
import type { SocialProvider } from '../../domain/types';
import { snapshot, update, clock } from '../../data/store';
import { toTask } from '../../data/actions';
import { t, fmtRelative } from '../../i18n';
import { Badge, Button, Card, Empty, PageHeader, ProGate, attempt } from '../components';
import { navigate } from '../router';

function SocialInner() {
  const [provider, setProvider] = useState<'all' | SocialProvider>('all');
  const accounts = snapshot.value.socialAccounts.filter((a) => !a.deletedAt);
  const items = snapshot.value.socialItems
    .filter((s) => !s.deletedAt && !s.resolved)
    .filter((s) => provider === 'all' || s.provider === provider)
    .sort(
      (a, b) => Number(b.needsReply) - Number(a.needsReply) || b.publishedAt.localeCompare(a.publishedAt),
    );
  if (!accounts.length) {
    return (
      <Card>
        <Empty
          icon="share"
          title={t('social.noAccount')}
          body={t('social.noAccountBody')}
          action={
            <Button variant="primary" icon="plug" onClick={() => navigate('sources')}>
              {t('social.connect')}
            </Button>
          }
        />
      </Card>
    );
  }
  return (
    <>
      <div class="toolbar">
        <select
          aria-label={t('social.provider')}
          value={provider}
          onChange={(e) => setProvider((e.currentTarget as HTMLSelectElement).value as typeof provider)}
        >
          <option value="all">{t('attention.allSources')}</option>
          {[...new Set(accounts.map((a) => a.provider))].map((p) => (
            <option key={p} value={p}>
              {t(`provider.${p}`)}
            </option>
          ))}
        </select>
        <span class="small muted">
          {accounts.map((a) => `${t(`provider.${a.provider}`)}: ${a.handle}`).join(' · ')}
        </span>
      </div>
      <Card>
        {items.length ? (
          <ul class="mail-list">
            {items.slice(0, 150).map((s) => (
              <li key={s.id} class="mail-row">
                <div class="mail-head">
                  <Badge>{t(`provider.${s.provider}`)}</Badge>
                  <strong>{s.author}</strong>
                  <span class="muted small">{t(`social.kind.${s.kind}`)}</span>
                  {s.needsReply && <Badge tone="bad">{t('mail.needsReply')}</Badge>}
                  <time class="muted small">{fmtRelative(s.publishedAt, clock.value)}</time>
                </div>
                <p class="prewrap">{s.text}</p>
                <div class="row-actions">
                  <Button
                    size="sm"
                    icon="check"
                    onClick={() => void attempt(() => toTask('socialItems', s.id), t('mail.taskCreated'))}
                  >
                    {t('mail.toTask')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void update('socialItems', s.id, { resolved: true })}
                  >
                    {t('mail.resolve')}
                  </Button>
                  {s.url && (
                    <a class="btn btn-ghost btn-sm" href={s.url} target="_blank" rel="noopener noreferrer">
                      {t('social.reply')}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon="check" title={t('social.empty')} />
        )}
      </Card>
      <p class="small muted">{t('social.honesty')}</p>
    </>
  );
}

export function Social() {
  return (
    <div class="page">
      <PageHeader title={t('nav.social')} subtitle={t('social.subtitle')} />
      <ProGate feature="social">
        <SocialInner />
      </ProGate>
    </div>
  );
}
