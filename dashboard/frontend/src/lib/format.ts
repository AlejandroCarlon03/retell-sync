/**
 * Display formatting helpers — the single place where the payload's nullable /
 * tri-state fields become human-readable text. Every helper is null-safe and
 * renders "missing" as an em dash (never "null"/"NaN"/"undefined").
 */

/** Em dash used for every absent value. */
export const EMPTY = '—';

/** Currency in whole dollars (e.g. 3849 → "$3,849"). Null → em dash. */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

/** A `0..1` fraction as a percent (e.g. 0.1212 → "12.1%"). Null → em dash. */
export function formatPercent(fraction: number | null | undefined, digits = 1): string {
  if (fraction == null || !Number.isFinite(fraction)) return EMPTY;
  return fraction.toLocaleString(undefined, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Plain integer with thousands separators. Null → em dash. */
export function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  return Math.round(value).toLocaleString();
}

/** ISO-8601 → local date+time. Empty/unparseable → em dash / the raw string. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Seconds → "m:ss" (e.g. 125.4 → "2:05"). Null → em dash. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return EMPTY;
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Tri-state after-hours flag → label. null (undatable) is its own state. */
export function afterHoursLabel(flag: boolean | null | undefined): string {
  if (flag == null) return 'unknown';
  return flag ? 'after-hours' : 'business';
}

/** The funnel/outcome label for a call row. */
export function outcomeLabel(isWon: boolean, isLost: boolean): string {
  if (isWon) return 'won';
  if (isLost) return 'lost';
  return 'open';
}
