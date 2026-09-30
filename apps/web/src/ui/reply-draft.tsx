/**
 * Reply draft for a mail decision: a short, editable template that already
 * proposes two real free slots from the agenda. Σ never sends anything — the
 * draft opens in the user's own mail app (or is copied), where they send it.
 */
import { useState } from 'preact/hooks';
import type { Decision } from '../domain/decision';
import { freeSlot } from '../domain/today';
import { t, fmtTime, fmtDate } from '../i18n';
import { Button, Modal, Field, toast } from './components';
import { acceptDecision } from '../data/actions';
import { clock, settings, snapshot } from '../data/store';
import { decisionTitle } from './decision-card';

function twoSlots() {
  const events = snapshot.value.events.filter((e) => !e.deletedAt);
  const ctx = settings.value.context;
  const first = freeSlot(events, ctx, clock.value, 30);
  if (!first) return [];
  const second = freeSlot(events, ctx, new Date(first.end.getTime() + 60 * 60_000), 30);
  return [first, second].filter((x): x is NonNullable<typeof x> => Boolean(x));
}

export function draftBody(d: Decision): string {
  const s = settings.value;
  const first = (d.signal.sender ?? '').split(/[\s<@]/)[0] ?? '';
  const slots = twoSlots()
    .map((x) => `${fmtDate(x.start)} ${fmtTime(x.start)}`)
    .join(t('reply.or'));
  const lines = [
    t('reply.hello', { name: first }).trim(),
    '',
    t('reply.thanks'),
    d.facts.intent === 'opportunity' || d.facts.intent === 'request'
      ? slots
        ? t('reply.slots', { slots })
        : t('reply.soon')
      : t('reply.soon'),
    '',
    t('reply.regards'),
    s.name,
  ];
  return lines.join('\n');
}

export function ReplyDraft({ d, onClose }: { d: Decision; onClose: () => void }) {
  const [body, setBody] = useState(() => draftBody(d));
  const subject = `Re: ${decisionTitle(d)}`;
  const to = d.signal.senderEmail ?? '';
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <Modal open onClose={onClose} title={t('reply.title', { name: d.signal.sender ?? to })}>
      <p class="small muted">{t('reply.notice')}</p>
      <Field label={t('reply.body')}>
        {(id) => (
          <textarea
            id={id}
            rows={9}
            value={body}
            onInput={(e) => setBody((e.currentTarget as HTMLTextAreaElement).value)}
          />
        )}
      </Field>
      <div class="modal-actions">
        <Button
          onClick={() =>
            void navigator.clipboard?.writeText(body).then(() => toast(t('reply.copied'), 'good'))
          }
        >
          {t('reply.copy')}
        </Button>
        {d.signal.url && (
          <a class="btn btn-secondary btn-md" href={d.signal.url} target="_blank" rel="noopener noreferrer">
            {t('reply.openThread')}
          </a>
        )}
        <a
          class="btn btn-primary btn-md"
          href={mailto}
          onClick={() => {
            void acceptDecision(d);
            onClose();
          }}
        >
          {t('reply.open')}
        </a>
      </div>
    </Modal>
  );
}
