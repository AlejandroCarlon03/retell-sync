/**
 * Client-side time-series helpers derived from the `by_call` rows. The payload
 * carries per-call detail but no pre-aggregated daily series or period-over-period
 * deltas, so the trend chart (TrendChart) and KPI sparklines compute them here.
 * Calls are bucketed by UTC calendar date — good enough for daily trends, and
 * consistent with the rest of the dashboard's date handling.
 */
import type { CallRow } from '../types/conversion';

export interface DayPoint {
  /** ISO date, e.g. "2026-08-06". */
  date: string;
  calls: number;
  matched: number;
  won: number;
  cost: number;
}

/** Bucket calls by UTC date, ascending. Undatable calls are skipped. */
export function buildDailySeries(calls: CallRow[]): DayPoint[] {
  const map = new Map<string, DayPoint>();
  for (const c of calls) {
    if (!c.ts) continue;
    const date = c.ts.slice(0, 10);
    const p = map.get(date) ?? { date, calls: 0, matched: 0, won: 0, cost: 0 };
    p.calls += 1;
    if (c.matched) p.matched += 1;
    if (c.is_won) p.won += 1;
    if (typeof c.cost === 'number' && Number.isFinite(c.cost)) p.cost += c.cost;
    map.set(date, p);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface PeriodDelta {
  /** Sum over the most recent `windowDays`. */
  recent: number;
  /** Sum over the `windowDays` immediately before that. */
  prior: number;
  /** recent − prior. */
  change: number;
  /** Fractional change vs prior (0..1+), or null when prior is 0. */
  pct: number | null;
}

/**
 * Compare the last `windowDays` of a daily metric against the `windowDays` before
 * it. Operates on the tail of the series, so gaps (days with no calls) are simply
 * absent — a reasonable approximation for a "vs previous week" delta.
 */
export function periodDelta(
  series: DayPoint[],
  pick: (p: DayPoint) => number,
  windowDays = 7,
): PeriodDelta {
  const values = series.map(pick);
  const recent = values.slice(-windowDays).reduce((a, b) => a + b, 0);
  const prior = values.slice(-windowDays * 2, -windowDays).reduce((a, b) => a + b, 0);
  const change = recent - prior;
  const pct = prior > 0 ? change / prior : null;
  return { recent, prior, change, pct };
}
