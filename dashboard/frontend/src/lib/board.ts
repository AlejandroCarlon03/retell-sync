/**
 * Aggregations specific to the executive board: the preceding comparison window
 * (for period-over-period deltas), a period delta from two scalars, and the
 * top-salespeople leaderboard. All pure and derived from the same `by_call` rows
 * the rest of the dashboard uses, so the board can never disagree with the KPIs.
 */
import type { CallRow } from '../types/conversion';
import type { DateRange } from './dateRange';
import type { PeriodDelta } from './series';

/**
 * The equal-length window immediately before `range`, for a "this period vs the
 * one before" comparison. Returns null for an unbounded or empty range (nothing
 * to compare against — e.g. "All time").
 */
export function priorRange(range: DateRange): DateRange | null {
  if (range.from == null || range.to == null) return null;
  const len = range.to - range.from;
  if (len <= 0) return null;
  return { preset: 'custom', from: range.from - len, to: range.from };
}

/** Build a {@link PeriodDelta} from a current and a prior scalar. */
export function deltaOf(recent: number, prior: number): PeriodDelta {
  const change = recent - prior;
  return { recent, prior, change, pct: prior > 0 ? change / prior : null };
}

/** One salesperson's contribution over the window. */
export interface RepStat {
  rep: string;
  /** Calls whose lead is assigned to this rep. */
  calls: number;
  /** Distinct won deals (deduped by lead). */
  wonDeals: number;
  /** Won expected revenue, deduped by lead so one deal counts once. */
  wonRevenue: number;
}

/**
 * The top salespeople by won revenue over the window, most first. Revenue and
 * deal counts dedupe on `lead_id` (a deal hit by several calls counts once),
 * matching the KPI math. Rows with no assigned salesperson are excluded — the
 * leaderboard is about named reps. Ties break by won deals, then call volume.
 */
export function topReps(calls: CallRow[], limit = 5): RepStat[] {
  const byRep = new Map<string, { calls: number; wonLeads: Map<number, number> }>();

  for (const c of calls) {
    const rep = c.sales_rep?.trim();
    if (!rep) continue;
    let entry = byRep.get(rep);
    if (!entry) {
      entry = { calls: 0, wonLeads: new Map() };
      byRep.set(rep, entry);
    }
    entry.calls += 1;
    if (c.is_won && c.lead_id != null && !entry.wonLeads.has(c.lead_id)) {
      const rev =
        typeof c.expected_revenue === 'number' && Number.isFinite(c.expected_revenue)
          ? c.expected_revenue
          : 0;
      entry.wonLeads.set(c.lead_id, rev);
    }
  }

  const stats: RepStat[] = [...byRep.entries()].map(([rep, e]) => ({
    rep,
    calls: e.calls,
    wonDeals: e.wonLeads.size,
    wonRevenue: [...e.wonLeads.values()].reduce((a, b) => a + b, 0),
  }));

  stats.sort(
    (a, b) =>
      b.wonRevenue - a.wonRevenue || b.wonDeals - a.wonDeals || b.calls - a.calls,
  );
  return stats.slice(0, limit);
}
