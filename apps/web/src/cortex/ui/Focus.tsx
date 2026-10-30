/** Full-screen focus on the current block: countdown, done, +15 min. */
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../ui/icons';
import { toast } from '../../ui/components';
import { ct, type CortexKey } from '../i18n';
import { hhmm, minutesOfDay, nextBlock } from '../model';
import { editDay, getDay, setBlockDone } from '../data';
import { focusBlock } from './state';

export function Focus() {
  const f = focusBlock.value;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!f) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (focusBlock.value = null);
    window.addEventListener('keydown', onKey);
    try {
      void (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } }).wakeLock
        ?.request('screen')
        .catch(() => undefined);
    } catch {
      /* optional */
    }
    return () => {
      clearInterval(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [f?.id]);
  if (!f) return null;
  const day = getDay(f.date);
  const b = day.blocks.find((x) => x.id === f.id);
  if (!b) return null;
  const nm = minutesOfDay(now);
  const total = Math.max(1, b.end - b.start);
  const left = Math.max(0, b.end - nm);
  const sec = Math.round(left * 60);
  const r = 46;
  const c = 2 * Math.PI * r;
  const next = nextBlock(day, nm);
  if (left <= 0 && !b.done) {
    // Time is up: leave focus once and congratulate.
    queueMicrotask(() => {
      if (focusBlock.value?.id === b.id) {
        focusBlock.value = null;
        toast(ct('focus.timeUp'), 'good');
      }
    });
  }
  return (
    <div class="cx-focus" role="dialog" aria-modal="true" aria-label={ct('focus.title')}>
      <p class="cx-focus-label">
        {ct('focus.title')} · {ct(`cat.${b.category}` as CortexKey)}
      </p>
      <h2>{b.title || ct('block.untitled')}</h2>
      <div class="cx-focus-ring">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="bg" cx="50" cy="50" r={r} />
          <circle
            class="fg"
            cx="50"
            cy="50"
            r={r}
            stroke-dasharray={c}
            stroke-dashoffset={c * (1 - left / total)}
          />
        </svg>
        <div class="cx-focus-in">
          <b class="num" role="timer" aria-live="off">
            {String(Math.floor(sec / 60)).padStart(2, '0')}:{String(sec % 60).padStart(2, '0')}
          </b>
          <span>{ct('focus.until', { time: hhmm(b.end) })}</span>
        </div>
      </div>
      {b.note && <p class="cx-focus-note">{b.note}</p>}
      <div class="cx-focus-actions">
        <button
          type="button"
          class="btn btn-primary btn-md"
          onClick={async () => {
            const end = Math.round(minutesOfDay(new Date()));
            if (end > b.start && end < b.end)
              await editDay(f.date, (d) => {
                const x = d.blocks.find((y) => y.id === b.id);
                if (x) x.end = end;
              });
            await setBlockDone(f.date, b.id, true);
            focusBlock.value = null;
            toast(ct('focus.done'), 'good');
          }}
        >
          <Icon name="check" size={16} />
          <span>{ct('block.done')}</span>
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-md"
          onClick={() =>
            void editDay(f.date, (d) => {
              const x = d.blocks.find((y) => y.id === b.id);
              if (x) x.end = Math.min(24 * 60, x.end + 15);
            })
          }
        >
          {ct('focus.plus15')}
        </button>
        <button type="button" class="btn btn-ghost btn-md" onClick={() => (focusBlock.value = null)}>
          {ct('focus.leave')}
        </button>
      </div>
      {next && (
        <p class="cx-focus-next">
          {ct('now.then', { title: next.title || ct('block.untitled'), time: hhmm(next.start) })}
        </p>
      )}
    </div>
  );
}
