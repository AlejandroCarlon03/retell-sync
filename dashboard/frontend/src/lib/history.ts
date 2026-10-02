/**
 * Helpers for the cross-run "Trends Over Time" page: the set of trackable
 * headline metrics (each with a formatter kind), and a first-vs-latest delta over
 * the history series. Pure — derived entirely from the `HistoryPoint[]` the
 * `/api/history` endpoint serves.
 */
import type { PeriodDelta } from './series';
import type { HistoryPoint, HistorySnapshotKpis } from '../types/history';

/** How a metric's numbers should be rendered on the axis, tooltip, and delta chip. */
export type MetricFormat = 'currency' | 'percent' | 'count';

export interface TrendMetric {
  key: string;
  /** Short label for the segmented control. */
  label: string;
  /** Full heading shown above the chart. */
  title: string;
  /** One-line explanation for the InfoTip. */
  help: string;
  format: MetricFormat;
  /** Pull the metric's value out of a snapshot. */
  pick: (k: HistorySnapshotKpis) => number;
}

/**
 * The metrics the Trends page can plot, decision-first order: the two figures
 * that answer "is after-hours paying, and is it improving?" lead.
 */
export const TREND_METRICS: readonly TrendMetric[] = [
  {
    key: 'dollars_per_after_hours_call',
    label: '$ / AH call',
    title: 'Dollars per after-hours call',
    help: 'Won revenue attributed to after-hours calls ÷ after-hours calls, per run. The headline "is the agent paying for itself?" figure over time.',
    format: 'currency',
    pick: (k) => k.dollars_per_after_hours_call,
  },
  {
    key: 'after_hours_conversion_rate',
    label: 'AH conv.',
    title: 'After-hours conversion rate',
    help: 'After-hours won calls ÷ after-hours calls, per run.',
    format: 'percent',
    pick: (k) => k.after_hours_conversion_rate,
  },
  {
    key: 'won_revenue',
    title: 'Won revenue',
    label: 'Won $',
    help: 'Expected revenue of won leads in each run’s window.',
    format: 'currency',
    pick: (k) => k.won_revenue,
  },
  {
    key: 'weighted_pipeline',
    label: 'Pipeline',
    title: 'Weighted pipeline',
    help: 'Σ expected_revenue × probability over matched open leads, per run.',
    format: 'currency',
    pick: (k) => k.weighted_pipeline,
  },
  {
    key: 'total_calls',
    label: 'Calls',
    title: 'Total calls',
    help: 'Calls captured in each run’s window.',
    format: 'count',
    pick: (k) => k.total_calls,
  },
  {
    key: 'after_hours_new_clients',
    label: 'New clients',
    title: 'New after-hours clients',
    help: 'Distinct callers the after-hours agent brought into the CRM, per run.',
    format: 'count',
    pick: (k) => k.after_hours_new_clients,
  },
];

/** One plotted point: the UTC day plus the selected metric's value. */
export interface TrendPoint {
  date: string;
  value: number;
}

/** Project the history onto one metric, in the series' existing (ascending) order. */
export function metricSeries(history: HistoryPoint[], metric: TrendMetric): TrendPoint[] {
  return history.map((p) => ({ date: p.date, value: metric.pick(p.kpis) }));
}

/**
 * The movement across the whole loaded history for one metric: the latest
 * snapshot vs the earliest. Shaped as a {@link PeriodDelta} so the existing
 * {@link DeltaChip} renders it. `pct` is null when the first value is 0.
 */
export function trendDelta(history: HistoryPoint[], metric: TrendMetric): PeriodDelta {
  if (history.length === 0) {
    return { recent: 0, prior: 0, change: 0, pct: null };
  }
  const prior = metric.pick(history[0].kpis);
  const recent = metric.pick(history[history.length - 1].kpis);
  const change = recent - prior;
  return { recent, prior, change, pct: prior !== 0 ? change / prior : null };
}
