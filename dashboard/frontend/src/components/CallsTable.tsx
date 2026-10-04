/**
 * Per-call detail table, driven by a `mode` filter so the same component serves
 * both the After-Hours page (mode 'after' — the default) and the All-Calls page
 * (mode 'all' / 'business' / 'unmatched'). Sortable by time and by expected
 * revenue (nulls always sort last, regardless of direction). Every null renders
 * as an em dash. The caller column reads as name over number; the last column
 * deep-links each call to its Retell transcript and, when the caller is a known
 * CRM client, to their Odoo lead.
 */
import { useMemo, useState, type ReactNode } from 'react';

import type { CallRow, ConversionLinks } from '../types/conversion';
import type { DateRange } from '../lib/dateRange';
import { csvFilename, downloadText, toCsv } from '../lib/export';
import {
  EMPTY,
  fillTemplate,
  formatCurrency,
  formatPhone,
  formatShortDateTime,
  humanizeReason,
  outcomeLabel,
} from '../lib/format';
import { InfoTip } from './InfoTip';

type SortKey = 'ts' | 'expected_revenue';
type SortDir = 'asc' | 'desc';

/** Which slice of calls the table shows. */
export type CallsFilterMode = 'after' | 'business' | 'all' | 'matched' | 'unmatched';

const DEFAULT_INFO =
  "Calls in the window, newest first. The Links column opens the call's transcript in Retell and, for callers already in our CRM, their lead in Odoo.";

/**
 * The outcome stamp struck onto each logged row: an icon paired with the word so
 * won / lost / open never rely on colour alone (the bench's status rule). One
 * consistent 2px round stroke; the mark is aria-hidden since the word is real text.
 */
function OutcomeMark({ outcome }: { outcome: string }) {
  return (
    <svg
      className="tag-mark"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {outcome === 'won' && <path d="M20 6 9 17l-5-5" />}
      {outcome === 'lost' && (
        <>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </>
      )}
      {outcome === 'open' && <circle cx="12" cy="12" r="7" />}
    </svg>
  );
}

/** Apply the filter mode. 'all' keeps every call; the rest narrow it. */
function applyMode(calls: CallRow[], mode: CallsFilterMode): CallRow[] {
  switch (mode) {
    case 'all':
      return calls;
    case 'business':
      return calls.filter((c) => c.after_hours === false);
    case 'matched':
      return calls.filter((c) => c.matched);
    case 'unmatched':
      return calls.filter((c) => !c.matched);
    case 'after':
    default:
      return calls.filter((c) => c.after_hours === true);
  }
}

/** Comparator that always pushes null/undefined to the end. */
function compare(a: number | string | null, b: number | string | null, dir: SortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const base = a < b ? -1 : a > b ? 1 : 0;
  return dir === 'asc' ? base : -base;
}

/**
 * Match a call against a free-text query. A caller can be found by name or by
 * phone: name matching is a case-insensitive substring; phone matching compares
 * digits only, so "(602) 448" and "602448" both hit the same number.
 */
function matchesQuery(call: CallRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = call.lead_name?.toLowerCase() ?? '';
  if (name.includes(q)) return true;
  const qDigits = q.replace(/\D/g, '');
  if (qDigits && (call.phone_key ?? '').includes(qDigits)) return true;
  return false;
}

