/**
 * Client-side export helpers. The dashboard is read-only and served either from
 * the Photino host or a static IIS bundle, so exports are produced entirely in
 * the browser from data already in memory — no backend round-trip.
 *
 * `toCsv` serializes the calls table to RFC 4180 CSV: fields containing a comma,
 * quote, or newline are wrapped in double quotes with interior quotes doubled.
 * Values are exported RAW (ISO timestamp, numeric revenue) rather than in their
 * on-screen display form, because a CSV is meant to be re-analyzed in a
 * spreadsheet — "$3,849" and "Aug 4, 2026, 2:03 PM" are worse inputs there than
 * `3849` and `2026-08-04T21:03:00Z`.
 */
import type { CallRow, ConversionLinks } from '../types/conversion';
import type { DateRange } from './dateRange';
import { fillTemplate, outcomeLabel } from './format';

/** UTF-8 byte-order mark, so Excel opens accented names as UTF-8, not mojibake. */
const BOM = '﻿';

/** Column order of the exported CSV — mirrors the calls table, plus deep links. */
const CSV_HEADER = [
  'Time',
  'Phone',
  'Lead',
  'Stage',
  'Sales Rep',
  'Revenue',
  'Outcome',
  'Matched',
  'Retell URL',
  'Odoo URL',
] as const;

/** Quote a single field only when RFC 4180 requires it, doubling interior quotes. */
function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** One CSV row (array of raw string cells) for a call. */
function callToCells(call: CallRow, links?: ConversionLinks): string[] {
  const retellUrl = fillTemplate(links?.retell_call, 'call_id', call.call_id) ?? '';
  const odooUrl = call.matched
    ? (fillTemplate(links?.odoo_lead, 'lead_id', call.lead_id) ?? '')
    : '';
  return [
    call.ts ?? '',
    call.phone_key ?? '',
    call.matched ? (call.lead_name ?? '') : '',
    call.stage_label ?? '',
    call.sales_rep ?? '',
    call.expected_revenue == null ? '' : String(call.expected_revenue),
    outcomeLabel(call.is_won, call.is_lost),
    call.matched ? 'yes' : 'no',
    retellUrl,
    odooUrl,
  ];
}

/**
 * Serialize call rows to a CSV string (header + one row per call). Rows are
 * emitted in the order given, so callers pass the already-filtered/sorted rows
 * they want the file to contain. Lines are CRLF-terminated per RFC 4180.
 */
export function toCsv(rows: CallRow[], links?: ConversionLinks): string {
  const lines = [CSV_HEADER.map(escapeCsv).join(',')];
  for (const row of rows) {
    lines.push(callToCells(row, links).map(escapeCsv).join(','));
  }
  return lines.join('\r\n');
}

/** A resolved epoch-ms bound → `yyyy-mm-dd` (UTC). */
function dayUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Build a descriptive download filename from the active date range, e.g.
 * `calls_2026-07-01_2026-07-31.csv`, or `calls_all-time.csv` when unbounded.
 * The range's `to` bound is exclusive, so it is nudged back a day to name the
 * last included calendar day.
 */
export function csvFilename(base: string, range?: DateRange): string {
  if (!range || (range.from == null && range.to == null)) {
    return `${base}_all-time.csv`;
  }
  const from = range.from == null ? '' : dayUtc(range.from);
  const to = range.to == null ? '' : dayUtc(range.to - 1);
  return `${base}_${from}_${to}.csv`;
}

/**
 * Trigger a browser download of in-memory text. Prepends a UTF-8 BOM for CSV so
 * Excel opens accented names correctly. Uses an object URL and a synthetic
 * anchor click, revoking the URL afterward.
 */
export function downloadText(filename: string, mime: string, text: string): void {
  const body = mime.startsWith('text/csv') ? BOM + text : text;
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
