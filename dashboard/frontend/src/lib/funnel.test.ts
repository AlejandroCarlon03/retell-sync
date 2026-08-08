import { describe, expect, it } from 'vitest';

import sample from '../../../../samples/conversion.sample.json';
import type { ConversionPayload, FunnelStage } from '../types/conversion';
import { buildFunnelConversion } from './funnel';

/** Build a FunnelStage from a partial, defaulting every field. */
function stage(over: Partial<FunnelStage>): FunnelStage {
  return {
    position: 0,
    stage: 's',
    calls: 0,
    after_hours_calls: 0,
    expected_revenue: 0,
    after_hours_expected_revenue: 0,
    ...over,
  };
}

describe('buildFunnelConversion — percentages reconcile to the raw counts', () => {
  const funnel = (sample as unknown as ConversionPayload).funnel;

  it('the sample fixture has a real multi-stage funnel to reconcile against', () => {
    expect(funnel.length).toBeGreaterThanOrEqual(2);
    expect(funnel[0].after_hours_calls).toBeGreaterThan(0);
  });

  it('each step rate equals stageₖ ÷ stageₖ₋₁ and each share equals stageₖ ÷ stage₀', () => {
    const { stages } = buildFunnelConversion(funnel);
    const first = funnel[0].after_hours_calls;

    stages.forEach((s, i) => {
      // Share of the first stage.
      expect(s.shareOfLead).toBeCloseTo(funnel[i].after_hours_calls / first, 10);

      if (i === 0) {
        // No prior stage to divide by.
        expect(s.stepRate).toBeNull();
      } else {
        expect(s.stepRate).toBeCloseTo(
          funnel[i].after_hours_calls / funnel[i - 1].after_hours_calls,
          10,
        );
      }
    });
  });

  it('the product of the step rates equals the overall lead → won rate', () => {
    const { stages, overallRate } = buildFunnelConversion(funnel);
    const product = stages
      .map((s) => s.stepRate)
      .filter((r): r is number => r != null)
      .reduce((acc, r) => acc * r, 1);

    expect(overallRate).not.toBeNull();
    expect(product).toBeCloseTo(overallRate as number, 10);
    // And it telescopes to last ÷ first.
    expect(overallRate).toBeCloseTo(
      funnel[funnel.length - 1].after_hours_calls / funnel[0].after_hours_calls,
      10,
    );
  });

  it('the sample reconciles to its known counts [17, 15, 7, 4]', () => {
    const { stages, overallRate } = buildFunnelConversion(funnel);
    expect(stages.map((s) => s.after)).toEqual([17, 15, 7, 4]);
    expect(stages[1].stepRate).toBeCloseTo(15 / 17, 10);
    expect(stages[3].stepRate).toBeCloseTo(4 / 7, 10);
    expect(stages[3].shareOfLead).toBeCloseTo(4 / 17, 10);
    expect(overallRate).toBeCloseTo(4 / 17, 10);
  });
});

describe('buildFunnelConversion — guards and edge cases', () => {
  it('renders no rate rather than NaN/∞ when a prior stage is zero', () => {
    const { stages, overallRate } = buildFunnelConversion([
      stage({ position: 0, stage: 'new', after_hours_calls: 0 }),
      stage({ position: 1, stage: 'won', after_hours_calls: 0 }),
    ]);
    expect(stages[0].stepRate).toBeNull();
    expect(stages[1].stepRate).toBeNull(); // 0 ÷ 0 → null, not NaN
    expect(stages[0].shareOfLead).toBeNull(); // first stage is 0 → null, not ∞
    expect(overallRate).toBeNull();
  });

  it('a single-stage funnel shows its count with no step rate and no overall rate', () => {
    const { stages, overallRate } = buildFunnelConversion([
      stage({ position: 0, stage: 'new', after_hours_calls: 5 }),
    ]);
    expect(stages).toHaveLength(1);
    expect(stages[0].stepRate).toBeNull();
    expect(stages[0].shareOfLead).toBeCloseTo(1, 10); // 100% of itself
    expect(overallRate).toBeNull();
  });

  it('an empty funnel yields no stages and no overall rate', () => {
    expect(buildFunnelConversion([])).toEqual({ stages: [], overallRate: null });
  });
});
