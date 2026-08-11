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
 * The date-range portion of a download name: `2026-07-01_2026-07-31` for a
 * bounded range (the exclusive `to` bound nudged back a day to name the last
 * included calendar day), or `all-time` when unbounded.
 */
function rangeStem(range?: DateRange): string {
  if (!range || (range.from == null && range.to == null)) {
    return 'all-time';
  }
  const from = range.from == null ? '' : dayUtc(range.from);
  const to = range.to == null ? '' : dayUtc(range.to - 1);
  return `${from}_${to}`;
}

/**
 * Build a descriptive CSV filename from the active date range, e.g.
 * `calls_2026-07-01_2026-07-31.csv`, or `calls_all-time.csv` when unbounded.
 */
export function csvFilename(base: string, range?: DateRange): string {
  return `${base}_${rangeStem(range)}.csv`;
}

/** Like {@link csvFilename}, but for the PNG chart exports. */
export function pngFilename(base: string, range?: DateRange): string {
  return `${base}_${rangeStem(range)}.png`;
}

/**
 * Trigger a browser download of an in-memory Blob via an object URL and a
 * synthetic anchor click, revoking the URL afterward.
 */
export function downloadBlob(filename: string, blob: Blob): void {
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

/**
 * Trigger a browser download of in-memory text. Prepends a UTF-8 BOM for CSV so
 * Excel opens accented names correctly.
 */
export function downloadText(filename: string, mime: string, text: string): void {
  const body = mime.startsWith('text/csv') ? BOM + text : text;
  downloadBlob(filename, new Blob([body], { type: mime }));
}

// --------------------------------------------------------------------------- //
//  Chart (SVG) → PNG export                                                    //
// --------------------------------------------------------------------------- //

/**
 * Paint properties copied off the live DOM onto the SVG clone. The charts colour
 * themselves with CSS custom properties (`var(--series-after)`, `var(--grid)`, …)
 * applied through classes and presentation attributes; those resolve only inside
 * the live document. `getComputedStyle` returns the already-resolved literals, so
 * copying these onto the detached clone makes it self-contained and paint the same
 * when rasterized.
 */
const PAINT_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
] as const;

/** Copy resolved paint styles from each source node onto the matching clone node. */
function inlineComputedStyles(source: Element, clone: Element): void {
  const cs = window.getComputedStyle(source);
  let style = clone.getAttribute('style') ?? '';
  for (const prop of PAINT_PROPS) {
    const value = cs.getPropertyValue(prop);
    if (value) style += `${prop}:${value};`;
  }
  clone.setAttribute('style', style);

  const sourceChildren = source.children;
  const cloneChildren = clone.children;
  for (let i = 0; i < sourceChildren.length; i += 1) {
    inlineComputedStyles(sourceChildren[i], cloneChildren[i]);
  }
}

export interface SvgToPngOptions {
  /** Device-pixel multiplier for a crisp raster (default 2). */
  scale?: number;
  /** Solid background painted under the chart (default transparent). */
  background?: string;
  /** Optional heading drawn above the chart, with its colour/font. */
  title?: { text: string; color: string; font: string };
}

/**
 * Rasterize a live `<svg>` chart to a PNG Blob. The source SVG is cloned, its
 * computed paint styles are inlined (so CSS-variable colours survive), it is
 * serialized to a data URL, drawn onto a `<canvas>` at `scale`, and encoded as
 * PNG. An optional solid background and title band are drawn first. Never mutates
 * the live SVG. Rejects if the browser can't load the serialized SVG or encode
 * the canvas.
 */
export async function svgToPng(svg: SVGSVGElement, options: SvgToPngOptions = {}): Promise<Blob> {
  const { scale = 2, background, title } = options;

  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || svg.clientWidth || 320));
  const height = Math.max(1, Math.round(rect.height || svg.clientHeight || 240));
  const titleBand = title ? 34 : 0;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineComputedStyles(svg, clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const xml = new XMLSerializer().serializeToString(clone);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;

  const image = new Image();
  image.width = width;
  image.height = height;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Failed to load chart SVG for export'));
    image.src = svgUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = (height + titleBand) * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.scale(scale, scale);

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height + titleBand);
  }
  if (title) {
    ctx.fillStyle = title.color;
    ctx.font = title.font;
    ctx.textBaseline = 'middle';
    ctx.fillText(title.text, 4, titleBand / 2);
  }
  ctx.drawImage(image, 0, titleBand, width, height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode chart PNG'))),
      'image/png',
    );
  });
}
