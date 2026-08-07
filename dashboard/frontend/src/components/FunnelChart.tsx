/**
 * After-hours conversion funnel as a vertical scribed STORY POLE (signature) —
 * one continuous graphite rule with each stage struck onto it as a graduation.
 * Off every graduation a steel-blue measure bar is dimensioned with the stage's
 * cumulative after-hours count and its expected dollars, so the reader scans a
 * single measuring stick shrinking down the pipeline rather than a bar chart.
 *
 * Counts are **cumulative** (a call at stage k is counted at every earlier
 * stage), so the increments shrink down the pole; the caption says so. Only
 * after-hours calls are counted — this dashboard monitors the after-hours agent.
 *
 * The bars are presentational (aria-hidden); every figure is real text set in
 * the readout monospace, so the reading is accessible without the graphic.
 */
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

export function FunnelChart({ funnel }: { funnel: FunnelStage[] }) {
  const rows = toRows(funnel);
  // Cumulative counts never rise down the funnel, so the first stage is the
  // widest; dimension every bar against it. Guard the empty / all-zero window.
  const maxCount = rows.reduce((m, r) => Math.max(m, r.after), 0);

  return (
    <section className="card" aria-label="After-hours conversion funnel">
      <div className="card-head">
        <h2>After-hours funnel</h2>
        <InfoTip text="Of the after-hours calls that reached a lead, how far each got in the sales pipeline. Counts are cumulative — a call that reached 'won' is also counted at every earlier stage." />
      </div>
      <p className="card-note">Cumulative — each stage counts the after-hours calls that reached it or beyond.</p>

      {rows.length === 0 ? (
        <p className="card-empty-note">No funnel stages in this window.</p>
      ) : (
        <ol className="story-pole">
          {rows.map((r) => {
            const pct = maxCount > 0 ? (r.after / maxCount) * 100 : 0;
            return (
              <li className="pole-stage" key={r.stage}>
                <span className="pole-rail" aria-hidden="true">
                  <span className="pole-node" />
                </span>
                <div className="pole-readout">
                  <div className="pole-stage-head">
                    <span className="pole-stage-name">{r.stage}</span>
                    <span className="pole-count">{formatCount(r.after)}</span>
                  </div>
                  <div className="pole-measure" aria-hidden="true">
                    <span className="pole-bar" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="pole-dim">
                    <span className="pole-dim-label">expected revenue</span>
                    <span className="pole-dim-value">{formatCurrency(r.revenue)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
