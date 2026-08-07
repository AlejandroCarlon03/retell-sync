/**
 * Client-side KPI + funnel aggregation — a faithful TypeScript port of the
 * Python `compute_kpis` / `build_conversion_funnel` in `retell_sync/conversion.py`.
 *
 * Why this exists
 * ---------------
 * The dashboard host serves a *static* `conversion.json` whose `kpis` and
 * `funnel` are pre-aggregated over the whole window. Nothing on the server
 * re-aggregates per request. So when the user narrows to a date range (see
 * `lib/dateRange.ts`), the KPI tiles, executive summary, known-clients panel and
 * funnel chart would still show whole-window numbers unless we recompute them
 * here from the filtered `by_call` rows. Every field the Python aggregation needs
 * is already present per row in `by_call`, so this port reproduces the same
 * numbers over the full set and stays consistent as the set shrinks.
 *
 * One deliberate divergence: `new_after_hours_client` is read from the stored
 * per-row flag (computed server-side over the *entire* dataset) rather than
 * recomputed within the window. A caller whose true first after-hours contact was
 * months ago must not be counted "new" merely because their earliest in-window
 * call is recent — the stored flag already answers "did after-hours bring this
 * person into the CRM?" correctly, so windowed counts just tally people carrying
 * that flag.
 *
 * The dedupe rules mirror Python exactly: revenue/pipeline sums dedupe on
 * `lead_id` (many calls can hit one lead), caller counts dedupe on non-empty
 * `phone_key`, and undatable calls (`after_hours === null`) count as neither
 * after- nor business-hours.
 */
import type { CallRow, ConversionKpis, FunnelStage } from '../types/conversion';

/** Distinct callers by non-empty `phone_key` (people, not calls). */
function uniqueCallerCount(calls: CallRow[]): number {
  const keys = new Set<string>();
  for (const c of calls) {
    if (c.phone_key && c.phone_key.length > 0) keys.add(c.phone_key);
  }
  return keys.size;
}

/** Distinct leads by `lead_id` (unmatched rows ignored). */
function uniqueLeadCount(calls: CallRow[]): number {
  const ids = new Set<number>();
  for (const c of calls) {
    if (c.lead_id != null) ids.add(c.lead_id);
  }
  return ids.size;
}

/**
 * Sum `pick(row)` over rows deduped by `lead_id`, so one opportunity hit by
 * several calls is counted once. Rows without a `lead_id`, or whose value is
 * null/non-finite, contribute nothing.
 */
function uniqueLeadSum(calls: CallRow[], pick: (c: CallRow) => number | null): number {
  const seen = new Set<number>();
  let sum = 0;
  for (const c of calls) {
    if (c.lead_id == null || seen.has(c.lead_id)) continue;
    seen.add(c.lead_id);
    const v = pick(c);
    if (typeof v === 'number' && Number.isFinite(v)) sum += v;
  }
  return sum;
}

/** Round to `digits` decimals, matching Python's `round(x, n)` closely enough for display. */
function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** The KPI mapping for zero calls — every metric present, all zero. */
export function emptyKpis(): ConversionKpis {
  return {
    total_calls: 0,
    after_hours_calls: 0,
    business_hours_calls: 0,
    matched_calls: 0,
    after_hours_matched_calls: 0,
    unique_callers: 0,
    known_callers: 0,
    after_hours_unique_callers: 0,
    after_hours_known_callers: 0,
    after_hours_new_clients: 0,
    after_hours_new_client_won_deals: 0,
    after_hours_new_client_won_revenue: 0,
    after_hours_new_client_pipeline: 0,
    won_calls: 0,
    after_hours_won_calls: 0,
    lost_calls: 0,
    conversion_rate: 0,
    after_hours_conversion_rate: 0,
    won_revenue: 0,
    after_hours_won_revenue: 0,
    dollars_per_after_hours_call: 0,
    weighted_pipeline: 0,
    after_hours_weighted_pipeline: 0,
  };
}

/**
 * Roll a set of call rows up into the headline KPIs — the TS mirror of
 * `retell_sync.conversion.compute_kpis`. Pass the full `by_call` set for the
 * whole-window numbers, or a date-filtered subset for a windowed view.
 */
