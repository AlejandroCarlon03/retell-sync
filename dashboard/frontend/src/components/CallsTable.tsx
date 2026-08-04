/**
 * Per-call detail table — **after-hours calls only** (this dashboard exists to
 * monitor the after-hours agent, so business-hours calls are filtered out).
 * Sortable by time and by expected revenue (nulls always sort last, regardless
 * of direction). Every null renders as an em dash. The last column deep-links
 * each call to its Retell transcript and, when the caller is a known CRM client,
 * to their Odoo lead.
 */
import { useMemo, useState } from 'react';

import type { CallRow, ConversionLinks } from '../types/conversion';
import {
  EMPTY,
  fillTemplate,
  formatCurrency,
  formatDateTime,
  outcomeLabel,
} from '../lib/format';
import { InfoTip } from './InfoTip';

type SortKey = 'ts' | 'expected_revenue';
type SortDir = 'asc' | 'desc';

/** Comparator that always pushes null/undefined to the end. */
function compare(a: number | string | null, b: number | string | null, dir: SortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const base = a < b ? -1 : a > b ? 1 : 0;
  return dir === 'asc' ? base : -base;
}

export function CallsTable({
  calls,
  links,
}: {
  calls: CallRow[];
  links?: ConversionLinks;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('ts');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // After-hours only: business-hours (false) and undatable (null) calls are the
  // "business section" the dashboard deliberately leaves out.
  const afterHours = useMemo(() => calls.filter((c) => c.after_hours === true), [calls]);

  const sorted = useMemo(() => {
    return [...afterHours].sort((x, y) => compare(x[sortKey], y[sortKey], sortDir));
  }, [afterHours, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <section className="card" aria-label="After-hours calls">
      <div className="card-head">
        <h2>After-hours calls</h2>
        <div className="card-head-right">
          <span className="card-note">{afterHours.length} rows</span>
          <InfoTip text="Every after-hours call in the window, newest first — business-hours calls are left out. The Links column opens the call's transcript in Retell and, for callers already in our CRM, their lead in Odoo." />
        </div>
      </div>
      <div className="table-scroll">
        <table className="calls-table">
          <thead>
            <tr>
              <th>
                <button type="button" className="sort-btn" onClick={() => toggleSort('ts')}>
                  Time{arrow('ts')}
                </button>
              </th>
              <th>Phone</th>
              <th>Lead</th>
              <th>Stage</th>
              <th className="num">
                <button
                  type="button"
                  className="sort-btn"
                  onClick={() => toggleSort('expected_revenue')}
                >
                  Revenue{arrow('expected_revenue')}
                </button>
              </th>
              <th>Outcome</th>
              <th>Links</th>
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
                  <td>{formatDateTime(c.ts)}</td>
                  <td className="mono">{c.phone_key ?? EMPTY}</td>
                  <td>{c.matched ? (c.lead_name ?? EMPTY) : EMPTY}</td>
                  <td>{c.stage_label ?? EMPTY}</td>
                  <td className="num">{formatCurrency(c.expected_revenue)}</td>
                  <td>
                    <span className={`tag tag-outcome-${outcomeLabel(c.is_won, c.is_lost)}`}>
                      {outcomeLabel(c.is_won, c.is_lost)}
                    </span>
                  </td>
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
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
