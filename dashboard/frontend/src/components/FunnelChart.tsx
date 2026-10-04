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
 *
 * Dollars are the value of the distinct LEADS at each stage (one deal per caller,
 * however often they rang), so the won stage matches the home's won-revenue
 * figure. Given no calls (older callers), it falls back to the payload's per-call
 * sums.
 */
import type { CallRow, FunnelStage } from '../types/conversion';
import { buildFunnelConversion } from '../lib/funnel';
import { formatCount, formatCurrency, formatPercent, titleCase } from '../lib/format';
import { stageLeadValue } from '../lib/kpis';
import { InfoTip } from './InfoTip';

export function FunnelChart({ funnel, calls }: { funnel: FunnelStage[]; calls?: CallRow[] }) {
  const { stages, overallRate } = buildFunnelConversion(funnel);
  const leadValue = calls ? stageLeadValue(calls, stages.length) : null;
  // Cumulative counts never rise down the funnel, so the first stage is the
  // widest; dimension every bar against it. Guard the empty / all-zero window.
  const maxCount = stages.reduce((m, s) => Math.max(m, s.after), 0);

  return (
    <section className="card" aria-label="After-hours conversion funnel">
      <div className="card-head">
        <h2>After-hours funnel</h2>
        <InfoTip
          label="the after-hours funnel"
          text="How far the after-hours calls that reached a lead got in the sales pipeline. Counts are cumulative: a call that reached Won is also counted at every earlier stage. From previous is this stage ÷ the one above it; Of leads is this stage ÷ the first. Lead → won only counts calls that reached a lead, so it runs higher than the conversion rate above. Lead value counts each lead once."
        />
      </div>
      <p className="card-note">Each stage counts the after-hours calls that reached it or went further.</p>

      {stages.length === 0 ? (
        <p className="card-empty-note">No funnel stages in this window.</p>
      ) : (
        <>
          {overallRate != null && (
            <div className="pole-overall">
              <span className="pole-dim-label">lead → won</span>
              <span className="pole-overall-value">{formatPercent(overallRate)}</span>
              <span className="pole-overall-note">of after-hours calls that reached a lead</span>
            </div>
          )}
          <ol className="story-pole">
            {stages.map((s, i) => {
              const pct = maxCount > 0 ? (s.after / maxCount) * 100 : 0;
              return (
                <li className="pole-stage" key={s.stage}>
                  <span className="pole-rail" aria-hidden="true">
                    <span className="pole-node" />
                  </span>
                  <div className="pole-readout">
                    <div className="pole-stage-head">
                      <span className="pole-stage-name">{titleCase(s.stage)}</span>
                      <span className="pole-count">{formatCount(s.after)}</span>
                    </div>
                    <div className="pole-measure" aria-hidden="true">
                      <span className="pole-bar" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="pole-dims">
                      {i > 0 && (
                        <span className="pole-dim">
                          <span className="pole-dim-label">from previous</span>
                          <span className="pole-dim-value">{formatPercent(s.stepRate)}</span>
                        </span>
                      )}
                      {i > 0 && (
                        <span className="pole-dim">
                          <span className="pole-dim-label">of leads</span>
                          <span className="pole-dim-value">{formatPercent(s.shareOfLead)}</span>
                        </span>
                      )}
                      <span className="pole-dim">
                        <span className="pole-dim-label">lead value</span>
                        <span className="pole-dim-value">
                          {formatCurrency(leadValue ? leadValue[i] : s.revenue)}
                        </span>
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
