import { useEffect, useId, useRef, type ReactNode } from 'react';
import { STATUS_LABELS, type TripStatus } from '../lib/trip';
import type { BudgetStatus } from '../lib/budget';

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'info' | 'success' | 'warn'; children: ReactNode }) {
  const icon = { error: '⚠', info: 'ℹ', success: '✓', warn: '⚠' }[kind];
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true">{icon}</span>
      <div>{children}</div>
    </div>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => ReactNode; className?: string }) {
  const id = useId();
  const hintId = hint || error ? `${id}-d` : undefined;
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id, hintId)}
      {hint && !error && <small id={hintId} className="muted">{hint}</small>}
      {error && <small id={hintId} className="field-error">{error}</small>}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="spinner" role="status" aria-live="polite"><span className="dot" aria-hidden="true" />{label}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><strong>{title}</strong>{children && <p className="muted">{children}</p>}</div>;
}

/** Accessible modal on the native <dialog> element (focus trap + Esc come for free). */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="dialog-body">
          <header className="dialog-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close dialog">✕</button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}>
      <div className="progress-fill" style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

export function StatusBadge({ status }: { status: TripStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>;
}

const BUDGET_TEXT: Record<BudgetStatus, string> = { under: 'Under budget', near: 'Near budget', over: 'Over budget', none: 'No budget' };
const BUDGET_ICON: Record<BudgetStatus, string> = { under: '✓', near: '◐', over: '●', none: '–' };
/** Status is conveyed by text and an icon, never colour alone. */
export function BudgetBadge({ status }: { status: BudgetStatus }) {
  return <span className={`badge budget-${status}`}><span aria-hidden="true">{BUDGET_ICON[status]} </span>{BUDGET_TEXT[status]}</span>;
}

export function ErrorBanner({ message }: { message: string | null }) {
  return message ? <Alert kind="error">{message}</Alert> : null;
}

export function SafeLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href || !/^https?:\/\//i.test(href)) return <>{children}</>; // never render javascript: etc.
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

export function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
