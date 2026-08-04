/**
 * Per-call detail table. Sortable by time and by expected revenue (nulls always
 * sort last, regardless of direction). Every null renders as an em dash, and an
 * undatable call's after-hours flag shows a neutral "unknown" — never "false".
 */
import { useMemo, useState } from 'react';

import type { CallRow } from '../types/conversion';
import {
  EMPTY,
  afterHoursLabel,
  formatCurrency,
  formatDateTime,
  outcomeLabel,
} from '../lib/format';

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

export function CallsTable({ calls }: { calls: CallRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('ts');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    return [...calls].sort((x, y) => compare(x[sortKey], y[sortKey], sortDir));
  }, [calls, sortKey, sortDir]);

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
    <section className="card" aria-label="Calls">
      <div className="card-head">
        <h2>Calls</h2>
        <span className="card-note">{calls.length} rows</span>
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
              <th>When</th>
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
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.call_id}>
                <td>{formatDateTime(c.ts)}</td>
                <td className="mono">{c.phone_key ?? EMPTY}</td>
                <td>
                  <span className={`tag tag-${c.after_hours == null ? 'unknown' : c.after_hours ? 'after' : 'business'}`}>
                    {afterHoursLabel(c.after_hours)}
                  </span>
                </td>
                <td>{c.matched ? (c.lead_name ?? EMPTY) : EMPTY}</td>
                <td>{c.stage_label ?? EMPTY}</td>
                <td className="num">{formatCurrency(c.expected_revenue)}</td>
                <td>
                  <span className={`tag tag-outcome-${outcomeLabel(c.is_won, c.is_lost)}`}>
                    {outcomeLabel(c.is_won, c.is_lost)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
