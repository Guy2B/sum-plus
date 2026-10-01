/**
 * Weekly pulse: after 7 and 30 days of use, one question — did Σ help this
 * week? An optional sentence, and a separate, explicit consent to publish it.
 * Nothing is sent unless the person presses Send.
 */
import { useState } from 'preact/hooks';
import { cloudConfigured } from '../config';
import { clock, settings, updateSettings } from '../data/store';
import { sendTestimonial } from '../services/telemetry';
import { t } from '../i18n';
import { Button, toast } from './components';

const DAY = 86_400_000;

/** Which pulse is due ('d7' after a week, 'd30' after a month), if any. */
export function duePulse(
  usage: { installedAt?: string; pulseAsked?: string[] },
  now: Date,
): 'd7' | 'd30' | null {
  if (!usage.installedAt) return null;
  const age = Math.floor((now.getTime() - new Date(`${usage.installedAt}T00:00:00`).getTime()) / DAY);
  const asked = usage.pulseAsked ?? [];
  if (age >= 30 && !asked.includes('d30')) return 'd30';
  if (age >= 7 && !asked.includes('d7')) return 'd7';
  return null;
}

export function PulseCard() {
  const s = settings.value;
  const due = duePulse(s.usage, clock.value);
  const [vote, setVote] = useState<'up' | 'down' | null>(null);
  const [text, setText] = useState('');
  const [sig, setSig] = useState('');
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!due || !cloudConfigured() || !s.onboardingComplete) return null;

  // Both pulses are marked so a person who answers at day 30 is not asked twice.
  const close = () =>
    updateSettings((cur) => ({
      ...cur,
      usage: {
        ...cur.usage,
        pulseAsked: [...new Set([...(cur.usage.pulseAsked ?? []), 'd7', ...(due === 'd30' ? ['d30'] : [])])],
      },
    }));

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!vote) return;
    setBusy(true);
    try {
      await sendTestimonial({ vote, text, sig, publish });
      await close();
      toast(t('pulse.thanks'), 'good');
    } catch {
      toast(t('pulse.error'), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside class="pulse-card" aria-labelledby="pulse-title">
      <p>
        <strong id="pulse-title">{t(due === 'd30' ? 'pulse.titleMonth' : 'pulse.title')}</strong>
      </p>
      {!vote ? (
        <div class="row-actions">
          <Button size="sm" onClick={() => setVote('up')}>
            👍 {t('pulse.yes')}
          </Button>
          <Button size="sm" onClick={() => setVote('down')}>
            👎 {t('pulse.no')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void close()}>
            {t('pulse.skip')}
          </Button>
        </div>
      ) : (
        <form class="pulse-form" onSubmit={(e) => void submit(e)}>
          <label class="field">
            <span class="field-label">{t(vote === 'up' ? 'pulse.upQuestion' : 'pulse.downQuestion')}</span>
            <textarea
              rows={2}
              maxLength={500}
              value={text}
              placeholder={t(vote === 'up' ? 'pulse.upPlaceholder' : 'pulse.downPlaceholder')}
              onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
            />
          </label>
          {vote === 'up' && (
            <>
              <label class="field">
                <span class="field-label">{t('pulse.sig')}</span>
                <input
                  maxLength={60}
                  value={sig}
                  placeholder={t('pulse.sigPlaceholder')}
                  onInput={(e) => setSig((e.currentTarget as HTMLInputElement).value)}
                />
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  checked={publish}
                  disabled={!text.trim()}
                  onChange={(e) => setPublish((e.currentTarget as HTMLInputElement).checked)}
                />
                <span>{t('pulse.publish')}</span>
              </label>
            </>
          )}
          <p class="small muted">
            {t('pulse.privacy')}{' '}
            <a href="legal/privacy.html#feedback" target="_blank" rel="noopener">
              {t('telemetry.details')}
            </a>
          </p>
          <div class="row-actions">
            <Button type="submit" size="sm" variant="primary" loading={busy}>
              {t('pulse.send')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void close()}>
              {t('pulse.skip')}
            </Button>
          </div>
        </form>
      )}
    </aside>
  );
}
