/**
 * A compact period-over-period delta chip: an arrow, the change, and a quiet
 * "vs …" note. Direction is named by both the arrow and the colour class, never
 * colour alone. Renders nothing when there is no movement to report (prior and
 * recent both zero). Shared by the KPI tiles (7-day delta) and the executive
 * board (this-period-vs-previous delta) so both read identically.
 */
import type { PeriodDelta } from '../lib/series';
import { formatPercent } from '../lib/format';

export function DeltaChip({
  delta,
  title = 'Last 7 days vs the 7 days before',
  note = 'vs prev 7d',
  format,
}: {
  delta: PeriodDelta;
  /** Hover text explaining the comparison. */
  title?: string;
  /** The short trailing label (e.g. "vs prev 7d", "vs prev period"). */
  note?: string;
  /**
   * Formats the absolute-change fallback shown when the percentage is unavailable
   * (a zero prior period). Without it a currency change prints as a raw float
   * (e.g. "4379.3103"); pass `formatCurrency` / `formatCount` so it reads like the
   * figure it tracks. The percentage branch is metric-agnostic and always wins.
   */
  format?: (n: number) => string;
}) {
  if (delta.prior === 0 && delta.recent === 0) return null;
  const up = delta.change > 0;
  const flat = delta.change === 0;
  const dir = flat ? 'flat' : up ? 'up' : 'down';
  const arrow = flat ? '→' : up ? '▲' : '▼';
  const pct = delta.pct == null ? null : formatPercent(Math.abs(delta.pct));
  const change = format ? format(delta.change) : `${delta.change}`;
  return (
    <span className={`kpi-delta kpi-delta-${dir}`} title={title}>
      {arrow} {pct ?? `${up ? '+' : ''}${change}`}{' '}
      <span className="kpi-delta-note">{note}</span>
    </span>
  );
}
