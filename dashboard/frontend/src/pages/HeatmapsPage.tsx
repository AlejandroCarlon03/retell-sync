/**
 * Heatmaps — WHEN after-hours calls arrive (weekday × hour) and WHERE callers are
 * (US state, from area code), each shaded on one sequential hue. A single metric
 * toggle (calls / won deals / won revenue) drives both. Aggregations are pure
 * (lib/heatmap) and respect the global date filter via useFilteredData.
 */
import { useMemo, useState } from 'react';

import { GeoHeatmap } from '../components/GeoHeatmap';
import { PageFoot } from '../components/PageFoot';
import { TimeHeatmap } from '../components/TimeHeatmap';
import { useFilteredData } from '../hooks/useFilteredData';
import { buildGeoByState, buildTimeHeatmap, type HeatMetric } from '../lib/heatmap';
import { formatCount, formatCurrency } from '../lib/format';

const METRICS: { key: HeatMetric; label: string }[] = [
  { key: 'calls', label: 'Calls' },
  { key: 'won', label: 'Won deals' },
  { key: 'revenue', label: 'Won revenue' },
];

export function HeatmapsPage() {
  const { data } = useFilteredData();
  const [metric, setMetric] = useState<HeatMetric>('calls');

  const calls = data?.by_call ?? [];
  const time = useMemo(() => buildTimeHeatmap(calls, metric), [calls, metric]);
  const geo = useMemo(() => buildGeoByState(calls, metric), [calls, metric]);

  if (!data) return null;

  const metricLabel = METRICS.find((m) => m.key === metric)?.label ?? 'Calls';
  const format = metric === 'revenue' ? formatCurrency : formatCount;

  return (
    <>
      <section className="card" aria-label="Heatmaps">
        <div className="card-head">
          <h2>Heatmaps</h2>
        </div>
        <p className="card-note">
          When after-hours calls arrive and where callers are — shade by calls, won
          deals, or won revenue.
        </p>
        <div className="segmented" role="tablist" aria-label="Heatmap metric">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={metric === m.key}
              className={`seg${metric === m.key ? ' active' : ''}`}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </section>

      <TimeHeatmap data={time} metricLabel={metricLabel} format={format} />
      <GeoHeatmap data={geo} metricLabel={metricLabel} format={format} />

      <PageFoot />
    </>
  );
}
