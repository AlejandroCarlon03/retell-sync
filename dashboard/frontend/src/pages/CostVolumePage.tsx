/**
 * Cost & volume overview, computed client-side from the same by_call rows the
 * rest of the dashboard uses (cost is in dollars). Headline spend/volume tiles
 * plus a per-day table splitting after-hours vs business-hours volume. A fuller
 * version (duration distribution, outcome breakdown, trend chart) is Tier-2.
 */
import { useMemo } from 'react';

import { PageFoot } from '../components/PageFoot';
import { RevenueTrendChart } from '../components/RevenueTrendChart';
import { TrendChart } from '../components/TrendChart';
import { NO_CALLS, useFilteredData } from '../hooks/useFilteredData';
import { buildDailySeries } from '../lib/series';
import { formatCount, formatCurrency } from '../lib/format';

interface DayRow {
  date: string;
  calls: number;
  after: number;
  cost: number;
}

/** Group calls by UTC calendar date, newest first, capped for readability. */
function byDay(calls: { ts: string | null; after_hours: boolean | null; cost: number | null }[]): DayRow[] {
  const map = new Map<string, DayRow>();
  for (const c of calls) {
    if (!c.ts) continue;
    const date = c.ts.slice(0, 10);
    const row = map.get(date) ?? { date, calls: 0, after: 0, cost: 0 };
    row.calls += 1;
    if (c.after_hours === true) row.after += 1;
    if (typeof c.cost === 'number' && Number.isFinite(c.cost)) row.cost += c.cost;
    map.set(date, row);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 21);
}

export function CostVolumePage() {
  const { data, range } = useFilteredData();
  const calls = data?.by_call ?? NO_CALLS;

  const stats = useMemo(() => {
    const totalCost = calls.reduce(
      (sum, c) => sum + (typeof c.cost === 'number' && Number.isFinite(c.cost) ? c.cost : 0),
      0,
    );
    const after = calls.filter((c) => c.after_hours === true);
    const afterCost = after.reduce(
      (sum, c) => sum + (typeof c.cost === 'number' && Number.isFinite(c.cost) ? c.cost : 0),
      0,
    );
    return {
      totalCost,
      afterCost,
      calls: calls.length,
      afterCalls: after.length,
      avgCost: calls.length > 0 ? totalCost / calls.length : 0,
    };
  }, [calls]);

  const days = useMemo(() => byDay(calls), [calls]);
  const series = useMemo(() => buildDailySeries(calls), [calls]);

  if (!data) return null;

  return (
    <>
      <section className="kpi-bench" aria-label="Cost and volume">
        <div className="kpi-cell">
          <div className="kpi-label">Total spend</div>
          <div className="kpi-value">{formatCurrency(stats.totalCost)}</div>
          <div className="kpi-sub">across {formatCount(stats.calls)} calls</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Avg $ / call</div>
          <div className="kpi-value">{formatCurrency(stats.avgCost)}</div>
          <div className="kpi-sub">all calls in window</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">After-hours spend</div>
          <div className="kpi-value">{formatCurrency(stats.afterCost)}</div>
          <div className="kpi-sub">{formatCount(stats.afterCalls)} after-hours calls</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Total calls</div>
          <div className="kpi-value">{formatCount(stats.calls)}</div>
          <div className="kpi-sub">{formatCount(stats.afterCalls)} after-hours</div>
        </div>
      </section>

      {series.length > 1 && <TrendChart series={series} range={range} />}

      <RevenueTrendChart calls={calls} range={range} />

      <section className="card" aria-label="Volume by day">
        <div className="card-head">
          <h2>Volume by day</h2>
          <span className="card-note">last {days.length} active days</span>
        </div>
        <div className="table-scroll" tabIndex={0} role="group" aria-label="Volume by day — scrollable table">
          <table className="calls-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Calls</th>
                <th className="num">After-hours</th>
                <th className="num">Spend</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}>
                  <td className="cell-ts">{d.date}</td>
                  <td className="num">{formatCount(d.calls)}</td>
                  <td className="num">{formatCount(d.after)}</td>
                  <td className="num">{formatCurrency(d.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <PageFoot />
    </>
  );
}
