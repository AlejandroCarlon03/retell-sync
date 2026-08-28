/**
 * TypeScript model of `history.json` — the append-only, one-row-per-UTC-date KPI
 * history written by the Python package's `retell_sync/output.py`
 * (`append_history`) and served at `GET /api/history` (or read as a sibling
 * `./history.json` in the static viewer). It is the source for the cross-run
 * "Trends Over Time" page, which the single-window `conversion.json` cannot
 * provide.
 *
 * Every row is one daily snapshot of the curated headline KPIs. The array is
 * ascending by `date`; an empty array is the normal state before the first run.
 */

/** The curated headline KPIs carried in each daily snapshot. Mirrors Python's `_HISTORY_KPI_KEYS`. */
export interface HistorySnapshotKpis {
  total_calls: number;
  after_hours_calls: number;
  matched_calls: number;
  won_calls: number;
  /** Won calls ÷ total calls, as a fraction 0..1. */
  conversion_rate: number;
  /** After-hours won calls ÷ after-hours calls, as a fraction 0..1. */
  after_hours_conversion_rate: number;
  dollars_per_after_hours_call: number;
  won_revenue: number;
  weighted_pipeline: number;
  after_hours_new_clients: number;
}

/** One daily snapshot in the history series. */
export interface HistoryPoint {
  /** UTC calendar date, `YYYY-MM-DD` — the upsert key (one row per day). */
  date: string;
  /** ISO-8601 UTC timestamp of the run that produced this snapshot. */
  generated_at: string;
  /** The analysis-window start of that run (ISO-8601), or null. */
  since: string | null;
  kpis: HistorySnapshotKpis;
}
