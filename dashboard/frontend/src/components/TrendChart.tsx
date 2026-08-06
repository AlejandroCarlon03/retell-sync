/**
 * Daily volume trend — a stacked look at calls per day, splitting matched (joined
 * to a CRM lead) from unmatched. Answers "is after-hours volume rising, and are
 * those callers people we know?". Built on the recharts already in the bundle;
 * colors come from the theme tokens.
 */
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
import { formatCount, formatCurrency } from '../lib/format';
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

export function TrendChart({ series }: { series: DayPoint[] }) {
  const rows = toRows(series);

  return (
    <section className="card" aria-label="Daily call volume">
      <div className="card-head">
        <h2>Daily call volume</h2>
        <InfoTip text="Calls per day, split by whether the caller matched a lead already in our Odoo CRM. Every call here is an after-hours call. Bucketed by calendar day." />
      </div>
      <p className="card-note">Matched vs unmatched callers, per day.</p>
      <div className="chart-scroll">
        <ResponsiveContainer width="100%" height={220} minWidth={320}>
          <AreaChart data={rows} margin={{ top: 6, right: 12, bottom: 4, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="date"
              stroke="var(--axis)"
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              allowDecimals={false}
              stroke="var(--axis)"
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              width={36}
            />
            <Tooltip
              cursor={{ fill: 'var(--border)' }}
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
              strokeWidth={2}
              fill="var(--series-after)"
              fillOpacity={0.18}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="unmatched"
              stackId="calls"
              stroke="var(--axis)"
              strokeWidth={1.5}
              fill="var(--axis)"
              fillOpacity={0.14}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
