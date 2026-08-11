/**
 * Heatmap aggregations — WHEN calls come in and WHERE they come from, pure and
 * derived from the same `by_call` rows as the rest of the dashboard.
 *
 * Each aggregation supports three metrics:
 *   • 'calls'   — every call counts 1.
 *   • 'won'     — distinct won deals (deduped per lead, attributed to the first
 *                 bucket the lead's won call lands in).
 *   • 'revenue' — those won deals' expected revenue (same dedupe).
 *
 * Time buckets use America/Phoenix wall-clock. Arizona observes no DST, so the
 * local time is a fixed UTC−7 — subtract 7h from the UTC instant and read the UTC
 * parts (matching the codebase's UTC-slice date handling). Geography buckets on the
 * caller's area code (first 3 digits of the 10-digit `phone_key`) → US state.
 */
import type { CallRow } from '../types/conversion';
import { AREA_CODE_STATE } from './areaCodes';

export type HeatMetric = 'calls' | 'won' | 'revenue';

/** Phoenix (UTC−7, no DST) offset in milliseconds. */
const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Weekday labels, index 0 = Sunday (matches Date.getUTCDay). */
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Per-call contribution for a metric. For 'won'/'revenue' the ``seen`` set carries
 * lead dedupe across buckets, so a deal reached on several calls counts once (in the
 * first bucket it appears). Returns 0 when the call doesn't contribute.
 */
function contribution(call: CallRow, metric: HeatMetric, seen: Set<number>): number {
  if (metric === 'calls') return 1;
  if (!call.is_won || call.lead_id == null || seen.has(call.lead_id)) return 0;
  seen.add(call.lead_id);
  if (metric === 'won') return 1;
  const rev = call.expected_revenue;
  return typeof rev === 'number' && Number.isFinite(rev) ? rev : 0;
}

export interface TimeHeatmap {
  /** grid[day 0..6][hour 0..23] — the metric total in that Phoenix-local bucket. */
  grid: number[][];
  /** Largest single-cell value, for scaling the colour ramp (0 when empty). */
  max: number;
  /** Grand total across all cells. */
  total: number;
}

/** Build the 7×24 (weekday × hour, Phoenix-local) grid for a metric. */
export function buildTimeHeatmap(calls: CallRow[], metric: HeatMetric): TimeHeatmap {
  const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const seen = new Set<number>();
  let max = 0;
  let total = 0;

  for (const c of calls) {
    if (!c.ts) continue;
    const t = Date.parse(c.ts);
    if (Number.isNaN(t)) continue;
    const value = contribution(c, metric, seen);
    if (value === 0) continue;
    const local = new Date(t - PHOENIX_OFFSET_MS);
    const day = local.getUTCDay();
    const hour = local.getUTCHours();
    grid[day][hour] += value;
    total += value;
    if (grid[day][hour] > max) max = grid[day][hour];
  }

  return { grid, max, total };
}

export interface GeoHeatmap {
  /** state (2-letter) → metric total, only states with a non-zero value. */
  byState: Record<string, number>;
  /** Largest single-state value, for scaling the colour ramp (0 when empty). */
  max: number;
  /** Grand total across all states (excludes the unknown bucket). */
  total: number;
  /** Metric total for calls whose area code didn't resolve to a state. */
  unknown: number;
}

/** Extract the 3-digit area code from a normalized 10-digit phone key, or null. */
export function areaCodeOf(phoneKey: string | null | undefined): string | null {
  if (!phoneKey || phoneKey.length < 10) return null;
  return phoneKey.slice(0, 3);
}

/** Build the per-US-state totals for a metric, bucketing unresolved calls to `unknown`. */
export function buildGeoByState(calls: CallRow[], metric: HeatMetric): GeoHeatmap {
  const byState: Record<string, number> = {};
  const seen = new Set<number>();
  let max = 0;
  let total = 0;
  let unknown = 0;

  for (const c of calls) {
    const value = contribution(c, metric, seen);
    if (value === 0) continue;
    const code = areaCodeOf(c.phone_key);
    const state = code ? AREA_CODE_STATE[code] : undefined;
    if (!state) {
      unknown += value;
      continue;
    }
    byState[state] = (byState[state] ?? 0) + value;
    total += value;
    if (byState[state] > max) max = byState[state];
  }

  return { byState, max, total, unknown };
}

/**
 * Sequential single-hue ramp for a cell: mixes the after-hours steel-blue into the
 * recessed surface by intensity, so it reads light→dark on one hue (the magnitude
 * rule) and adapts to light/dark automatically via the tokens. A sqrt curve spreads
 * the typically-skewed call counts. `maxPct` caps the darkest step — lower it when
 * text sits on the cell so the label stays legible. Zero → the bare surface.
 */
export function rampColor(value: number, max: number, maxPct = 95): string {
  if (value <= 0 || max <= 0) return 'var(--surface-2)';
  const ratio = Math.min(1, value / max);
  const pct = Math.round(12 + (maxPct - 12) * Math.sqrt(ratio));
  return `color-mix(in srgb, var(--series-after) ${pct}%, var(--surface-2))`;
}

export interface StateRank {
  state: string;
  value: number;
}

/** States sorted by value, descending — the accessible readout beside the map. */
export function rankStates(geo: GeoHeatmap): StateRank[] {
  return Object.entries(geo.byState)
    .map(([state, value]) => ({ state, value }))
    .sort((a, b) => b.value - a.value || a.state.localeCompare(b.state));
}
