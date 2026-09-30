import type { ComponentChildren, JSX } from 'preact';
import { signal } from '@preact/signals';
import { useEffect, useId, useRef } from 'preact/hooks';
import { Icon } from './icons';
import { t } from '../i18n';
import { entitlement } from '../data/store';
import { can, type Feature } from '../domain/entitlements';
import { navigate } from './router';

/* -------------------------------- layout ---------------------------------- */

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ComponentChildren;
}) {
  return (
    <header class="page-header">
      <div>
        {eyebrow && <p class="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p class="muted">{subtitle}</p>}
      </div>
      {actions && <div class="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  actions,
  children,
  class: cls = '',
  id,
}: {
  title?: ComponentChildren;
  actions?: ComponentChildren;
  children: ComponentChildren;
  class?: string;
  id?: string;
}) {
  return (
    <section class={`card ${cls}`} id={id} aria-labelledby={title && id ? `${id}-title` : undefined}>
      {(title || actions) && (
        <div class="card-head">
          {title && <h2 id={id ? `${id}-title` : undefined}>{title}</h2>}
          {actions && <div class="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({
  icon = 'sparkles',
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: ComponentChildren;
}) {
  return (
    <div class="empty">
      <Icon name={icon} size={28} />
      <p class="empty-title">{title}</p>
      {body && <p class="muted">{body}</p>}
      {action}
    </div>
  );
}

export function Grid({ children, cols = 2 }: { children: ComponentChildren; cols?: 2 | 3 | 4 }) {
  return <div class={`grid grid-${cols}`}>{children}</div>;
}

/* -------------------------------- controls -------------------------------- */

type ButtonProps = JSX.HTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: string;
  loading?: boolean;
  type?: 'button' | 'submit';
  disabled?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading,
  children,
  type = 'button',
  disabled,
  class: cls,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      class={`btn btn-${variant} btn-${size} ${cls ?? ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span class="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  class: cls = '',
}: {
  icon: string;
  label: string;
  onClick?: (e: MouseEvent) => void;
  class?: string;
}) {
  return (
    <button type="button" class={`icon-btn ${cls}`} onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  error,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (id: string) => ComponentChildren;
}) {
  const id = useId();
  return (
    <div class={`field ${error ? 'has-error' : ''}`}>
      <label for={id}>{label}</label>
      {children(id)}
      {hint && !error && <small class="muted">{hint}</small>}
      {error && (
        <small class="error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div class="toggle-row">
      <div>
        <label for={id}>{label}</label>
        {hint && <small class="muted">{hint}</small>}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        class="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
      />
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ComponentChildren;
  tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad';
}) {
  return <span class={`badge badge-${tone}`}>{children}</span>;
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div class="tabs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          class={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count != null && <span class="tab-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      class="progress"
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span style={{ width: `${v}%` }} />
    </div>
  );
}

export function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: ComponentChildren;
  detail?: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div class={`stat ${tone ? `stat-${tone}` : ''}`}>
      <span class="stat-label">{label}</span>
      <strong class="stat-value">{value}</strong>
      {detail && <span class="muted stat-detail">{detail}</span>}
    </div>
  );
}

/* --------------------------------- charts --------------------------------- */

export function BarChart({
  data,
  label,
  format = (v) => String(v),
  height = 140,
}: {
  data: { label: string; value: number; tone?: 'good' | 'bad' | 'accent' }[];
  label: string;
  format?: (v: number) => string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const w = 100 / Math.max(1, data.length);
  return (
    <figure class="chart" aria-label={label}>
      <svg viewBox={`0 0 100 ${height / 2}`} preserveAspectRatio="none" role="img" aria-label={label}>
        {data.map((d, i) => {
          const h = (Math.abs(d.value) / max) * (height / 2 - 4);
          return (
            <rect
              key={d.label}
              x={i * w + w * 0.18}
              y={height / 2 - h}
              width={w * 0.64}
              height={h}
              rx="1.2"
              class={`bar bar-${d.tone ?? 'accent'}`}
            />
          );
        })}
      </svg>
      <figcaption class="chart-labels">
        {data.map((d) => (
          <span key={d.label} title={format(d.value)}>
            {d.label}
          </span>
        ))}
      </figcaption>
      <table class="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th>{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return <span class="muted">—</span>;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => (v == null ? null : `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 24}`))
    .filter(Boolean)
    .join(' ');
  return (
    <svg class="sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  );
}

/* --------------------------------- dialogs -------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ComponentChildren;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      class={`modal ${wide ? 'modal-wide' : ''}`}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="modal-title"
    >
      <div class="modal-head">
        <h2 id="modal-title">{title}</h2>
        <IconButton icon="x" label={t('common.close')} onClick={onClose} />
      </div>
      <div class="modal-body">{open && children}</div>
    </dialog>
  );
}

interface ConfirmState {
  title: string;
  body: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (v: boolean) => void;
}
const confirmState = signal<ConfirmState | null>(null);

export function confirmDialog(opts: {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.value = {
      title: opts.title,
      body: opts.body,
      confirmLabel: opts.confirmLabel ?? t('common.confirm'),
      danger: opts.danger ?? false,
      resolve,
    };
  });
}

export function ConfirmHost() {
  const s = confirmState.value;
  const close = (v: boolean) => {
    s?.resolve(v);
    confirmState.value = null;
  };
  return (
    <Modal open={Boolean(s)} onClose={() => close(false)} title={s?.title ?? ''}>
      <p>{s?.body}</p>
      <div class="modal-actions">
        <Button onClick={() => close(false)}>{t('common.cancel')}</Button>
        <Button variant={s?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
          {s?.confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/* --------------------------------- toasts --------------------------------- */

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
  action?: { label: string; run: () => void };
}
const toasts = signal<Toast[]>([]);
let toastSeq = 0;

export function toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action']): void {
  const id = ++toastSeq;
  toasts.value = [...toasts.value, { id, text, tone, action }].slice(-4);
  setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== id)), action ? 7000 : 4000);
}

export function ToastHost() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((x) => (
        <div key={x.id} class={`toast toast-${x.tone}`}>
          <span>{x.text}</span>
          {x.action && (
            <button
              type="button"
              class="link"
              onClick={() => {
                x.action!.run();
                toasts.value = toasts.value.filter((y) => y.id !== x.id);
              }}
            >
              {x.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Wraps an async action: shows a localized error toast instead of failing silently. */
export async function attempt<T>(fn: () => Promise<T>, successText?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (successText) toast(successText, 'good');
    return r;
  } catch (err) {
    const code = (err as { code?: string; message?: string }).code ?? (err as Error).message ?? 'unknown';
    toast(errorText(code), 'bad');
    return undefined;
  }
}

export function errorText(code: string): string {
  const key = `error.${code.replace(/^(auth|functions)\//, '')}`;
  const msg = t(key);
  return msg === key ? t('error.generic', { code }) : msg;
}

/* ------------------------------ plan gating ------------------------------- */

export function ProGate({ feature, children }: { feature: Feature; children: ComponentChildren }) {
  if (can(feature, entitlement.value)) return <>{children}</>;
  return (
    <div class="pro-gate">
      <Icon name="lock" size={28} />
      <h2>{t(`pro.feature.${feature}`)}</h2>
      <p class="muted">{t('pro.gateBody')}</p>
      <Button variant="primary" icon="star" onClick={() => navigate('account', 'plan')}>
        {t('pro.upgrade')}
      </Button>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div class="loading" role="status">
      <span class="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </div>
  );
}
