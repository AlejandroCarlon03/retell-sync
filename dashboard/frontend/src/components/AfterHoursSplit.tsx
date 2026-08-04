/**
 * After-hours vs business-hours at a glance — the split that justifies the agent.
 * A 100%-stacked volume bar plus two conversion meters. These are a few values
 * each, so they're direct meters rather than a chart (data-viz form heuristic).
 */
import type { ConversionKpis } from '../types/conversion';
import { formatCount, formatPercent } from '../lib/format';

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

export function AfterHoursSplit({ kpis }: { kpis: ConversionKpis }) {
  const { after_hours_calls: ah, business_hours_calls: bh } = kpis;
  const total = ah + bh;
  const ahShare = pct(ah, total);

  return (
    <section className="card" aria-label="After-hours vs business-hours">
      <div className="card-head">
        <h2>After-hours vs business-hours</h2>
      </div>

      <div className="split-block">
        <div className="split-title">Call volume</div>
        <div className="stacked-meter" role="img"
          aria-label={`${formatCount(ah)} after-hours, ${formatCount(bh)} business-hours calls`}>
          <div className="meter-seg seg-after" style={{ width: `${ahShare}%` }} />
          <div className="meter-seg seg-business" style={{ width: `${100 - ahShare}%` }} />
        </div>
        <div className="split-legend">
          <span>
            <span className="swatch swatch-after" /> {formatCount(ah)} after-hours
          </span>
          <span>
            <span className="swatch swatch-business" /> {formatCount(bh)} business-hours
          </span>
        </div>
      </div>

      <div className="split-block">
        <div className="split-title">Conversion rate</div>
        <MeterRow
          label="After-hours"
          fraction={kpis.after_hours_conversion_rate}
          variant="after"
        />
        <MeterRow label="Overall" fraction={kpis.conversion_rate} variant="business" />
      </div>
    </section>
  );
}

function MeterRow({
  label,
  fraction,
  variant,
}: {
  label: string;
  fraction: number;
  variant: 'after' | 'business';
}) {
  const widthPct = Math.min(100, Math.max(0, fraction * 100));
  return (
    <div className="meter-row">
      <span className="meter-label">{label}</span>
      <span className="single-meter">
        <span className={`meter-fill fill-${variant}`} style={{ width: `${widthPct}%` }} />
      </span>
      <span className="meter-value">{formatPercent(fraction)}</span>
    </div>
  );
}
