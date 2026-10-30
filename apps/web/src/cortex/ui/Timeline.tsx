/**
 * Day timeline. Mouse: drag on the grid to create, drag a block to move it,
 * pull its bottom edge to resize. Touch: tap a slot to create, use the grip to
 * move. Everything snaps to 15 minutes. Calendar events are shown read-only.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ISODate, TimeBlock } from '../../domain/types';
import { clock, snapshot } from '../../data/store';
import { Icon } from '../../ui/icons';
import { ct, fmtDuration, type CortexKey } from '../i18n';
import {
  SNAP,
  currentBlock,
  eventBlocks,
  floorTo,
  hhmm,
  lanes,
  minutesOfDay,
  snapTo,
  viewRange,
} from '../model';
import { dayWindow, editDay, getDay, liveTasks, setBlockDone, today } from '../data';
import { catVar, planTask } from './parts';
import { sheet } from './state';
import { sigmaBlocks } from './sigma';
import { toast } from '../../ui/components';

const PX_PER_MIN = 64 / 60;

type Drag =
  | { kind: 'create'; anchor: number; s: number; e: number; moved: boolean; x: number; y: number }
  | { kind: 'move'; b: TimeBlock; dy: number; s: number; moved: boolean; x: number; y: number }
  | { kind: 'resize'; b: TimeBlock; e: number; moved: boolean; x: number; y: number }
  | { kind: 'tap'; b: TimeBlock | null; m: number; x: number; y: number };

export function Timeline({ date }: { date: ISODate }) {
  const d = getDay(date);
  const events = eventBlocks(snapshot.value.events, date);
  const [s0, e0] = viewRange([...d.blocks, ...events], dayWindow.value);
  const height = (e0 - s0) * PX_PER_MIN;
  const grid = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [ghost, setGhost] = useState<{ s: number; e: number } | null>(null);
  const tk = today.value;
  const nm = minutesOfDay(clock.value);
  const hover = typeof matchMedia !== 'undefined' && matchMedia('(hover: hover)').matches;

  // Scroll to "now" (or the first block) when the day changes.
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollHeight <= el.clientHeight) return;
    const first = d.blocks.length ? Math.min(...d.blocks.map((b) => b.start)) : s0 + 60;
    const target = date === tk ? nm - 60 : first - 30;
    el.scrollTop = Math.max(0, (target - s0) * PX_PER_MIN);
  }, [date]);

  const minAt = (clientY: number) => {
    const r = grid.current!.getBoundingClientRect();
    return s0 + (clientY - r.top) / PX_PER_MIN;
  };
  const clamp = (m: number) => Math.max(s0, Math.min(e0, m));

  const onDown = (ev: PointerEvent) => {
    if (ev.button > 0) return;
    const target = ev.target as HTMLElement;
    if (target.closest('.cx-bk-check') || target.closest('.cx-tl-empty')) return;
    const el = target.closest<HTMLElement>('.cx-bk');
    const touch = ev.pointerType !== 'mouse';
    const base = { x: ev.clientX, y: ev.clientY };
    if (el) {
      const b = d.blocks.find((x) => x.id === el.dataset.id);
      if (!b) return;
      if (target.closest('.cx-bk-resize')) setDrag({ kind: 'resize', b, e: b.end, moved: false, ...base });
      else if (target.closest('.cx-bk-grip') || !touch)
        setDrag({ kind: 'move', b, dy: 0, s: b.start, moved: false, ...base });
      else {
        setDrag({ kind: 'tap', b, m: 0, ...base });
        return;
      }
      ev.preventDefault();
      grid.current?.setPointerCapture?.(ev.pointerId);
      return;
    }
    if (target.closest('.cx-ev')) return;
    const m = minAt(ev.clientY);
    if (touch) {
      setDrag({ kind: 'tap', b: null, m, ...base });
      return;
    }
    const a = floorTo(m);
    setDrag({ kind: 'create', anchor: a, s: a, e: a + 60, moved: false, ...base });
    ev.preventDefault();
    grid.current?.setPointerCapture?.(ev.pointerId);
  };

  const onMove = (ev: PointerEvent) => {
    if (!drag || drag.kind === 'tap') return;
    const dist = Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y);
    if (!drag.moved && dist < 5) return;
    if (drag.kind === 'create') {
      const m = clamp(snapTo(minAt(ev.clientY)));
      const s = Math.min(drag.anchor, m);
      const e = Math.max(s + SNAP, Math.max(drag.anchor + SNAP, m));
      setDrag({ ...drag, s, e, moved: true });
      setGhost({ s, e });
    } else if (drag.kind === 'move') {
      const len = drag.b.end - drag.b.start;
      const s = Math.max(s0, Math.min(e0 - len, snapTo(drag.b.start + (ev.clientY - drag.y) / PX_PER_MIN)));
      setDrag({ ...drag, s, moved: true });
    } else if (drag.kind === 'resize') {
      const e = Math.max(
        drag.b.start + SNAP,
        Math.min(e0, snapTo(drag.b.end + (ev.clientY - drag.y) / PX_PER_MIN)),
      );
      setDrag({ ...drag, e, moved: true });
    }
  };

  const onUp = (ev: PointerEvent) => {
    const g = drag;
    setDrag(null);
    setGhost(null);
    if (!g) return;
    const near = Math.hypot(ev.clientX - g.x, ev.clientY - g.y) < 8;
    const open = (block: TimeBlock | null, start: number, end: number) =>
      (sheet.value = { kind: 'block', date, block, start, end });
    if (g.kind === 'tap') {
      if (!near) return;
      if (g.b) open(g.b, g.b.start, g.b.end);
      else {
        const s = floorTo(g.m);
        open(null, s, Math.min(24 * 60, s + 60));
      }
      return;
    }
    if (g.kind === 'create') {
      if (!g.moved) open(null, g.anchor, Math.min(24 * 60, g.anchor + 60));
      else open(null, g.s, g.e);
      return;
    }
    if (g.kind === 'move') {
      if (!g.moved) {
        open(g.b, g.b.start, g.b.end);
        return;
      }
      if (g.s !== g.b.start) {
        const len = g.b.end - g.b.start;
        void editDay(date, (x) => {
          const b = x.blocks.find((y) => y.id === g.b.id);
          if (b) {
            b.start = g.s;
            b.end = g.s + len;
          }
        });
      }
      return;
    }
    if (g.kind === 'resize' && g.moved && g.e !== g.b.end) {
      void editDay(date, (x) => {
        const b = x.blocks.find((y) => y.id === g.b.id);
        if (b) b.end = g.e;
      });
    }
  };

  // Tasks dragged from "To plan" (desktop).
  const onDragOver = (ev: DragEvent) => {
    ev.preventDefault();
    const s = Math.max(s0, Math.min(e0 - SNAP, floorTo(minAt(ev.clientY))));
    setGhost({ s, e: Math.min(e0, s + 30) });
  };
  const onDrop = (ev: DragEvent) => {
    ev.preventDefault();
    setGhost(null);
    const v = ev.dataTransfer?.getData('text/plain') ?? '';
    if (!v.startsWith('task:')) return;
    const t = liveTasks.value.find((x) => x.id === v.slice(5));
    if (!t) return;
    void planTask(t, date, Math.max(s0, Math.min(e0 - SNAP, floorTo(minAt(ev.clientY)))));
  };

  const shown = d.blocks.map((b) => {
    if (drag?.kind === 'move' && drag.b.id === b.id && drag.moved)
      return { ...b, start: drag.s, end: drag.s + (b.end - b.start), dragging: true };
    if (drag?.kind === 'resize' && drag.b.id === b.id && drag.moved)
      return { ...b, end: drag.e, dragging: true };
    return { ...b, dragging: false };
  });
  const L = lanes([...shown, ...events.map((e) => ({ ...e, id: `ev-${e.id}` }))]);
  const cur = date === tk ? currentBlock(d, nm) : null;

  const lines = [];
  for (let m = s0; m <= e0; m += 30) {
    const y = (m - s0) * PX_PER_MIN;
    lines.push(
      m % 60 ? (
        <div key={m} class="cx-hr half" style={{ top: `${y}px` }} />
      ) : (
        <div key={m} class="cx-hr" style={{ top: `${y}px` }}>
          <span class="num">{hhmm(m)}</span>
        </div>
      ),
    );
  }
  const pastH = date < tk ? height : date === tk ? Math.max(0, Math.min(height, (nm - s0) * PX_PER_MIN)) : 0;

  return (
    <div class="cx-tl-scroll" ref={scroller}>
      <div
        class="cx-tl"
        ref={grid}
        style={{ height: `${height}px` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          setDrag(null);
          setGhost(null);
        }}
        onDragOver={onDragOver}
        onDragLeave={() => setGhost(null)}
        onDrop={onDrop}
      >
        {lines}
        {pastH > 0 && <div class="cx-past" style={{ height: `${pastH}px` }} />}
        {date === tk && nm >= s0 && nm <= e0 && (
          <div class="cx-nowline" style={{ top: `${(nm - s0) * PX_PER_MIN}px` }}>
            <span class="num">{hhmm(nm)}</span>
          </div>
        )}
        {events.map((e) => {
          const l = L[`ev-${e.id}`] ?? { i: 0, n: 1 };
          return (
            <div
              key={e.id}
              class="cx-ev"
              style={{
                top: `${(e.start - s0) * PX_PER_MIN + 1}px`,
                height: `${Math.max(18, (e.end - e.start) * PX_PER_MIN - 2)}px`,
                left: `calc(${(l.i / l.n) * 100}% + 2px)`,
                width: `calc(${100 / l.n}% - 4px)`,
              }}
              title={ct('plan.eventHint')}
            >
              <span class="cx-bk-title">
                <Icon name="calendar" size={12} /> {e.title}
              </span>
              <span class="cx-bk-meta num">
                {hhmm(e.start)}–{hhmm(e.end)}
              </span>
            </div>
          );
        })}
        {shown.map((b) => {
          const l = L[b.id] ?? { i: 0, n: 1 };
          const h = Math.max(18, (b.end - b.start) * PX_PER_MIN - 2);
          const small = h < 44;
          return (
            <div
              key={b.id}
              data-id={b.id}
              class={`cx-bk ${b.done ? 'done' : ''} ${small ? 'sm' : ''} ${b.dragging ? 'drag' : ''} ${cur?.id === b.id ? 'cur' : ''}`}
              style={{
                '--c': catVar(b.category),
                top: `${(b.start - s0) * PX_PER_MIN + 1}px`,
                height: `${h}px`,
                left: `calc(${(l.i / l.n) * 100}% + 2px)`,
                width: `calc(${100 / l.n}% - 4px)`,
              }}
              role="button"
              tabIndex={0}
              aria-label={ct('block.a11y', {
                title: b.title || ct('block.untitled'),
                start: hhmm(b.start),
                end: hhmm(b.end),
              })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  sheet.value = { kind: 'block', date, block: b, start: b.start, end: b.end };
                }
              }}
            >
              <span class="cx-bk-title">{b.title || ct('block.untitled')}</span>
              <span class="cx-bk-meta num">
                {hhmm(b.start)}–{hhmm(b.end)}
                {small ? '' : ` · ${fmtDuration(b.end - b.start)} · ${ct(`cat.${b.category}` as CortexKey)}`}
              </span>
              <button
                type="button"
                class="cx-bk-check"
                aria-pressed={b.done}
                aria-label={ct(b.done ? 'block.reopen' : 'block.done')}
                onClick={(e) => {
                  e.stopPropagation();
                  void setBlockDone(date, b.id, !b.done);
                }}
              >
                <svg viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M3 7.5 6 10.5 11 4" />
                </svg>
              </button>
              <span class="cx-bk-grip" aria-hidden="true">
                <Icon name="grip" size={16} />
              </span>
              <span class="cx-bk-resize" aria-hidden="true" />
            </div>
          );
        })}
        {ghost && (
          <div
            class="cx-ghost num"
            style={{
              top: `${(ghost.s - s0) * PX_PER_MIN}px`,
              height: `${Math.max(14, (ghost.e - ghost.s) * PX_PER_MIN)}px`,
            }}
          >
            {hhmm(ghost.s)}–{hhmm(ghost.e)} · {fmtDuration(ghost.e - ghost.s)}
          </div>
        )}
        {!d.blocks.length && (
          <div
            class="cx-tl-empty"
            style={{
              top: `${Math.max(8, ((date === tk ? Math.min(e0 - 180, Math.max(s0, nm)) : s0 + 60) - s0) * PX_PER_MIN)}px`,
            }}
          >
            <p>{ct(hover ? 'plan.emptyMouse' : 'plan.emptyTouch')}</p>
            <EmptyActions date={date} />
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyActions({ date }: { date: ISODate }) {
  return (
    <div class="cx-row">
      {date === today.value && (
        <button type="button" class="btn btn-primary btn-sm" onClick={() => void sigmaPlan(date)}>
          <Icon name="sigma" size={16} />
          <span>{ct('sigma.planDay')}</span>
        </button>
      )}
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        onClick={() => (sheet.value = { kind: 'dayOptions', date })}
      >
        {ct('plan.routineOrCopy')}
      </button>
    </div>
  );
}

/** Lays Σ's plan for today into the free time, around existing blocks. */
export async function sigmaPlan(date: ISODate): Promise<number> {
  const add = sigmaBlocks(getDay(date).blocks, date);
  if (add.length) await editDay(date, (x) => x.blocks.push(...add));
  toast(
    add.length ? ct('sigma.planned', { count: add.length }) : ct('sigma.nothingToPlan'),
    add.length ? 'good' : 'info',
  );
  return add.length;
}
