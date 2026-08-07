/**
 * Global date-range filtering — the presets the dashboard offers and the logic
 * that turns a selected preset into a concrete `[from, to)` interval and filters
 * the `by_call` rows to it.
 *
 * Anchoring
 * ---------
 * Relative ranges (last 7/30/90 days, this/last month) are anchored to the
 * report's `generated_at`, *not* the wall clock. A `conversion.json` that is a
 * day or two stale would otherwise make "Last 7 Days" go empty; anchoring to the
 * report keeps every window meaningful and reproducible. The caller passes the
 * anchor in (from `data.generated_at`), so this module stays pure and testable.
 *
 * Calendar handling is done in UTC, matching the rest of the dashboard's date
 * handling (`series.ts`, the cost-volume page both bucket on the UTC `ts` slice).
 * Bounds are a half-open interval `[from, to)`: `from` inclusive, `to` exclusive,
 * so a call exactly on a month boundary lands in exactly one month.
 */
import type { CallRow } from '../types/conversion';

export type RangePreset =
  | 'all'
  | '7d'
  | '30d'
  | '90d'
  | 'this-month'
  | 'last-month'
  | 'custom';

/** A resolved, absolute interval. `from`/`to` are epoch ms; null = unbounded. */
export interface DateRange {
  preset: RangePreset;
  /** Inclusive lower bound (epoch ms), or null for unbounded (preset "all"). */
  from: number | null;
  /** Exclusive upper bound (epoch ms), or null for unbounded. */
  to: number | null;
}

/** For the custom preset, the user's picked ISO dates (yyyy-mm-dd), either optional. */
export interface CustomBounds {
  fromDate?: string | null;
  toDate?: string | null;
}

export const PRESET_LABELS: Record<RangePreset, string> = {
  all: 'All time',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  'this-month': 'This month',
  'last-month': 'Last month',
  custom: 'Custom range',
};

/** The presets offered in the picker, in display order. */
export const PRESET_ORDER: RangePreset[] = [
  'all',
  '7d',
  '30d',
  '90d',
  'this-month',
  'last-month',
  'custom',
];

/** Parse an ISO timestamp to epoch ms, or null when missing/unparseable. */
function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Start of a yyyy-mm-dd date at 00:00 UTC, or null when unparseable. */
function dayStartUtc(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const t = Date.parse(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(t) ? null : t;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve a preset (plus optional custom bounds) against an anchor timestamp into
 * a concrete `[from, to)` interval. The anchor is normally `data.generated_at`.
 */
export function resolveRange(
  preset: RangePreset,
  anchorIso: string | null | undefined,
  custom?: CustomBounds,
): DateRange {
  const anchor = toMs(anchorIso) ?? Date.now();

  switch (preset) {
    case 'all':
      return { preset, from: null, to: null };

    case '7d':
      return { preset, from: anchor - 7 * DAY_MS, to: anchor };
    case '30d':
      return { preset, from: anchor - 30 * DAY_MS, to: anchor };
    case '90d':
      return { preset, from: anchor - 90 * DAY_MS, to: anchor };

    case 'this-month': {
      const d = new Date(anchor);
      const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      const to = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      return { preset, from, to };
    }
    case 'last-month': {
      const d = new Date(anchor);
      const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
      const to = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      return { preset, from, to };
    }

    case 'custom': {
      const from = dayStartUtc(custom?.fromDate);
      // Custom `to` is inclusive of the chosen day, so advance to the next day's
      // 00:00 UTC to keep the interval half-open like every other preset.
      const toStart = dayStartUtc(custom?.toDate);
      const to = toStart == null ? null : toStart + DAY_MS;
      return { preset, from, to };
    }
  }
}

/** True when the range imposes no bounds (shows everything, including undatable calls). */
export function isUnbounded(range: DateRange): boolean {
  return range.from == null && range.to == null;
}

/**
 * Filter call rows to a resolved range. An unbounded range returns the rows
 * untouched (so undatable calls, which have no `ts`, are kept). A bounded range
 * keeps only calls whose `ts` parses and falls in `[from, to)`; undatable calls
 * are necessarily excluded from a dated window.
 */
export function filterCalls(calls: CallRow[], range: DateRange): CallRow[] {
  if (isUnbounded(range)) return calls;
  const { from, to } = range;
  return calls.filter((c) => {
    const t = toMs(c.ts);
    if (t == null) return false;
    if (from != null && t < from) return false;
    if (to != null && t >= to) return false;
    return true;
  });
}
