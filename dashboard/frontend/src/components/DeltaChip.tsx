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
}: {
  delta: PeriodDelta;
  /** Hover text explaining the comparison. */
  title?: string;
  /** The short trailing label (e.g. "vs prev 7d", "vs prev period"). */
  note?: string;
}) {
  if (delta.prior === 0 && delta.recent === 0) return null;
  const up = delta.change > 0;
  const flat = delta.change === 0;
  const dir = flat ? 'flat' : up ? 'up' : 'down';
  const arrow = flat ? '→' : up ? '▲' : '▼';
  const pct = delta.pct == null ? null : formatPercent(Math.abs(delta.pct));
  return (
    <span className={`kpi-delta kpi-delta-${dir}`} title={title}>
      {arrow} {pct ?? `${up ? '+' : ''}${delta.change}`}{' '}
      <span className="kpi-delta-note">{note}</span>
    </span>
  );
}
