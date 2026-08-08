/**
 * Won revenue over time — the money companion to the daily-volume TrendChart, drawn
 * in the same trend-graticule grammar: a dashed --grid graticule under a hairline
 * --axis, tabular readout numerals on both axes, a dashed --tick cursor, and the one
 * sanctioned popover tooltip (real elevation via --shadow-2). The area is stacked
 * into the fixed categorical pair — after-hours in steel-blue (--series-after over
 * --series-after-soft) and business-hours in brass-amber (--series-business over
 * --series-business-soft) — so both identity hues are correct here.
 *
 * A segmented instrument-key control retimes the buckets between Day / Week / Month
 * (default Day); the selected key depresses into an inset panel with the graphite
 * --tick nub (never the witness red), and each key carries its neutral bucket count.
 *
 * Correctness is the headline: the buckets come from `buildRevenueSeries`, whose
 * totals reconcile exactly to the KPIs (total area ↔ kpis.won_revenue, after-hours
 * channel ↔ kpis.after_hours_won_revenue). Any won revenue that can't sit on a time
 * axis (an undated won lead) is held out and surfaced as a "+ $X undated" note, so
 * the "totals equal the KPI totals" promise stays honest rather than under-counting.
 * Every figure a user reads is real text, per the Measured-Numeral Rule — the chart
 * is the illustration, not the source of truth.
 */
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { CallRow } from '../types/conversion';
import type { RevenueGranularity, RevenuePoint } from '../lib/series';
import { buildRevenueSeries } from '../lib/series';
import { formatCount, formatCurrency } from '../lib/format';
import { InfoTip } from './InfoTip';

const GRANULARITIES: { key: RevenueGranularity; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

/** Compact whole-dollar axis tick (e.g. 12000 → "$12k"). */
function formatAxisDollars(value: number): string {
  if (value === 0) return '$0';
  if (Math.abs(value) >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

function renderTooltip(row: RevenuePoint | undefined) {
  if (!row) return null;
  const total = row.after + row.business;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{row.label}</div>
      <div>{formatCurrency(total)} won</div>
      <div>
        <span className="swatch swatch-after" /> {formatCurrency(row.after)} after-hours
      </div>
      <div>
        <span className="swatch swatch-business" /> {formatCurrency(row.business)} business
      </div>
    </div>
  );
}

export function RevenueTrendChart({ calls }: { calls: CallRow[] }) {
  const [granularity, setGranularity] = useState<RevenueGranularity>('day');

  // All three granularities up front, so each key can wear its live bucket count.
  const series = useMemo(
    () => ({
      day: buildRevenueSeries(calls, 'day'),
      week: buildRevenueSeries(calls, 'week'),
      month: buildRevenueSeries(calls, 'month'),
    }),
    [calls],
  );

  const active = series[granularity];
  const { points, undated, plotted } = active;

  const undatedNote =
    undated > 0 ? (
      <p className="card-note revenue-undated">
        + {formatCurrency(undated)} won revenue is undated and can’t be placed on the
        timeline; it is not drawn above but is counted in the KPI total.
      </p>
    ) : null;

  return (
    <section className="card" aria-label="Won revenue over time">
      <div className="card-head">
        <h2>Won revenue over time</h2>
        <InfoTip text="Won expected revenue over the active window, split into after-hours and business-hours. Each lead's value is counted once (deduped like the KPIs), so the bars sum to the same won-revenue total shown in the tiles. Bucketed by UTC day, ISO week (Mon), or calendar month." />
      </div>
      <p className="card-note">After-hours vs business-hours won revenue, by {granularity}.</p>

      <div
        className="segmented revenue-granularity"
        role="tablist"
        aria-label="Revenue aggregation"
      >
        {GRANULARITIES.map((g) => (
          <button
            key={g.key}
            type="button"
            role="tab"
            aria-selected={granularity === g.key}
            className={`seg${granularity === g.key ? ' active' : ''}`}
            onClick={() => setGranularity(g.key)}
          >
            {g.label}
            <span className="seg-count">{formatCount(series[g.key].points.length)}</span>
          </button>
        ))}
      </div>

      {points.length < 2 ? (
        <p className="card-empty-note">
          {plotted > 0 || undated > 0
            ? `Only one ${granularity} of won revenue in this window — not enough to trace a trend. Try a finer aggregation.`
            : 'No won revenue in this window yet.'}
        </p>
      ) : (
        <div className="chart-scroll">
          <ResponsiveContainer width="100%" height={240} minWidth={320}>
            <AreaChart data={points} margin={{ top: 6, right: 18, bottom: 4, left: 2 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="2 4" />
              <XAxis
                dataKey="label"
                stroke="var(--axis)"
                tick={{ fill: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-numeric)' }}
                tickLine={{ stroke: 'var(--axis)' }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                stroke="var(--axis)"
                tick={{ fill: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-numeric)' }}
                tickLine={{ stroke: 'var(--axis)' }}
                tickFormatter={formatAxisDollars}
                width={52}
              />
              <Tooltip
                cursor={{ stroke: 'var(--tick)', strokeWidth: 1, strokeDasharray: '2 3' }}
                content={({ active: on, payload }) => {
                  if (!on || !payload || payload.length === 0) return null;
                  return renderTooltip(payload[0]?.payload as RevenuePoint | undefined);
                }}
              />
              <Area
                type="linear"
                dataKey="after"
                stackId="revenue"
                stroke="var(--series-after)"
                strokeWidth={2.25}
                fill="var(--series-after-soft)"
                isAnimationActive={false}
              />
              <Area
                type="linear"
                dataKey="business"
                stackId="revenue"
                stroke="var(--series-business)"
                strokeWidth={2.25}
                fill="var(--series-business-soft)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="legend revenue-legend">
        <span className="legend-item">
          <span className="swatch swatch-after" /> After-hours
        </span>
        <span className="legend-item">
          <span className="swatch swatch-business" /> Business-hours
        </span>
      </div>
      {undatedNote}
    </section>
  );
}
