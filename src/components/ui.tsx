import type { Severity } from '@/lib/types';

export function SeverityBadge({ severity }: { severity: Severity | string }) {
  return <span className={`badge sev-${severity}`}>{severity}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge st-${status}`}>{status.replace('_', ' ')}</span>;
}

export function Score({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="muted">not scanned</span>;
  const color = value >= 80 ? 'var(--good)' : value >= 50 ? 'var(--med)' : 'var(--crit)';
  return (
    <span className="score" title={`Compliance score ${value} / 100`}>
      <b style={{ color }}>{Math.round(value)}</b>
      <span className="bar"><i style={{ width: `${value}%`, background: color }} /></span>
    </span>
  );
}

export const kindLabel: Record<string, string> = {
  missing: 'Clause missing',
  non_standard: 'Non-standard wording',
  restricted_present: 'Risky clause present',
};

export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
export const fmtDateTime = (d: string | Date) =>
  new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