export function computeKpis(calls: CallRow[]): ConversionKpis {
  const total = calls.length;
  if (total === 0) return emptyKpis();

  const isAh = (c: CallRow) => c.after_hours === true;
  const isBh = (c: CallRow) => c.after_hours === false;

  const afterHours = calls.filter(isAh);
  const businessHours = calls.filter(isBh);
  const matched = calls.filter((c) => c.matched);
  const won = calls.filter((c) => c.is_won);
  const lost = calls.filter((c) => c.is_lost);
  const ahWon = won.filter(isAh);
  const ahMatched = matched.filter(isAh);
  const newClient = calls.filter((c) => c.new_after_hours_client);

  const afterHoursCalls = afterHours.length;
  const wonCalls = won.length;
  const ahWonCalls = ahWon.length;

  const wonRevenue = uniqueLeadSum(won, (c) => c.expected_revenue);
  const ahWonRevenue = uniqueLeadSum(ahWon, (c) => c.expected_revenue);
  const weightedPipeline = uniqueLeadSum(matched, (c) => c.weighted_value);
  const ahWeightedPipeline = uniqueLeadSum(ahMatched, (c) => c.weighted_value);

  const ahNewWon = newClient.filter((c) => c.is_won);
  const ahNewWonRevenue = uniqueLeadSum(ahNewWon, (c) => c.expected_revenue);
  const ahNewPipeline = uniqueLeadSum(newClient, (c) => c.weighted_value);

  return {
    total_calls: total,
    after_hours_calls: afterHoursCalls,
    business_hours_calls: businessHours.length,
    matched_calls: matched.length,
    after_hours_matched_calls: ahMatched.length,
    unique_callers: uniqueCallerCount(calls),
    known_callers: uniqueCallerCount(matched),
    after_hours_unique_callers: uniqueCallerCount(afterHours),
    after_hours_known_callers: uniqueCallerCount(ahMatched),
    after_hours_new_clients: uniqueCallerCount(newClient),
    after_hours_new_client_won_deals: uniqueLeadCount(ahNewWon),
    after_hours_new_client_won_revenue: round(ahNewWonRevenue, 4),
    after_hours_new_client_pipeline: round(ahNewPipeline, 4),
    won_calls: wonCalls,
    after_hours_won_calls: ahWonCalls,
    lost_calls: lost.length,
    conversion_rate: round(wonCalls / total, 6),
    after_hours_conversion_rate: afterHoursCalls ? round(ahWonCalls / afterHoursCalls, 6) : 0,
    won_revenue: round(wonRevenue, 4),
    after_hours_won_revenue: round(ahWonRevenue, 4),
    dollars_per_after_hours_call: afterHoursCalls ? round(ahWonRevenue / afterHoursCalls, 4) : 0,
    weighted_pipeline: round(weightedPipeline, 4),
    after_hours_weighted_pipeline: round(ahWeightedPipeline, 4),
  };
}

/**
 * Aggregate call rows into the ordered, cumulative funnel — the TS mirror of
 * `retell_sync.conversion.build_conversion_funnel`. The stage order is taken from
 * the server's funnel (`order`), since the frontend doesn't carry the
 * `funnel_stage_order` config; a call at position *k* is counted at every stage
 * `0..k`, so `calls` is non-increasing down the funnel.
 */
export function buildFunnel(calls: CallRow[], order: string[]): FunnelStage[] {
  return order.map((stage, position) => {
    const reached = calls.filter((c) => c.funnel_position != null && c.funnel_position >= position);
    const ahReached = reached.filter((c) => c.after_hours === true);
    const revSum = (rows: CallRow[]) =>
      rows.reduce(
        (s, c) =>
          s + (typeof c.expected_revenue === 'number' && Number.isFinite(c.expected_revenue) ? c.expected_revenue : 0),
        0,
      );
    return {
      position,
      stage,
      calls: reached.length,
      after_hours_calls: ahReached.length,
      expected_revenue: round(revSum(reached), 4),
      after_hours_expected_revenue: round(revSum(ahReached), 4),
    };
  });
}
