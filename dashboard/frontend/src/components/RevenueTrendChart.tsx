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
import { useMemo, useRef, useState } from 'react';
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
import type { DateRange } from '../lib/dateRange';
import { buildRevenueSeries } from '../lib/series';
import { formatCurrency } from '../lib/format';
import { ChartDataTable } from './ChartDataTable';
import { ChartExportButton } from './ChartExportButton';
import { InfoTip } from './InfoTip';
import { SegmentedControl } from './SegmentedControl';

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

function renderTooltip(row: RevenuePoint | undefined, split: boolean) {
  if (!row) return null;
  const total = row.after + row.business;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{row.label}</div>
      <div>{formatCurrency(total)} won</div>
      {split && (
        <>
          <div>
            <span className="swatch swatch-after" /> {formatCurrency(row.after)} after-hours
          </div>
          <div>
            <span className="swatch swatch-business" /> {formatCurrency(row.business)} business
          </div>
        </>
      )}
    </div>
  );
}

export function RevenueTrendChart({ calls, range }: { calls: CallRow[]; range?: DateRange }) {
  const [granularity, setGranularity] = useState<RevenueGranularity>('day');
  const cardRef = useRef<HTMLElement>(null);

  // All three granularities up front, so each key can wear its live bucket count.
  const series = useMemo(
    () => ({
      day: buildRevenueSeries(calls, 'day'),
      week: buildRevenueSeries(calls, 'week'),
      month: buildRevenueSeries(calls, 'month'),
    }),
    [calls],
  );

  // The shared segmented control, carrying each bucket's live tally.
  const granularityOptions = useMemo(
    () => GRANULARITIES.map((g) => ({ ...g, count: series[g.key].points.length })),
    [series],
  );

  const active = series[granularity];
  const { points, undated, plotted } = active;
  // On DKB's after-hours line every call is after-hours, so a business-hours band
  // would be an empty series stroked over the real one. Split only when it exists.
  const split = points.some((p) => p.business > 0);

  const undatedNote =
    undated > 0 ? (
      <p className="card-note revenue-undated">
        + {formatCurrency(undated)} won revenue is undated and can’t be placed on the timeline; it
        is not drawn above but is counted in the KPI total.
      </p>
    ) : null;

  return (
    <section className="card" aria-label="Won revenue over time" ref={cardRef}>
      <div className="card-head">
        <h2>Won revenue over time</h2>
        <div className="card-head-right">
          <ChartExportButton
            targetRef={cardRef}
            name="won-revenue-over-time"
            title="Won revenue over time"
            range={range}
            disabled={points.length < 2}
          />
          <InfoTip
            label="won revenue over time"
            text="Revenue on won deals over the active window. Each lead's value is counted once (deduped like the KPIs), so the series sums to the won-revenue total on the home page. Bucketed by UTC day, ISO week (Mon), or calendar month."
          />
        </div>
      </div>
      <p className="card-note">
        {split ? 'After-hours vs business-hours won revenue' : 'Won revenue from after-hours callers'},
        by {granularity}.
      </p>

      <SegmentedControl
        className="revenue-granularity"
        ariaLabel="Revenue aggregation"
        value={granularity}
        onChange={setGranularity}
        options={granularityOptions}
      />

      {points.length < 2 ? (
        <p className="card-empty-note">
          {plotted > 0 || undated > 0
            ? `Only one ${granularity} of won revenue in this window — not enough to trace a trend. Try a finer aggregation.`
            : 'No won revenue in this window yet.'}
        </p>
      ) : (
        <div
          className="chart-scroll"
          tabIndex={0}
          role="group"
          aria-label="Won revenue over time — chart, scrollable"
        >
          {/* The drawing is hidden from assistive tech — the ChartDataTable above
              carries the same series as text. The scroll region itself stays
              focusable, so a keyboard can still pan the plot; hiding a focusable
              element is what would break it. */}
          <div aria-hidden="true">
            <ResponsiveContainer width="100%" height={240} minWidth={320}>
              <AreaChart data={points} margin={{ top: 6, right: 18, bottom: 4, left: 2 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="2 4" />
                <XAxis
                  dataKey="label"
                  stroke="var(--axis)"
                  tick={{
                    fill: 'var(--text-muted)',
                    fontSize: 12,
                    fontFamily: 'var(--font-numeric)',
                  }}
                  tickLine={{ stroke: 'var(--axis)' }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  stroke="var(--axis)"
                  tick={{
                    fill: 'var(--text-muted)',
                    fontSize: 12,
                    fontFamily: 'var(--font-numeric)',
                  }}
                  tickLine={{ stroke: 'var(--axis)' }}
                  tickFormatter={formatAxisDollars}
                  width={52}
                />
                <Tooltip
                  cursor={{
                    stroke: 'var(--tick)',
                    strokeWidth: 1,
                    strokeDasharray: '2 3',
                  }}
                  content={({ active: on, payload }) => {
                    if (!on || !payload || payload.length === 0) return null;
                    return renderTooltip(payload[0]?.payload as RevenuePoint | undefined, split);
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
                {split && (
                  <Area
                    type="linear"
                    dataKey="business"
                    stackId="revenue"
                    stroke="var(--series-business)"
                    strokeWidth={2.25}
                    fill="var(--series-business-soft)"
                    isAnimationActive={false}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <ChartDataTable
        caption={`Won revenue by ${granularity}${split ? ', split into after-hours and business-hours' : ''}`}
        columns={[
          {
            header: granularity === 'month' ? 'Month' : granularity === 'week' ? 'Week of' : 'Day',
            cell: (p: RevenuePoint) => p.label,
          },
          ...(split
            ? [
                {
                  header: 'After-hours',
                  cell: (p: RevenuePoint) => formatCurrency(p.after),
                },
                {
                  header: 'Business-hours',
                  cell: (p: RevenuePoint) => formatCurrency(p.business),
                },
              ]
            : []),
          {
            header: 'Total won',
            cell: (p: RevenuePoint) => formatCurrency(p.after + p.business),
          },
        ]}
        rows={points}
      />

      {split && (
        <div className="legend revenue-legend">
          <span className="legend-item">
            <span className="swatch swatch-after" /> After-hours
          </span>
          <span className="legend-item">
            <span className="swatch swatch-business" /> Business-hours
          </span>
        </div>
      )}
      {undatedNote}
    </section>
  );
}
