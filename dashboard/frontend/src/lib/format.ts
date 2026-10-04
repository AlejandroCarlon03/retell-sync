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

/**
 * A cost figure, where cents matter: agent spend runs to cents per call, so whole
 * dollars would read "$0" (e.g. 0.19 → "$0.19", 91.04 → "$91.04"); at $1,000 and up
 * the cents are noise and it rounds like `formatCurrency`. Null → em dash.
 */
export function formatCost(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  const cents = Math.abs(value) < 1000;
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
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

/**
 * ISO-8601 → local "Oct 2, 2026, 4:39 PM": the one date-time style the dashboard
 * uses for a moment in time. Empty/unparseable → em dash / the raw string.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * ISO-8601 → compact local "Oct 2, 4:39 PM" for dense columns, adding the year
 * only when it isn't the current one. Empty/unparseable → em dash / raw string.
 */
export function formatShortDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * A North American number as "(480) 555-0123". Accepts the payload's 10-digit
 * phone key or a raw/E.164 string; anything that isn't 10 digits (after dropping a
 * leading 1) is returned as given. Null/blank → em dash.
 */
export function formatPhone(value: string | number | null | undefined): string {
  if (value == null || value === '') return EMPTY;
  const raw = String(value);
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return raw;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** A raw lowercase label (e.g. an Odoo funnel stage "proposition") → "Proposition". */
export function titleCase(value: string | null | undefined): string {
  if (!value) return EMPTY;
  return value.replace(
    /(^|[\s/-])(\p{Ll})/gu,
    (_, sep: string, ch: string) => sep + ch.toUpperCase(),
  );
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * A UTC calendar day ("2026-07-24" or a full ISO timestamp) → "Jul 24, 2026".
 * Parsed from the ISO parts, never `new Date()`, so a day bucketed in UTC never
 * shifts across the viewer's timezone. Empty/unparseable → em dash / raw string.
 */
export function formatUtcDay(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  return `${MONTHS_SHORT[m - 1]} ${d}, ${y}`;
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

/**
 * A raw snake/kebab identifier → sentence-case words (e.g. "voicemail_reached" →
 * "Voicemail reached"). Used for the call's disconnection reason and sentiment in
 * the calls table. Null/blank → em dash.
 */
export function humanizeReason(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const words = value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return EMPTY;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Fill a `{placeholder}` URL template with an id, or return null when either the
 * template or the id is missing — so callers can render a link only when both a
 * destination and a target exist.
 */
export function fillTemplate(
  template: string | null | undefined,
  placeholder: string,
  value: string | number | null | undefined,
): string | null {
  if (!template || value == null) return null;
  return template.replace(`{${placeholder}}`, encodeURIComponent(String(value)));
}
