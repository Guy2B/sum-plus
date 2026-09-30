import type { FinanceEntry } from './types';
import { monthKey, toDate } from './dates';

const alive = (rows: FinanceEntry[]) => rows.filter((r) => !r.deletedAt);

export interface MonthSummary {
  month: string;
  income: number;
  expense: number;
  balance: number;
  pendingIncome: number;
  pendingExpense: number;
  overdueCount: number;
  taxRelevant: number;
  byCategory: { category: string; kind: 'income' | 'expense'; total: number }[];
}

/** All amounts are minor units (cents). Only settled entries count toward the balance. */
export function summarizeMonth(entries: FinanceEntry[], month: string): MonthSummary {
  const rows = alive(entries).filter((e) => monthKey(e.date) === month);
  const sum = (pred: (e: FinanceEntry) => boolean) => rows.filter(pred).reduce((s, e) => s + e.amount, 0);
  const cats = new Map<string, { category: string; kind: 'income' | 'expense'; total: number }>();
  for (const e of rows) {
    const k = `${e.kind}:${e.category}`;
    const c = cats.get(k) ?? { category: e.category, kind: e.kind, total: 0 };
    c.total += e.amount;
    cats.set(k, c);
  }
  const income = sum((e) => e.kind === 'income' && e.status === 'paid');
  const expense = sum((e) => e.kind === 'expense' && e.status === 'paid');
  return {
    month,
    income,
    expense,
    balance: income - expense,
    pendingIncome: sum((e) => e.kind === 'income' && e.status !== 'paid'),
    pendingExpense: sum((e) => e.kind === 'expense' && e.status !== 'paid'),
    overdueCount: rows.filter((e) => e.status === 'overdue').length,
    taxRelevant: sum((e) => Boolean(e.taxRelevant)),
    byCategory: [...cats.values()].sort((a, b) => b.total - a.total),
  };
}

/** Last `count` months ending at `now`, oldest first. */
export function monthlySeries(entries: FinanceEntry[], now: Date, count = 6): MonthSummary[] {
  const out: MonthSummary[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(summarizeMonth(entries, monthKey(d)));
  }
  return out;
}

/** Pending entries whose due date has passed (pure; the caller persists the status change). */
export function detectOverdue(entries: FinanceEntry[], now: Date): FinanceEntry[] {
  return alive(entries).filter((e) => {
    if (e.status !== 'pending') return false;
    const due = toDate(e.dueDate ?? null);
    return Boolean(due && due.getTime() < now.getTime());
  });
}

/** Parses user input such as "1 234,56", "1,234.56" or "12€" into minor units. */
export function parseAmount(input: string): number | null {
  // JS `\s` already covers no-break and narrow no-break spaces used as thousands separators.
  const cleaned = input.replace(/\s/g, '').replace(/[€$£]|CHF|CAD/gi, '');
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const normalized =
    lastComma > lastDot ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function formatMoney(minor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100);
}
