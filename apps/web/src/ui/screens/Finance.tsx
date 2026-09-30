import { useEffect, useState } from 'preact/hooks';
import type { FinanceEntry } from '../../domain/types';
import { create, snapshot, update, clock, settings } from '../../data/store';
import { detectOverdue, monthlySeries, parseAmount, summarizeMonth } from '../../domain/finance';
import { monthKey, isoDay } from '../../domain/dates';
import { getEdition } from '../../domain/editions';
import { t, fmtDate, fmtMoney } from '../../i18n';
import {
  Badge,
  BarChart,
  Button,
  Card,
  Empty,
  Field,
  IconButton,
  Modal,
  PageHeader,
  ProGate,
  Stat,
  attempt,
} from '../components';
import { deleteWithUndo } from './Tasks';

function EntryEditor({ entry, onClose }: { entry: Partial<FinanceEntry> | null; onClose: () => void }) {
  const [f, setF] = useState<Partial<FinanceEntry>>({});
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setF(entry ?? {});
    setAmount(entry?.amount ? String(entry.amount / 100).replace('.', ',') : '');
    setError(null);
  }, [entry]);
  const v = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  const save = async (e: Event) => {
    e.preventDefault();
    const minor = parseAmount(amount);
    if (minor == null || minor === 0) return setError(t('finance.invalidAmount'));
    if (!(f.label ?? '').trim()) return;
    const fields = {
      date: f.date ?? isoDay(),
      kind: f.kind ?? 'expense',
      amount: minor,
      currency: settings.value.currency,
      category: (f.category ?? '').trim().slice(0, 60) || 'other',
      label: (f.label ?? '').trim().slice(0, 200),
      counterparty: (f.counterparty ?? '').slice(0, 200),
      status: f.status ?? 'paid',
      dueDate: f.status === 'paid' ? null : (f.dueDate ?? null),
      taxRelevant: Boolean(f.taxRelevant),
    };
    await attempt(async () => {
      if (f.id) await update('finance', f.id, fields);
      else await create('finance', fields);
      onClose();
    }, t('common.saved'));
  };
  return (
    <Modal open={entry !== null} onClose={onClose} title={f.id ? t('finance.edit') : t('finance.new')}>
      <form class="form" onSubmit={save}>
        <div class="segmented" role="radiogroup" aria-label={t('finance.kind')}>
          {(['expense', 'income'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={(f.kind ?? 'expense') === k}
              class={(f.kind ?? 'expense') === k ? 'active' : ''}
              onClick={() => setF({ ...f, kind: k })}
            >
              {t(`finance.kindValue.${k}`)}
            </button>
          ))}
        </div>
        <div class="row">
          <Field label={t('finance.amount')} hint={settings.value.currency} error={error}>
            {(id) => (
              <input id={id} required inputMode="decimal" value={amount} onInput={(e) => setAmount(v(e))} />
            )}
          </Field>
          <Field label={t('finance.date')}>
            {(id) => (
              <input
                id={id}
                type="date"
                required
                value={f.date ?? isoDay()}
                onInput={(e) => setF({ ...f, date: v(e) })}
              />
            )}
          </Field>
        </div>
        <Field label={t('finance.label')}>
          {(id) => (
            <input
              id={id}
              required
              maxLength={200}
              value={f.label ?? ''}
              onInput={(e) => setF({ ...f, label: v(e) })}
            />
          )}
        </Field>
        <div class="row">
          <Field label={t('finance.category')}>
            {(id) => (
              <>
                <input
                  id={id}
                  list="fin-cats"
                  maxLength={60}
                  value={f.category ?? ''}
                  onInput={(e) => setF({ ...f, category: v(e) })}
                />
                <datalist id="fin-cats">
                  {[...new Set(snapshot.value.finance.map((x) => x.category))].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label={t('finance.counterparty')}>
            {(id) => (
              <input
                id={id}
                maxLength={200}
                value={f.counterparty ?? ''}
                onInput={(e) => setF({ ...f, counterparty: v(e) })}
              />
            )}
          </Field>
        </div>
        <div class="row">
          <Field label={t('finance.status')}>
            {(id) => (
              <select
                id={id}
                value={f.status ?? 'paid'}
                onChange={(e) => setF({ ...f, status: v(e) as FinanceEntry['status'] })}
              >
                {(['paid', 'pending', 'overdue'] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(`finance.statusValue.${s}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {(f.status ?? 'paid') !== 'paid' && (
            <Field label={t('finance.dueDate')}>
              {(id) => (
                <input
                  id={id}
                  type="date"
                  value={f.dueDate ?? ''}
                  onInput={(e) => setF({ ...f, dueDate: v(e) || null })}
                />
              )}
            </Field>
          )}
        </div>
        <label class="check-inline">
          <input
            type="checkbox"
            checked={Boolean(f.taxRelevant)}
            onChange={(e) => setF({ ...f, taxRelevant: (e.currentTarget as HTMLInputElement).checked })}
          />{' '}
          {t('finance.taxRelevant')}
        </label>
        <div class="modal-actions">
          {f.id && (
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                void deleteWithUndo('finance', f.id!, f.label ?? '');
                onClose();
              }}
            >
              {t('common.delete')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function exportCsv(entries: FinanceEntry[]) {
  const esc = (v: string | number | boolean | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = [
    'date',
    'kind',
    'amount',
    'currency',
    'category',
    'label',
    'counterparty',
    'status',
    'dueDate',
    'taxRelevant',
  ];
  const rows = entries.map((e) =>
    [
      e.date,
      e.kind,
      (e.amount / 100).toFixed(2),
      e.currency,
      e.category,
      e.label,
      e.counterparty,
      e.status,
      e.dueDate,
      e.taxRelevant,
    ]
      .map(esc)
      .join(','),
  );
  // Leading BOM so spreadsheet apps detect UTF-8.
  const blob = new Blob([`\\ufeff${head.join(',')}\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sigma-finance-${isoDay()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function FinanceInner() {
  const now = clock.value;
  const [month, setMonth] = useState(monthKey(now));
  const [editing, setEditing] = useState<Partial<FinanceEntry> | null>(null);
  const [taxOnly, setTaxOnly] = useState(false);
  const all = snapshot.value.finance.filter((e) => !e.deletedAt);

  useEffect(() => {
    for (const e of detectOverdue(all, now)) void update('finance', e.id, { status: 'overdue' });
  }, [all.length, now.getDate()]);

  const sum = summarizeMonth(all, month);
  const series = monthlySeries(all, new Date(`${month}-15T12:00:00`), 6);
  const rows = all
    .filter((e) => monthKey(e.date) === month && (!taxOnly || e.taxRelevant))
    .sort((a, b) => b.date.localeCompare(a.date));
  const pending = all
    .filter((e) => e.status !== 'paid')
    .sort((a, b) => (a.dueDate ?? a.date).localeCompare(b.dueDate ?? b.date));
  const shift = (delta: number) => {
    const d = new Date(`${month}-15T12:00:00`);
    d.setMonth(d.getMonth() + delta);
    setMonth(monthKey(d));
  };

  return (
    <>
      <div class="toolbar">
        <div class="month-nav">
          <IconButton icon="chevronLeft" label={t('finance.prevMonth')} onClick={() => shift(-1)} />
          <strong>{fmtDate(`${month}-01`, { month: 'long', year: 'numeric' })}</strong>
          <IconButton icon="chevronRight" label={t('finance.nextMonth')} onClick={() => shift(1)} />
        </div>
        <label class="check-inline">
          <input
            type="checkbox"
            checked={taxOnly}
            onChange={(e) => setTaxOnly((e.currentTarget as HTMLInputElement).checked)}
          />{' '}
          {t('finance.taxOnly')}
        </label>
        <Button variant="ghost" icon="download" disabled={!all.length} onClick={() => exportCsv(all)}>
          {t('finance.exportCsv')}
        </Button>
      </div>
      <Card>
        <div class="stats">
          <Stat label={t('finance.income')} value={fmtMoney(sum.income)} tone="good" />
          <Stat label={t('finance.expense')} value={fmtMoney(sum.expense)} />
          <Stat
            label={t('finance.balance')}
            value={fmtMoney(sum.balance)}
            tone={sum.balance < 0 ? 'bad' : 'good'}
          />
          <Stat
            label={t('finance.pending')}
            value={fmtMoney(sum.pendingIncome - sum.pendingExpense)}
            detail={t('finance.overdueCount', { count: sum.overdueCount })}
            tone={sum.overdueCount ? 'warn' : undefined}
          />
        </div>
        <BarChart
          label={t('finance.chart')}
          data={series.map((m) => ({
            label: fmtDate(`${m.month}-01`, { month: 'short' }),
            value: m.balance / 100,
            tone: m.balance < 0 ? 'bad' : 'good',
          }))}
          format={(v) => fmtMoney(v * 100)}
        />
        <p class="small muted">{t('finance.disclaimer')}</p>
      </Card>

      {pending.length > 0 && (
        <Card title={t('finance.toSettle')}>
          <ul class="plain-list">
            {pending.slice(0, 8).map((e) => (
              <li key={e.id} class="ledger-row">
                <span>
                  <button type="button" class="link-title" onClick={() => setEditing(e)}>
                    {e.label}
                  </button>
                  <small class="muted"> · {e.counterparty || e.category}</small>
                </span>
                <span class="muted small">{fmtDate(e.dueDate ?? e.date)}</span>
                <Badge tone={e.status === 'overdue' ? 'bad' : 'warn'}>
                  {t(`finance.statusValue.${e.status}`)}
                </Badge>
                <strong class={e.kind === 'income' ? 'good-text' : ''}>
                  {fmtMoney(e.kind === 'income' ? e.amount : -e.amount)}
                </strong>
                <Button
                  size="sm"
                  onClick={() => void update('finance', e.id, { status: 'paid', dueDate: null })}
                >
                  {t('finance.markPaid')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div class="grid grid-2">
        <Card title={t('finance.ledger')}>
          {rows.length ? (
            <ul class="plain-list">
              {rows.map((e) => (
                <li key={e.id} class="ledger-row">
                  <span class="muted small">{fmtDate(e.date)}</span>
                  <button type="button" class="link-title" onClick={() => setEditing(e)}>
                    {e.label}
                  </button>
                  <span class="muted small">{e.category}</span>
                  {e.taxRelevant && <Badge>{t('finance.taxShort')}</Badge>}
                  <strong class={e.kind === 'income' ? 'good-text' : ''}>
                    {fmtMoney(e.kind === 'income' ? e.amount : -e.amount)}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="wallet" title={t('finance.empty')} />
          )}
        </Card>
        <Card title={t('finance.byCategory')}>
          {sum.byCategory.length ? (
            <ul class="plain-list">
              {sum.byCategory.map((c) => (
                <li key={`${c.kind}${c.category}`} class="ledger-row">
                  <span>{c.category}</span>
                  <Badge tone={c.kind === 'income' ? 'good' : 'neutral'}>
                    {t(`finance.kindValue.${c.kind}`)}
                  </Badge>
                  <strong>{fmtMoney(c.total)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p class="muted">—</p>
          )}
          <p class="small muted">{t('finance.taxTotal', { amount: fmtMoney(sum.taxRelevant) })}</p>
        </Card>
      </div>
      <div class="fab-row">
        <Button
          variant="primary"
          icon="plus"
          onClick={() => setEditing({ kind: 'expense', status: 'paid', date: isoDay() })}
        >
          {t('finance.new')}
        </Button>
      </div>
      <EntryEditor entry={editing} onClose={() => setEditing(null)} />
    </>
  );
}

export function Finance() {
  const ed = getEdition(settings.value.edition, settings.value.locale);
  return (
    <div class="page">
      <PageHeader title={ed.nav.finance} subtitle={t('finance.subtitle')} />
      <ProGate feature="finance">
        <FinanceInner />
      </ProGate>
    </div>
  );
}
