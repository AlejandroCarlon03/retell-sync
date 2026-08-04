/**
 * Conversion funnel — horizontal bars, one per stage, split into after-hours
 * (blue) and business-hours (orange) portions. Counts are **cumulative** (a call
 * at stage k is counted at every earlier stage), so the bars shrink down the
 * funnel; the caption says so. Two series → a legend is always present.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { FunnelStage } from '../types/conversion';
import { formatCount, formatCurrency } from '../lib/format';

interface Row {
  stage: string;
  after: number;
  business: number;
  calls: number;
  revenue: number;
  afterRevenue: number;
}

function toRows(funnel: FunnelStage[]): Row[] {
  return funnel.map((s) => ({
    stage: s.stage,
    after: s.after_hours_calls,
    business: Math.max(0, s.calls - s.after_hours_calls),
    calls: s.calls,
    revenue: s.expected_revenue,
    afterRevenue: s.after_hours_expected_revenue,
  }));
}

function renderTooltip(row: Row) {
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{row.stage}</div>
      <div>{formatCount(row.calls)} calls (cumulative)</div>
      <div>
        <span className="swatch swatch-after" /> {formatCount(row.after)} after-hours
      </div>
      <div>
        <span className="swatch swatch-business" /> {formatCount(row.business)} business
      </div>
      <div>{formatCurrency(row.revenue)} expected revenue</div>
    </div>
  );
}

export function FunnelChart({ funnel }: { funnel: FunnelStage[] }) {
  const rows = toRows(funnel);

  return (
    <section className="card" aria-label="Conversion funnel">
      <div className="card-head">
        <h2>Conversion funnel</h2>
        <div className="legend">
          <span className="legend-item">
            <span className="swatch swatch-after" /> After-hours
          </span>
          <span className="legend-item">
            <span className="swatch swatch-business" /> Business-hours
          </span>
        </div>
      </div>
      <p className="card-note">Cumulative — each stage counts the calls that reached it or beyond.</p>

      <div className="chart-scroll">
        <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 56)} minWidth={320}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid horizontal={false} stroke="var(--grid)" />
            <XAxis
              type="number"
              allowDecimals={false}
              stroke="var(--axis)"
              tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
            />
            <YAxis
              type="category"
              dataKey="stage"
              width={92}
              stroke="var(--axis)"
              tick={{ fill: 'var(--text-secondary)', fontSize: 13 }}
            />
            <Tooltip
              cursor={{ fill: 'var(--border)' }}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0]?.payload as Row | undefined;
                return row ? renderTooltip(row) : null;
              }}
            />
            <Bar dataKey="after" stackId="calls" fill="var(--series-after)"
              stroke="var(--surface-1)" strokeWidth={2} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.stage} />
              ))}
            </Bar>
            <Bar dataKey="business" stackId="calls" fill="var(--series-business)"
              stroke="var(--surface-1)" strokeWidth={2} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.stage} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
