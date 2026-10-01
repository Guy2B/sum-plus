/**
 * Everything about Σ Pro, in two commercial states driven by one flag:
 *  - beta (config.openAccess): Pro is offered to everyone, the founder offer is
 *    announced, nobody is ever blocked or asked to pay;
 *  - paid: Free limits show an upgrade path and the modal opens the hosted checkout.
 * The client never grants Pro: only the signed Lemon Squeezy webhook does.
 */
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { config, cloudConfigured } from '../config';
import { authUser, clock, entitlement, settings } from '../data/store';
import { isPro } from '../domain/entitlements';
import { checkoutConfigured, checkoutUrl, type Billing } from '../services/payments';
import { sendPriceAnswer, track, type PriceAnswer, type ProTrigger } from '../services/telemetry';
import { t } from '../i18n';
import { Button, Modal } from './components';
import { navigate } from './router';

const DAY = 86_400_000;
export const upgradeFrom = signal<ProTrigger | null>(null);

export const PRO_FEATURES = [
  'cloudSync',
  'calendarSync',
  'social',
  'unlimitedCoach',
  'unlimitedProjects',
  'finance',
  'health',
  'household',
  'driveBackup',
] as const;

export function openUpgrade(from: ProTrigger) {
  upgradeFrom.value = from;
  void track('pro_cta_clicked', { from });
}

/** Annual saving vs. twelve monthly payments, e.g. "35 %". */
export function annualSaving(monthly: string, annual: string): number | null {
  const n = (s: string) => Number(s.replace(/[^\d,.]/g, '').replace(',', '.'));
  const m = n(monthly);
  const a = n(annual);
  return m > 0 && a > 0 ? Math.round((1 - a / (m * 12)) * 100) : null;
}

function FounderOffer() {
  const f = config.founder;
  return (
    <p class="founder-offer">
      {t('founder.offer', {
        seats: f.seats,
        days: f.minDays,
        annual: f.annualPrice,
        normal: config.payments.annualPrice,
        monthly: f.monthlyPrice,
        years: f.years,
      })}
    </p>
  );
}

export function UpgradeModal() {
  const from = upgradeFrom.value;
  const user = authUser.value;
  const close = () => (upgradeFrom.value = null);
  const go = (billing: Billing) => {
    const url = checkoutUrl(billing);
    if (!url || !from) return;
    void track('checkout_started', { from });
    location.assign(url);
  };
  const saving = annualSaving(config.payments.monthlyPrice, config.payments.annualPrice);
  return (
    <Modal
      open={from !== null}
      onClose={close}
      title={config.openAccess ? t('pro.beta.title') : t('pro.modal.title')}
    >
      <ul class="plan-features">
        {PRO_FEATURES.map((f) => (
          <li key={f}>✓ {t(`pro.feature.${f}`)}</li>
        ))}
      </ul>
      {config.openAccess ? (
        <>
          <p>{t('pro.beta.body')}</p>
          <FounderOffer />
          {!user && cloudConfigured() && (
            <p class="small">
              {t('founder.needAccount')}{' '}
              <a
                href="#account"
                onClick={() => {
                  close();
                  navigate('account', 'cloud');
                }}
              >
                {t('founder.createAccount')}
              </a>
            </p>
          )}
          <div class="row-actions">
            <Button variant="primary" onClick={close}>
              {t('pro.beta.ok')}
            </Button>
          </div>
        </>
      ) : !checkoutConfigured() || !cloudConfigured() ? (
        <p class="muted small">{t('plan.notAvailable')}</p>
      ) : !user ? (
        <p class="notice small">{t('plan.signInFirst')}</p>
      ) : (
        <>
          <div class="price-choice">
            <button type="button" class="kind-card" onClick={() => go('annual')}>
              <strong>{t('pro.modal.annual', { price: config.payments.annualPrice })}</strong>
              {saving !== null && <small class="good-text">{t('pro.modal.saving', { pct: saving })}</small>}
            </button>
            <button type="button" class="kind-card" onClick={() => go('monthly')}>
              <strong>{t('pro.modal.monthly', { price: config.payments.monthlyPrice })}</strong>
              <small class="muted">{t('pro.modal.cancel')}</small>
            </button>
          </div>
          <p class="small muted">{t('plan.legal')}</p>
        </>
      )}
    </Modal>
  );
}

/** Bottom of the sidebar: what you have, and the way up. */
export function SidebarPro() {
  if (!config.openAccess && isPro(entitlement.value)) return null;
  return (
    <button type="button" class="sidebar-pro" onClick={() => openUpgrade('sidebar')}>
      <span aria-hidden="true">✦</span>
      <span>{config.openAccess ? t('pro.beta.sidebar') : t('pro.sidebar')}</span>
    </button>
  );
}

/** Shown where a Free limit is reached (only ever visible in paid mode). */
export function LimitNotice({ from, text }: { from: ProTrigger; text: string }) {
  useEffect(() => void track('pro_gate_seen', { from }), [from]);
  return (
    <div class="notice limit-notice">
      <span>{text}</span>
      <Button size="sm" variant="primary" onClick={() => openUpgrade(from)}>
        {t('pro.see')}
      </Button>
    </div>
  );
}

/** Account → Plan: the founder programme while the beta lasts. */
export function FounderCard() {
  if (!config.openAccess) return null;
  const user = authUser.value;
  const days = settings.value.usage.founderDays ?? 0;
  const goal = config.founder.minDays;
  return (
    <div class="founder-card">
      <strong>{t('founder.title')}</strong>
      <FounderOffer />
      {user ? (
        <p class="small">{days >= goal ? t('founder.eligible') : t('founder.progress', { days, goal })}</p>
      ) : cloudConfigured() ? (
        <p class="small">
          {t('founder.needAccount')} <a href="#account/cloud">{t('founder.createAccount')}</a>
        </p>
      ) : null}
    </div>
  );
}

/** Beta only: after 14 days, one anonymous question about the price. */
export function priceQuestionDue(usage: { installedAt?: string; priceAsked?: string }, now: Date): boolean {
  if (!config.openAccess || usage.priceAsked || !usage.installedAt) return false;
  return now.getTime() - new Date(`${usage.installedAt}T00:00:00`).getTime() >= 14 * DAY;
}

export function PriceQuestion() {
  const s = settings.value;
  if (!s.onboardingComplete || !priceQuestionDue(s.usage, clock.value)) return null;
  const answer = (a: PriceAnswer) => void sendPriceAnswer(a);
  return (
    <aside class="pulse-card" aria-labelledby="price-title">
      <p>
        <strong id="price-title">
          {t('price.question', {
            monthly: config.payments.monthlyPrice,
            annual: config.payments.annualPrice,
          })}
        </strong>
      </p>
      <div class="row-actions">
        {(['yes', 'maybe', 'expensive', 'useless'] as const).map((a) => (
          <Button key={a} size="sm" variant={a === 'yes' ? 'primary' : undefined} onClick={() => answer(a)}>
            {t(`price.${a}`)}
          </Button>
        ))}
      </div>
      <p class="small muted">{t('price.note')}</p>
    </aside>
  );
}
