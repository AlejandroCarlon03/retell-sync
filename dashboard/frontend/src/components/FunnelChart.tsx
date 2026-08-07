/**
 * After-hours conversion funnel — one horizontal bar per stage, counting only
 * after-hours calls (this dashboard monitors the after-hours agent, so
 * business-hours calls are excluded). Counts are **cumulative** (a call at stage
 * k is counted at every earlier stage), so the bars shrink down the funnel; the
 * caption says so.
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
import { InfoTip } from './InfoTip';

interface Row {
  stage: string;
  after: number;
  revenue: number;
}

function toRows(funnel: FunnelStage[]): Row[] {
  return funnel.map((s) => ({
    stage: s.stage,
    after: s.after_hours_calls,
    revenue: s.after_hours_expected_revenue,
  }));
}

function renderTooltip(row: Row) {
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{row.stage}</div>
      <div>{formatCount(row.after)} after-hours calls (cumulative)</div>
      <div>{formatCurrency(row.revenue)} expected revenue</div>
    </div>
  );
}

export function FunnelChart({ funnel }: { funnel: FunnelStage[] }) {
  const rows = toRows(funnel);

  return (
    <section className="card" aria-label="After-hours conversion funnel">
      <div className="card-head">
        <h2>After-hours funnel</h2>
        <InfoTip text="Of the after-hours calls that reached a lead, how far each got in the sales pipeline. Counts are cumulative — a call that reached 'won' is also counted at every earlier stage." />
      </div>
      <p className="card-note">Cumulative — each stage counts the after-hours calls that reached it or beyond.</p>

      <div className="chart-scroll">
        <ResponsiveContainer width="100%" height={Math.max(175, rows.length * 61)} minWidth={320}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid horizontal={false} stroke="var(--grid)" />
            <XAxis
              type="number"
              allowDecimals={false}
              stroke="var(--axis)"
              tick={{ fill: 'var(--text-muted)', fontSize: 13 }}
            />
            <YAxis
              type="category"
              dataKey="stage"
              width={98}
              stroke="var(--axis)"
              tick={{ fill: 'var(--text-secondary)', fontSize: 14 }}
            />
            <Tooltip
              cursor={{ fill: 'var(--border)' }}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0]?.payload as Row | undefined;
                return row ? renderTooltip(row) : null;
              }}
            />
            <Bar dataKey="after" fill="var(--series-after)"
              barSize={25} radius={[0, 3, 3, 0]} isAnimationActive={false}>
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