export function CallsTable({
  calls,
  links,
  mode = 'after',
  heading = 'After-hours calls',
  infoText = DEFAULT_INFO,
  range,
  exportName = 'calls',
  showQuality = false,
  leadColumns = true,
  filters,
}: {
  calls: CallRow[];
  links?: ConversionLinks;
  mode?: CallsFilterMode;
  heading?: string;
  infoText?: string;
  /** Active date range, used only to name the exported file. */
  range?: DateRange;
  /** Base name for the exported CSV file (before the date-range suffix). */
  exportName?: string;
  /**
   * Show the per-call Sentiment column. Off by default so the After-Hours table
   * stays narrow; the All Calls page turns it on to expose the raw call-quality
   * signal alongside the funnel outcome. (The disconnection "Ending" column was
   * dropped — user vs agent hangup wasn't worth the width, and it clipped under
   * the pinned Links column.)
   */
  showQuality?: boolean;
  /**
   * Show the lead's Stage, Sales rep, Revenue and Outcome. Off for a list of
   * callers who aren't in the CRM (Follow-ups' unmatched bucket), where every one
   * of those cells would be an em dash.
   */
  leadColumns?: boolean;
  /** A filter control (e.g. a SegmentedControl) seated first in the toolbar. */
  filters?: ReactNode;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('ts');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => applyMode(calls, mode), [calls, mode]);

  const searched = useMemo(
    () => visible.filter((c) => matchesQuery(c, query)),
    [visible, query],
  );

  const sorted = useMemo(() => {
    return [...searched].sort((x, y) => compare(x[sortKey], y[sortKey], sortDir));
  }, [searched, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : '');

  /** `aria-sort` for a column caption — 'none' unless it is the active sort key. */
  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey !== key ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending';

  /** What activating the caption will do next, spoken for screen readers. The
   *  caret is aria-hidden, so without this the control announces only its label. */
  const sortAction = (key: SortKey, label: string) =>
    sortKey === key && sortDir === 'desc'
      ? `${label}, sorted descending. Activate to sort ascending.`
      : sortKey === key
        ? `${label}, sorted ascending. Activate to sort descending.`
        : `Sort by ${label.toLowerCase()}`;

  const isSearching = query.trim().length > 0;

  /** Export exactly the rows on screen (current mode + search + sort order). */
  function handleExport() {
    if (sorted.length === 0) return;
    downloadText(csvFilename(exportName, range), 'text/csv;charset=utf-8', toCsv(sorted, links));
  }

  return (
    <section className="card" aria-label={heading}>
      <div className="card-head">
        <h2>{heading}</h2>
        <div className="card-head-right">
          <span className="table-count">
            {isSearching ? `${sorted.length} of ${visible.length} rows` : `${visible.length} rows`}
          </span>
          <InfoTip text={infoText} label={heading.toLowerCase()} />
        </div>
      </div>
      <div className="table-toolbar">
        {filters}
        <div className="search-field">
          <svg
            className="search-icon"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="search-input"
            placeholder="Search by name or phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search calls by name or phone number"
          />
        </div>
        <button
          type="button"
          className="btn table-export"
          onClick={handleExport}
          disabled={sorted.length === 0}
          title={
            sorted.length === 0
              ? 'No calls to export'
              : `Download the ${sorted.length} calls shown as a CSV file`
          }
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export CSV
        </button>
      </div>
      <div className="table-scroll" tabIndex={0} role="group" aria-label={`${heading} — scrollable table`}>
        <table className="calls-table">
          <thead>
            <tr>
              <th scope="col" aria-sort={ariaSort('ts')}>
                <button
                  type="button"
                  className={`sort-btn${sortKey === 'ts' ? ' sort-active' : ''}`}
                  onClick={() => toggleSort('ts')}
                  aria-label={sortAction('ts', 'Time')}
                >
                  Time
                  <span className="sort-caret" aria-hidden="true">
                    {arrow('ts')}
                  </span>
                </button>
              </th>
              <th scope="col">Caller</th>
              {leadColumns && <th scope="col">Stage</th>}
              {leadColumns && <th scope="col">Sales rep</th>}
              {leadColumns && (
                <th className="num" scope="col" aria-sort={ariaSort('expected_revenue')}>
                  <button
                    type="button"
                    className={`sort-btn${sortKey === 'expected_revenue' ? ' sort-active' : ''}`}
                    onClick={() => toggleSort('expected_revenue')}
                    aria-label={sortAction('expected_revenue', 'Revenue')}
                  >
                    Revenue
                    <span className="sort-caret" aria-hidden="true">
                      {arrow('expected_revenue')}
                    </span>
                  </button>
                </th>
              )}
              {leadColumns && <th scope="col">Outcome</th>}
              {showQuality && <th scope="col">Sentiment</th>}
              <th scope="col">Links</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const retellUrl = fillTemplate(links?.retell_call, 'call_id', c.call_id);
              const odooUrl = c.matched
                ? fillTemplate(links?.odoo_lead, 'lead_id', c.lead_id)
                : null;
              return (
                <tr key={c.call_id}>
                  <td className="cell-ts">{formatShortDateTime(c.ts)}</td>
                  <td className="cell-caller">
                    {c.matched && c.lead_name ? (
                      <span className="caller-name" title={c.lead_name}>
                        {c.lead_name}
                      </span>
                    ) : (
                      <span className="caller-name caller-unknown">Not in CRM</span>
                    )}
                    <span className="caller-phone">{formatPhone(c.phone_key)}</span>
                  </td>
                  {leadColumns && (
                    <td className="cell-clip" title={c.stage_label ?? undefined}>
                      {c.stage_label ?? EMPTY}
                    </td>
                  )}
                  {leadColumns && (
                    <td className="cell-clip" title={c.sales_rep ?? undefined}>
                      {c.sales_rep ?? EMPTY}
                    </td>
                  )}
                  {leadColumns && <td className="num">{formatCurrency(c.expected_revenue)}</td>}
                  {leadColumns && (
                    <td>
                      {(() => {
                        const o = outcomeLabel(c.is_won, c.is_lost);
                        return (
                          <span className={`tag tag-outcome-${o}`}>
                            <OutcomeMark outcome={o} />
                            {o}
                          </span>
                        );
                      })()}
                    </td>
                  )}
                  {showQuality && <td>{humanizeReason(c.sentiment)}</td>}
                  <td>
                    <span className="row-links">
                      {retellUrl ? (
                        <a
                          className="link-btn"
                          href={retellUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Open this call's transcript in Retell"
                        >
                          Retell
                        </a>
                      ) : (
                        <span className="link-btn link-btn-disabled">Retell</span>
                      )}
                      {odooUrl ? (
                        <a
                          className="link-btn"
                          href={odooUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Open this caller's lead in Odoo CRM"
                        >
                          Odoo
                        </a>
                      ) : (
                        <span
                          className="link-btn link-btn-disabled"
                          title={c.matched ? 'Odoo web URL not configured' : 'Caller is not in the CRM'}
                        >
                          Odoo
                          <span className="visually-hidden">
                            {c.matched ? ' (link not configured)' : ' (not in the CRM)'}
                          </span>
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td
                  className="table-empty"
                  colSpan={3 + (leadColumns ? 4 : 0) + (showQuality ? 1 : 0)}
                >
                  {isSearching ? `No calls match “${query.trim()}”.` : 'No calls to show.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
