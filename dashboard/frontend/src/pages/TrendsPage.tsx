/**
 * Trends Over Time — the cross-run view the single-window `conversion.json`
 * cannot give. Each nightly run appends one headline-KPI snapshot to
 * `history.json` (see `retell_sync/output.py` `append_history`); this page charts
 * a chosen metric across those daily snapshots, so a manager can finally answer
 * "is after-hours conversion improving month over month?" rather than only "how
 * did the last 35 days look?".
 *
 * Reads its own history fetch (`useHistory`) — independent of the conversion
 * report and its date-range filter, which don't apply to a run-over-run series.
 * It degrades cleanly: a single snapshot can't be a trend, so with `< 2` points
 * it explains that history is still being collected.
 */
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartDataTable } from '../components/ChartDataTable';
import { InfoTip } from '../components/InfoTip';
import { DeltaChip } from '../components/DeltaChip';
import { PageFoot } from '../components/PageFoot';
import { SegmentedControl } from '../components/SegmentedControl';
import { useHistory } from '../hooks/useHistory';
import {
  TREND_METRICS,
  metricSeries,
  trendDelta,
  type MetricFormat,
  type TrendMetric,
} from '../lib/history';
import { formatCount, formatCurrency, formatPercent, formatUtcDay } from '../lib/format';

/** Format a metric value per its kind, for axis ticks, tooltip, and delta chip. */
function formatMetric(value: number, kind: MetricFormat): string {
  if (kind === 'currency') return formatCurrency(value);
  if (kind === 'percent') return formatPercent(value);
  return formatCount(value);
}

/** A compact y-axis tick — whole dollars without the decimals a full format adds. */
function axisTick(value: number, kind: MetricFormat): string {
  if (kind === 'percent') return formatPercent(value, 0);
  return formatMetric(value, kind);
}

function ChartCard({
  history,
  metric,
}: {
  history: ReturnType<typeof useHistory>['data'];
  metric: TrendMetric;
}) {
  const rows = useMemo(
    () =>
      history
        ? metricSeries(history, metric).map((p) => ({
            date: p.date.slice(5),
            full: p.date,
            value: p.value,
          }))
        : [],
    [history, metric],
  );

  return (
    <>
      <ChartDataTable
        caption={`${metric.title}, by run`}
        columns={[
          { header: 'Date', cell: (r: { full: string }) => r.full },
          {
            header: 'Reading',
            cell: (r: { value: number }) => formatMetric(r.value, metric.format),
          },
        ]}
        rows={rows}
      />
      <div
        className="chart-scroll"
        tabIndex={0}
        role="group"
        aria-label={`${metric.title} — chart, scrollable`}
      >
        {/* The drawing is hidden from assistive tech — the ChartDataTable above
          carries the same series as text. The scroll region itself stays
          focusable, so a keyboard can still pan the plot; hiding a focusable
          element is what would break it. */}
        <div aria-hidden="true">
          <ResponsiveContainer width="100%" height={280} minWidth={320}>
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
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
                stroke="var(--axis)"
                tick={{
                  fill: 'var(--text-muted)',
                  fontSize: 12,
                  fontFamily: 'var(--font-numeric)',
                }}
                tickLine={{ stroke: 'var(--axis)' }}
                width={64}
                tickFormatter={(v: number) => axisTick(v, metric.format)}
              />
              <Tooltip
                cursor={{
                  stroke: 'var(--tick)',
                  strokeWidth: 1,
                  strokeDasharray: '2 3',
                }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const row = payload[0]?.payload as { full: string; value: number } | undefined;
                  if (!row) return null;
                  return (
                    <div className="chart-tooltip">
                      <div className="chart-tooltip-title">{formatUtcDay(row.full)}</div>
                      <div>
                        <span className="swatch swatch-after" />{' '}
                        {formatMetric(row.value, metric.format)}
                      </div>
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--series-after)"
                strokeWidth={2.25}
                dot={{ r: 2.4, fill: 'var(--series-after)', stroke: 'none' }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}

export function TrendsPage() {
  const { data: history, loading, error } = useHistory();
  const [metricKey, setMetricKey] = useState<string>(TREND_METRICS[0].key);
  const metric = TREND_METRICS.find((m) => m.key === metricKey) ?? TREND_METRICS[0];

  if (loading) {
    return (
      <section className="card" aria-label="Trends over time">
        <div className="card-head">
          <h2>Trends over time</h2>
        </div>
        <p className="state-msg" role="status" aria-live="polite">
          Loading history…
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card state-error" aria-label="Trends over time" role="alert">
        <div className="card-head">
          <h2>Trends over time</h2>
        </div>
        <p className="state-body">Couldn’t load the KPI history. {error.message}</p>
      </section>
    );
  }

  const points = history ?? [];

  // A trend needs at least two readings. One (or zero) snapshots is the normal
  // early state — the daily run has to accrue a few days before a line means
  // anything — so explain that rather than drawing a lonely dot.
  if (points.length < 2) {
    return (
      <>
        <section className="card" aria-label="Trends over time">
          <div className="card-head">
            <h2>Collecting history…</h2>
          </div>
          <p className="card-note">
            This page charts the headline KPIs across daily runs. Each{' '}
            <code>python -m retell_sync run</code> appends one snapshot to <code>history.json</code>
            .
          </p>
          <p className="settings-hint">
            {points.length === 0
              ? 'No snapshots yet — trends appear after a few daily runs.'
              : 'Only one snapshot so far — a second run (a different day) draws the first trend line.'}
          </p>
        </section>
        <PageFoot />
      </>
    );
  }

  const delta = trendDelta(points, metric);
  const first = points[0];
  const last = points[points.length - 1];
  const latestValue = metric.pick(last.kpis);

  return (
    <>
      <section className="kpi-bench" aria-label="History summary">
        <div className="kpi-cell">
          <div className="kpi-label">Latest {metric.label}</div>
          <div className="kpi-value">{formatMetric(latestValue, metric.format)}</div>
          <div className="kpi-sub">as of {formatUtcDay(last.date)}</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Since first snapshot</div>
          <div className="kpi-value">
            <DeltaChip
              delta={delta}
              title={`Latest vs the first snapshot (${first.date} → ${last.date})`}
              note="vs first"
              format={(n) => formatMetric(n, metric.format)}
            />
          </div>
          <div className="kpi-sub">from {formatMetric(metric.pick(first.kpis), metric.format)}</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Snapshots</div>
          <div className="kpi-value">{formatCount(points.length)}</div>
          <div className="kpi-sub">
            {formatUtcDay(first.date)} – {formatUtcDay(last.date)}
          </div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Newest run</div>
          <div className="kpi-value">{formatUtcDay(last.date)}</div>
          <div className="kpi-sub">last data refresh</div>
        </div>
      </section>

      <section className="card" aria-label={metric.title}>
        <div className="card-head">
          <h2>{metric.title}</h2>
          <div className="card-head-right">
            <InfoTip text={metric.help} />
          </div>
        </div>
        <div className="table-toolbar">
          <SegmentedControl
            options={TREND_METRICS.map((m) => ({ key: m.key, label: m.label }))}
            value={metric.key}
            onChange={setMetricKey}
            ariaLabel="Choose which metric to trend"
          />
        </div>
        <p className="card-note">One point per daily run, oldest to newest.</p>
        <ChartCard history={points} metric={metric} />
      </section>

      <PageFoot />
    </>
  );
}
