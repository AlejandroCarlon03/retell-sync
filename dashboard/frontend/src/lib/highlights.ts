/**
 * Performance highlights — the best and worst readings in the window, DERIVED
 * from the same `by_call` rows the KPIs use. Four picks:
 *   - highest-converting day (won ÷ calls), volume-gated so a lone call can't win
 *   - worst-performing day   (won ÷ calls), same gate
 *   - highest-revenue day     (most won expected_revenue booked)
 *   - largest single deal     (the biggest won call, with its deep links)
 *
 * Days are bucketed by `buildDailySeries` — the one UTC grouping path the rest of
 * the dashboard uses — so these never disagree with the trend or the volume table.
 *
 * Fairness: a 1-call day at 100% (or a 1-call day at 0%) is noise, so the two
 * day-CONVERSION picks only consider days with at least `MIN_DAY_VOLUME` calls;
 * when no day clears that bar they return null and the UI says so honestly rather
 * than showing a misleading pick. The revenue-day and largest-deal picks have no
 * such gate — a real dollar figure is meaningful at any volume.
 *
 * Ties resolve deterministically to the EARLIEST reading: the daily series is
 * ascending, so a strict `>` / `<` comparison keeps the first (earliest) day; the
 * largest-deal scan breaks ties on the earlier timestamp.
 */
import type { CallRow } from '../types/conversion';
import { buildDailySeries } from './series';

/** A day must carry at least this many calls to be eligible for a conversion pick. */
export const MIN_DAY_VOLUME = 3;

export interface DayStat {
  /** UTC ISO date, e.g. "2026-07-24". */
  date: string;
  calls: number;
  won: number;
  /** won ÷ calls as a fraction 0..1. */
  rate: number;
  /** Won expected_revenue booked that day (lead-deduped), in dollars. */
  wonRevenue: number;
}

export interface DealHighlight {
  callId: string;
  leadId: number | null;
  leadName: string | null;
  salesRep: string | null;
  /** ISO timestamp of the winning call, or null when undatable. */
  ts: string | null;
  revenue: number;
}

export interface Highlights {
  bestConversion: DayStat | null;
  worstConversion: DayStat | null;
  bestRevenueDay: DayStat | null;
  largestDeal: DealHighlight | null;
  /** How many days cleared the volume gate — surfaced for an honest InfoTip. */
  qualifyingDays: number;
}

/** True when `a` is a strictly earlier timestamp than `b` (nulls sort last). */
function isEarlier(a: string | null, b: string | null): boolean {
  if (a == null) return false;
  if (b == null) return true;
  return a < b;
}

export function buildHighlights(calls: CallRow[]): Highlights {
  const days: DayStat[] = buildDailySeries(calls).map((p) => ({
    date: p.date,
    calls: p.calls,
    won: p.won,
    rate: p.calls > 0 ? p.won / p.calls : 0,
    wonRevenue: p.wonRevenue,
  }));

  // Ascending by date, so the earliest extreme is kept under a strict comparison.
  const qualifying = days.filter((d) => d.calls >= MIN_DAY_VOLUME);

  let bestConversion: DayStat | null = null;
  let worstConversion: DayStat | null = null;
  for (const d of qualifying) {
    if (bestConversion === null || d.rate > bestConversion.rate) bestConversion = d;
    if (worstConversion === null || d.rate < worstConversion.rate) worstConversion = d;
  }

  let bestRevenueDay: DayStat | null = null;
  for (const d of days) {
    if (d.wonRevenue > 0 && (bestRevenueDay === null || d.wonRevenue > bestRevenueDay.wonRevenue)) {
      bestRevenueDay = d;
    }
  }

  let largestDeal: DealHighlight | null = null;
  for (const c of calls) {
    if (!c.is_won) continue;
    const revenue =
      typeof c.expected_revenue === 'number' && Number.isFinite(c.expected_revenue)
        ? c.expected_revenue
        : 0;
    const better =
      largestDeal === null ||
      revenue > largestDeal.revenue ||
      (revenue === largestDeal.revenue && isEarlier(c.ts, largestDeal.ts));
    if (better) {
      largestDeal = {
        callId: c.call_id,
        leadId: c.lead_id,
        leadName: c.lead_name,
        salesRep: c.sales_rep,
        ts: c.ts,
        revenue,
      };
    }
  }

  return {
    bestConversion,
    worstConversion,
    bestRevenueDay,
    largestDeal,
    qualifyingDays: qualifying.length,
  };
}
