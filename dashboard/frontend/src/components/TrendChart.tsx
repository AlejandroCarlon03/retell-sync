/**
 * Daily volume trend — a stacked look at calls per day, splitting matched (joined
 * to a CRM lead) from unmatched. Answers "is after-hours volume rising, and are
 * those callers people we know?". Drawn in the bench's grammar: a scribed
 * graticule (--grid) under a hairline axis (--axis), the matched channel traced
 * in the after-hours steel-blue and the unmatched remainder in neutral graphite
 * (it is not a business-hours category, so it stays off the identity hues). Axis
 * figures are tabular readout numerals; every colour comes from a theme token.
 */
import { useRef } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { DayPoint } from '../lib/series';
import type { DateRange } from '../lib/dateRange';
import { formatCount, formatCurrency } from '../lib/format';
import { ChartDataTable } from './ChartDataTable';
import { ChartExportButton } from './ChartExportButton';
import { InfoTip } from './InfoTip';

interface Row {
  date: string;
  matched: number;
  unmatched: number;
  cost: number;
}

function toRows(series: DayPoint[]): Row[] {
  return series.map((p) => ({
    date: p.date.slice(5), // MM-DD
    matched: p.matched,
    unmatched: Math.max(0, p.calls - p.matched),
    cost: p.cost,
  }));
}

function renderTooltip(row: Row | undefined) {
  if (!row) return null;
  const total = row.matched + row.unmatched;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{row.date}</div>
      <div>{formatCount(total)} calls</div>
      <div>
        <span className="swatch swatch-after" /> {formatCount(row.matched)} matched ·{' '}
        {formatCount(row.unmatched)} unmatched
      </div>
      <div>{formatCurrency(row.cost)} spend</div>
    </div>
  );
}

export function TrendChart({ series, range }: { series: DayPoint[]; range?: DateRange }) {
  const rows = toRows(series);
  const cardRef = useRef<HTMLElement>(null);

  return (
    <section className="card" aria-label="Daily call volume" ref={cardRef}>
      <div className="card-head">
        <h2>Daily call volume</h2>
        <div className="card-head-right">
          <ChartExportButton
            targetRef={cardRef}
            name="daily-call-volume"
            title="Daily call volume"
            range={range}
          />
          <InfoTip text="Calls per day, split by whether the caller matched a lead already in our Odoo CRM. Every call here is an after-hours call. Bucketed by calendar day." />
        </div>
      </div>
      <p className="card-note">Matched vs unmatched callers, per day.</p>
      <ChartDataTable
        caption="Daily call volume: matched and unmatched callers per day"
        columns={[
          { header: 'Day', cell: (r: Row) => r.date },
          {
            header: 'Matched callers',
            cell: (r: Row) => formatCount(r.matched),
          },
          {
            header: 'Unmatched callers',
            cell: (r: Row) => formatCount(r.unmatched),
          },
          {
            header: 'Total calls',
            cell: (r: Row) => formatCount(r.matched + r.unmatched),
          },
          { header: 'Spend', cell: (r: Row) => formatCurrency(r.cost) },
        ]}
        rows={rows}
      />
      <div
        className="chart-scroll"
        tabIndex={0}
        role="group"
        aria-label="Daily call volume — chart, scrollable"
      >
        {/* The drawing is hidden from assistive tech — the ChartDataTable above
            carries the same series as text. The scroll region itself stays
            focusable, so a keyboard can still pan the plot; hiding a focusable
            element is what would break it. */}
        <div aria-hidden="true">
          <ResponsiveContainer width="100%" height={240} minWidth={320}>
            <AreaChart data={rows} margin={{ top: 6, right: 12, bottom: 4, left: -10 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="2 4" />
              <XAxis
                dataKey="date"
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
                allowDecimals={false}
                stroke="var(--axis)"
                tick={{
                  fill: 'var(--text-muted)',
                  fontSize: 12,
                  fontFamily: 'var(--font-numeric)',
                }}
                tickLine={{ stroke: 'var(--axis)' }}
                width={38}
              />
              <Tooltip
                cursor={{
                  stroke: 'var(--tick)',
                  strokeWidth: 1,
                  strokeDasharray: '2 3',
                }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  return renderTooltip(payload[0]?.payload as Row | undefined);
                }}
              />
              <Area
                type="monotone"
                dataKey="matched"
                stackId="calls"
                stroke="var(--series-after)"
                strokeWidth={2.25}
                fill="var(--series-after-soft)"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="unmatched"
                stackId="calls"
                stroke="var(--series-neutral)"
                strokeWidth={1.75}
                fill="var(--series-neutral)"
                fillOpacity={0.14}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
