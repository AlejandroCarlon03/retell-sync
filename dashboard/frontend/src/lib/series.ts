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

/** Aggregation granularity for the revenue trend. */
export type RevenueGranularity = 'day' | 'week' | 'month';

/** One aggregated revenue bucket, split by the fixed after/business channel pair. */
export interface RevenuePoint {
  /** Stable, sortable bucket key: "YYYY-MM-DD" (day / ISO-week Monday) or "YYYY-MM". */
  key: string;
  /** Compact axis label in tabular numerals (MM-DD, or YYYY-MM for months). */
  label: string;
  /** Won revenue from after-hours-won leads seated in this bucket, in dollars. */
  after: number;
  /** Won revenue from business-hours-won leads seated in this bucket, in dollars. */
  business: number;
}

/** The revenue trend plus the honest remainder that can't sit on a time axis. */
export interface RevenueSeries {
  points: RevenuePoint[];
  /**
   * Won revenue that carries no usable timestamp and so cannot be bucketed — an
   * undatable won lead. Kept out of `points` and surfaced as a "+ $X undated" note
   * so `plotted + undated` still reconciles to `kpis.won_revenue`.
   */
  undated: number;
  /** Sum of after + business over `points` — the revenue actually drawn. */
  plotted: number;
}

/** UTC Monday (ISO week start) for an ISO timestamp, as a "YYYY-MM-DD" key. */
function isoWeekStart(ts: string): string {
  const d = new Date(`${ts.slice(0, 10)}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const shift = dow === 0 ? -6 : 1 - dow; // back up to Monday
  d.setUTCDate(d.getUTCDate() + shift);
  return d.toISOString().slice(0, 10);
}

/** Bucket key + axis label for a timestamp at the chosen granularity (UTC). */
function bucketOf(ts: string, granularity: RevenueGranularity): { key: string; label: string } {
  if (granularity === 'month') {
    const key = ts.slice(0, 7); // YYYY-MM
    return { key, label: key };
  }
  const key = granularity === 'week' ? isoWeekStart(ts) : ts.slice(0, 10);
  return { key, label: key.slice(5) }; // MM-DD
}

/**
 * WON revenue over time, split into the fixed after-hours / business-hours pair
 * and aggregated by day, ISO week (Monday), or calendar month — all UTC, matching
 * `buildDailySeries`. The invariant that makes the chart trustworthy: its totals
 * reconcile exactly to the KPIs the rest of the dashboard shows.
 *
 * Reconciliation, precisely
 * -------------------------
 * `kpis.won_revenue` / `after_hours_won_revenue` are **lead-deduped** sums
 * (`uniqueLeadSum` in lib/kpis.ts): one opportunity hit by several won calls counts
 * once. Naively summing per-call `expected_revenue` would double-count those leads
 * and disagree with the KPI, so we dedupe on `lead_id` the same way:
 *   - after channel  = unique leads with an after-hours won call (always datable,
 *     since `after_hours === true` implies a usable timestamp) → equals
 *     `after_hours_won_revenue`.
 *   - business channel = every other unique won lead's revenue → equals
 *     `won_revenue − after_hours_won_revenue` (expected_revenue is a per-lead
 *     attribute, so the first-seen row's value is the lead's value).
 * Each unique won lead therefore lands in exactly one channel and one bucket, so a
 * stacked area can never show a negative segment. A won lead whose only timestamps
 * are null can't be placed on the axis; its revenue goes to `undated` instead, and
 * `plotted + undated === won_revenue`. Won calls without a `lead_id` contribute
 * nothing — exactly as `uniqueLeadSum` skips them — so they never inflate the total.
 */
export function buildRevenueSeries(
  calls: CallRow[],
  granularity: RevenueGranularity,
): RevenueSeries {
  const rev = (c: CallRow) =>
    typeof c.expected_revenue === 'number' && Number.isFinite(c.expected_revenue)
      ? c.expected_revenue
      : 0;

  const won = calls.filter((c) => c.is_won && c.lead_id != null);

  // After channel: first-seen after-hours won call per lead (guaranteed a timestamp).
  const afterByLead = new Map<number, { rev: number; ts: string }>();
  for (const c of won) {
    if (c.after_hours === true && c.ts && !afterByLead.has(c.lead_id as number)) {
      afterByLead.set(c.lead_id as number, { rev: rev(c), ts: c.ts });
    }
  }

  // Business channel: every other won lead. Keep first-seen revenue (per-lead
  // constant), but prefer a datable timestamp for its bucket if any call carries one.
  const businessByLead = new Map<number, { rev: number; ts: string | null }>();
  for (const c of won) {
    const lead = c.lead_id as number;
    if (afterByLead.has(lead)) continue;
    const seen = businessByLead.get(lead);
    if (!seen) {
      businessByLead.set(lead, { rev: rev(c), ts: c.ts });
    } else if (seen.ts == null && c.ts) {
      seen.ts = c.ts; // upgrade an undated placeholder to a datable representative
    }
  }

  const buckets = new Map<string, RevenuePoint>();
  const seat = (key: string, label: string): RevenuePoint => {
    let p = buckets.get(key);
    if (!p) {
      p = { key, label, after: 0, business: 0 };
      buckets.set(key, p);
    }
    return p;
  };

  for (const { rev: r, ts } of afterByLead.values()) {
    const { key, label } = bucketOf(ts, granularity);
    seat(key, label).after += r;
  }

  let undated = 0;
  for (const { rev: r, ts } of businessByLead.values()) {
    if (!ts) {
      undated += r;
      continue;
    }
    const { key, label } = bucketOf(ts, granularity);
    seat(key, label).business += r;
  }

  const points = [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  const plotted = points.reduce((s, p) => s + p.after + p.business, 0);
  return { points, undated, plotted };
}
