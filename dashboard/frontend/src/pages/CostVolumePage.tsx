/**
 * Cost & volume overview, computed client-side from the same by_call rows the
 * rest of the dashboard uses (cost is in dollars). Headline spend/volume tiles
 * plus a per-day table splitting after-hours vs business-hours volume. A fuller
 * version (duration distribution, outcome breakdown, trend chart) is Tier-2.
 */
import { useMemo } from 'react';

import { InfoTip } from '../components/InfoTip';
import { PageFoot } from '../components/PageFoot';
import { RevenueTrendChart } from '../components/RevenueTrendChart';
import { TrendChart } from '../components/TrendChart';
import { NO_CALLS, useFilteredData } from '../hooks/useFilteredData';
import { buildDailySeries } from '../lib/series';
import { EMPTY, formatCost, formatCount, formatCurrency, formatUtcDay } from '../lib/format';

interface DayRow {
  date: string;
  calls: number;
  after: number;
  cost: number;
}

/** Group calls by UTC calendar date, newest first. */
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
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** How many recent days the volume table lists. */
const RECENT_DAYS = 21;

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
  // DKB's Retell line is the after-hours line, so the after-hours column only
  // earns its place when some calls were business-hours.
  const splitDays = days.some((d) => d.after !== d.calls);
  // The table lists the most recent days; the per-day KPI uses every day.
  const recentDays = days.slice(0, RECENT_DAYS);
  const wonRevenue = data?.kpis.after_hours_won_revenue ?? 0;
  const series = useMemo(() => buildDailySeries(calls), [calls]);

  if (!data) return null;

  return (
    <>
      <section className="kpi-bench" aria-label="Cost and volume">
        <div className="kpi-cell">
          <div className="kpi-label">Agent cost</div>
          <div className="kpi-value">{formatCost(stats.totalCost)}</div>
          <div className="kpi-sub">across {formatCount(stats.calls)} calls</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Cost per call</div>
          <div className="kpi-value">{formatCost(stats.avgCost)}</div>
          <div className="kpi-sub">average, all calls in window</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Calls per day</div>
          <div className="kpi-value">
            {days.length > 0 ? (stats.calls / days.length).toFixed(1) : EMPTY}
          </div>
          <div className="kpi-sub">over {formatCount(days.length)} days with calls</div>
        </div>
        <div className="kpi-cell">
          <InfoTip
            label="won per $1 of agent cost"
            text="Won revenue from after-hours callers divided by the agent's cost in this window. Counts revenue already won, not open pipeline."
          />
          <div className="kpi-label">Won per $1 of cost</div>
          <div className="kpi-value">
            {formatCurrency(stats.totalCost > 0 ? wonRevenue / stats.totalCost : null)}
          </div>
          <div className="kpi-sub">{formatCurrency(wonRevenue)} won</div>
        </div>
      </section>

      {series.length > 1 && <TrendChart series={series} range={range} />}

      <RevenueTrendChart calls={calls} range={range} />

      <section className="card" aria-label="Volume by day">
        <div className="card-head">
          <h2>Volume by day</h2>
          <span className="table-count">
            {days.length > RECENT_DAYS
              ? `latest ${RECENT_DAYS} of ${formatCount(days.length)} days with calls`
              : `${formatCount(days.length)} days with calls`}
          </span>
        </div>
        <div className="table-scroll" tabIndex={0} role="group" aria-label="Volume by day — scrollable table">
          <table className="calls-table">
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">Calls</th>
                {splitDays && <th className="num">After-hours</th>}
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {recentDays.map((d) => (
                <tr key={d.date}>
                  <td className="cell-ts">{formatUtcDay(d.date)}</td>
                  <td className="num">{formatCount(d.calls)}</td>
                  {splitDays && <td className="num">{formatCount(d.after)}</td>}
                  <td className="num">{formatCost(d.cost)}</td>
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
