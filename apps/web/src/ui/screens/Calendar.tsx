import { useEffect, useState } from 'preact/hooks';
import type { CalendarEvent } from '../../domain/types';
import { create, snapshot, update, clock, settings, entitlement } from '../../data/store';
import { addDays, isoDay, startOfDay, atTime } from '../../domain/dates';
import { eventsOn, findConflicts } from '../../domain/planning';
import { parseIcs, toIcs } from '../../domain/ics';
import { getEdition } from '../../domain/editions';
import { can } from '../../domain/entitlements';
import { ingestEvents } from '../../services/connectors/ingest';
import { googleAvailable, syncGoogleCalendar } from '../../services/connectors/google';
import { microsoftAvailable, syncOutlookCalendar } from '../../services/connectors/microsoft';
import { t, fmtDate, fmtTime, fmtLongDate, locale } from '../../i18n';
import { Badge, Button, Field, Modal, PageHeader, attempt, toast } from '../components';
import { Icon } from '../icons';
import { route, navigate } from '../router';
import { deleteWithUndo } from './Tasks';

function EventEditor({ ev, onClose }: { ev: Partial<CalendarEvent> | null; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState('');
  useEffect(() => {
    if (!ev) return;
    const s = ev.start ? new Date(ev.start) : atTime(new Date(), '09:00');
    const e = ev.end ? new Date(ev.end) : new Date(s.getTime() + 3_600_000);
    setTitle(ev.title ?? '');
    setDate(isoDay(s));
    setStart(fmtHM(s));
    setEnd(fmtHM(e));
    setAllDay(Boolean(ev.allDay));
    setLocation(ev.location ?? '');
  }, [ev]);
  const readOnly = Boolean(ev?.source && !['local', 'ics', 'demo'].includes(ev.source.provider));
  const save = async (e: Event) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    const day = new Date(`${date}T00:00:00`);
    const s = allDay ? day : atTime(day, start);
    let en = allDay ? addDays(day, 1) : atTime(day, end);
    if (en <= s) en = new Date(s.getTime() + 30 * 60_000);
    const fields = {
      title: title.trim().slice(0, 300),
      start: s.toISOString(),
      end: en.toISOString(),
      allDay,
      location: location.slice(0, 300) || undefined,
    };
    await attempt(async () => {
      if (ev?.id) await update('events', ev.id, fields);
      else await create('events', { ...fields, source: { provider: 'local' } });
      onClose();
    }, t('common.saved'));
  };
  const v = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  return (
    <Modal open={ev !== null} onClose={onClose} title={ev?.id ? t('calendar.edit') : t('calendar.new')}>
      <form class="form" onSubmit={save}>
        {readOnly && (
          <p class="notice small">{t('calendar.readOnly', { provider: ev?.source?.provider ?? '' })}</p>
        )}
        <Field label={t('calendar.title')}>
          {(id) => (
            <input
              id={id}
              required
              disabled={readOnly}
              maxLength={300}
              value={title}
              onInput={(e) => setTitle(v(e))}
            />
          )}
        </Field>
        <div class="row">
          <Field label={t('calendar.date')}>
            {(id) => (
              <input
                id={id}
                type="date"
                required
                disabled={readOnly}
                value={date}
                onInput={(e) => setDate(v(e))}
              />
            )}
          </Field>
          {!allDay && (
            <Field label={t('calendar.start')}>
              {(id) => (
                <input
                  id={id}
                  type="time"
                  disabled={readOnly}
                  value={start}
                  onInput={(e) => setStart(v(e))}
                />
              )}
            </Field>
          )}
          {!allDay && (
            <Field label={t('calendar.end')}>
              {(id) => (
                <input id={id} type="time" disabled={readOnly} value={end} onInput={(e) => setEnd(v(e))} />
              )}
            </Field>
          )}
        </div>
        <label class="check-inline">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={allDay}
            onChange={(e) => setAllDay((e.currentTarget as HTMLInputElement).checked)}
          />{' '}
          {t('calendar.allDay')}
        </label>
        <Field label={t('calendar.location')}>
          {(id) => (
            <input
              id={id}
              disabled={readOnly}
              maxLength={300}
              value={location}
              onInput={(e) => setLocation(v(e))}
            />
          )}
        </Field>
        {location && (
          <a
            class="link small"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('calendar.openMap')}
          </a>
        )}
        <div class="modal-actions">
          {ev?.id && !readOnly && (
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                void deleteWithUndo('events', ev.id!, title);
                onClose();
              }}
            >
              {t('common.delete')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.close')}</Button>
          {!readOnly && (
            <Button type="submit" variant="primary">
              {t('common.save')}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

function fmtHM(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type AgendaRow =
  { kind: 'day'; day: Date; list: CalendarEvent[]; today: boolean } | { kind: 'free'; from: Date; to: Date };

/** Days with events (and today) as rows; consecutive free days collapse into one line. */
function agendaRows(days: Date[], events: CalendarEvent[], now: Date): AgendaRow[] {
  const rows: AgendaRow[] = [];
  for (const day of days) {
    const list = eventsOn(events, day);
    const today = isoDay(day) === isoDay(now);
    if (list.length || today) {
      rows.push({ kind: 'day', day, list, today });
      continue;
    }
    const last = rows[rows.length - 1];
    if (last?.kind === 'free') last.to = day;
    else rows.push({ kind: 'free', from: day, to: day });
  }
  return rows;
}

export function Calendar() {
  const [editing, setEditing] = useState<Partial<CalendarEvent> | null>(null);
  const [busy, setBusy] = useState('');
  const now = clock.value;
  const ed = getEdition(settings.value.edition, settings.value.locale);
  const events = snapshot.value.events.filter((e) => !e.deletedAt);
  const days = Array.from({ length: 14 }, (_, i) => addDays(startOfDay(now), i));
  const conflicts = findConflicts(events.filter((e) => e.end >= now.toISOString()));
  const conflictIds = new Set(conflicts.flatMap(([a, b]) => [a.id, b.id]));
  const syncAllowed = can('calendarSync', entitlement.value);

  useEffect(() => {
    const found = events.find((e) => e.id === route.value.param);
    if (found) setEditing(found);
  }, [route.value.param]);

  const importFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) return toast(t('error.fileTooLarge'), 'bad');
    const text = await file.text();
    const parsed = parseIcs(text, { now });
    const res = await ingestEvents(
      'ics',
      parsed.map((p) => ({
        title: p.title,
        start: p.start,
        end: p.end,
        allDay: p.allDay,
        location: p.location,
        description: p.description,
        source: { provider: 'ics', ref: p.uid },
      })),
    );
    toast(t('calendar.imported', { count: res.added, updated: res.updated }), 'good');
  };

  const exportIcs = () => {
    const blob = new Blob([toIcs(events)], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sigma-calendar.ics';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sync = async (which: 'google' | 'microsoft') => {
    if (!syncAllowed) return navigate('account', 'plan');
    setBusy(which);
    await attempt(async () => {
      const r = which === 'google' ? await syncGoogleCalendar() : await syncOutlookCalendar();
      toast(t('calendar.synced', { count: r.added, updated: r.updated }), 'good');
    });
    setBusy('');
  };

  return (
    <div class="page">
      <PageHeader
        title={ed.nav.planner}
        subtitle={t('calendar.subtitle')}
        actions={
          <>
            <Button variant="primary" icon="plus" onClick={() => setEditing({})}>
              {t('calendar.new')}
            </Button>
          </>
        }
      />
      <div class="toolbar">
        {googleAvailable() && (
          <Button
            icon={syncAllowed ? 'refresh' : 'lock'}
            loading={busy === 'google'}
            onClick={() => void sync('google')}
          >
            {t('calendar.syncGoogle')}
          </Button>
        )}
        {microsoftAvailable() && (
          <Button
            icon={syncAllowed ? 'refresh' : 'lock'}
            loading={busy === 'microsoft'}
            onClick={() => void sync('microsoft')}
          >
            {t('calendar.syncMicrosoft')}
          </Button>
        )}
        <label class="btn btn-secondary btn-md file-btn">
          <input
            type="file"
            accept=".ics,text/calendar"
            class="sr-only"
            onChange={(e) => {
              const f = (e.currentTarget as HTMLInputElement).files?.[0];
              if (f) void attempt(() => importFile(f));
              (e.currentTarget as HTMLInputElement).value = '';
            }}
          />
          <span>{t('calendar.importIcs')}</span>
        </label>
        <Button variant="ghost" icon="download" onClick={exportIcs} disabled={!events.length}>
          {t('calendar.exportIcs')}
        </Button>
      </div>

      {conflicts.length > 0 && (
        <p class="notice warn">{t('calendar.conflicts', { count: conflicts.length })}</p>
      )}

      <ol class="agenda">
        {agendaRows(days, events, now).map((row) =>
          row.kind === 'free' ? (
            <li key={`free-${isoDay(row.from)}`} class="agenda-row agenda-free">
              <span class="agenda-when">
                {isoDay(row.from) === isoDay(row.to)
                  ? fmtDate(row.from)
                  : `${fmtDate(row.from)} – ${fmtDate(row.to)}`}
              </span>
              <span>{t('calendar.free')}</span>
            </li>
          ) : (
            <li key={isoDay(row.day)} class={`agenda-row ${row.today ? 'agenda-today' : ''}`}>
              <h2 class="agenda-date">
                <span class="agenda-dnum">{row.day.getDate()}</span>
                <span class="agenda-wd">
                  {row.today
                    ? t('calendar.today')
                    : `${row.day.toLocaleDateString(locale.value, { weekday: 'short' })} ${row.day.toLocaleDateString(locale.value, { month: 'short' })}`}
                  <span class="sr-only"> · {fmtLongDate(row.day)}</span>
                </span>
              </h2>
              {row.list.length ? (
                <ul class="timeline">
                  {row.list.map((e) => (
                    <li key={e.id} class={conflictIds.has(e.id) ? 'conflict' : ''}>
                      <time>{e.allDay ? t('calendar.allDay') : `${fmtTime(e.start)}–${fmtTime(e.end)}`}</time>
                      <button type="button" class="link-title" onClick={() => setEditing(e)}>
                        {e.title}
                      </button>
                      {e.source?.provider && !['local', 'demo'].includes(e.source.provider) && (
                        <Badge>{e.source.provider}</Badge>
                      )}
                      {e.source?.url && (
                        <a
                          href={e.source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="icon-btn"
                          aria-label={t('decision.openSource')}
                          title={t('decision.openSource')}
                        >
                          <Icon name="external" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p class="muted small agenda-nothing">{t('calendar.free')}</p>
              )}
            </li>
          ),
        )}
      </ol>
      <p class="small muted">{t('calendar.horizon', { date: fmtDate(days[days.length - 1]!) })}</p>
      <EventEditor ev={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
