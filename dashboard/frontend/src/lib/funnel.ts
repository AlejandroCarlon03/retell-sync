/**
 * Conversion percentages DERIVED from the after-hours funnel counts already in
 * the payload — never a second source of truth. The funnel (`FunnelStage[]`) is
 * cumulative and after-hours-only, so `after_hours_calls` is non-increasing down
 * the pole and every rate below is ≤ 100%.
 *
 * Two figures per stage, plus one headline:
 *   - stepRate    = stageₖ ÷ stageₖ₋₁ — the drop from the previous graduation.
 *   - shareOfLead = stageₖ ÷ stage₀   — how much of the first stage reaches here.
 *   - overallRate = lastStage ÷ stage₀ — the headline lead → won share, which by
 *     telescoping equals the product of every step rate.
 *
 * Note on denominators: this lead → won share divides by the FIRST FUNNEL STAGE
 * (after-hours calls that reached a lead), not by all after-hours calls. It is a
 * deliberately different figure from `kpis.after_hours_conversion_rate` (won ÷
 * every after-hours call, matched or not), so it is labelled "lead → won" rather
 * than "conversion rate" to avoid reading as a contradiction of that KPI.
 *
 * Every rate is a fraction in 0..1 (or null when it can't be formed — a zero-count
 * prior stage, or the first stage's step rate), so `formatPercent` renders an
 * honest em-dash instead of NaN / ∞.
 */
import type { FunnelStage } from '../types/conversion';

export interface StageConversion {
  stage: string;
  /** Cumulative after-hours calls that reached this stage. */
  after: number;
  /** Cumulative after-hours expected revenue at this stage, in dollars. */
  revenue: number;
  /** stageₖ ÷ stageₖ₋₁ as a fraction, or null (first stage / zero-count prior). */
  stepRate: number | null;
  /** stageₖ ÷ stage₀ as a fraction, or null when the first stage is empty. */
  shareOfLead: number | null;
}

export interface FunnelConversion {
  stages: StageConversion[];
  /** lastStage ÷ stage₀ as a fraction, or null when there is no real funnel. */
  overallRate: number | null;
}

/** A safe ratio in 0..1, or null when the denominator is absent/zero. */
function ratio(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null;
  return numerator / denominator;
}

export function buildFunnelConversion(funnel: FunnelStage[]): FunnelConversion {
  const first = funnel[0]?.after_hours_calls ?? 0;

  const stages: StageConversion[] = funnel.map((s, i) => {
    const prior = i > 0 ? funnel[i - 1].after_hours_calls : 0;
    return {
      stage: s.stage,
      after: s.after_hours_calls,
      revenue: s.after_hours_expected_revenue,
      stepRate: i === 0 ? null : ratio(s.after_hours_calls, prior),
      shareOfLead: ratio(s.after_hours_calls, first),
    };
  });

  // A single-stage list has no drop to report, so it carries no overall rate.
  const last = funnel[funnel.length - 1]?.after_hours_calls ?? 0;
  const overallRate = funnel.length >= 2 ? ratio(last, first) : null;

  return { stages, overallRate };
}
