import { describe, expect, it } from 'vitest';

import sample from '../../../../samples/conversion.sample.json';
import type { CallRow, ConversionPayload } from '../types/conversion';
import { computeKpis } from './kpis';
import { buildRevenueSeries, type RevenueGranularity } from './series';

const GRANULARITIES: RevenueGranularity[] = ['day', 'week', 'month'];

/** Build a CallRow from a partial, defaulting every field (mirrors kpis.test.ts). */
function call(over: Partial<CallRow>): CallRow {
  return {
    call_id: 'c1',
    phone_key: null,
    ts: '2026-08-06T09:00:00Z',
    after_hours: true,
    duration: null,
    cost: null,
    matched: true,
    lead_id: 1,
    lead_name: null,
    lead_created: null,
    new_after_hours_client: false,
    stage_label: null,
    sales_rep: null,
    funnel_stage: null,
    funnel_position: null,
    probability: null,
    expected_revenue: null,
    weighted_value: null,
    is_won: false,
    is_lost: false,
    ...over,
  };
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

describe('buildRevenueSeries — the totals-equal-KPI-totals guarantee', () => {
  const payload = sample as unknown as ConversionPayload;
  const calls = payload.by_call;
  const kpis = computeKpis(calls);

  for (const granularity of GRANULARITIES) {
    it(`reconciles to kpis.won_revenue and after_hours_won_revenue at "${granularity}"`, () => {
      const { points, undated, plotted } = buildRevenueSeries(calls, granularity);

      const afterTotal = points.reduce((s, p) => s + p.after, 0);
      const businessTotal = points.reduce((s, p) => s + p.business, 0);

      // The after-hours channel equals the after-hours won-revenue KPI exactly.
      expect(round4(afterTotal)).toBeCloseTo(kpis.after_hours_won_revenue, 4);

      // Plotted + undated equals the total won-revenue KPI — nothing silently lost.
      expect(round4(plotted + undated)).toBeCloseTo(kpis.won_revenue, 4);
      expect(round4(afterTotal + businessTotal)).toBeCloseTo(plotted, 4);

      // Business-hours channel is the honest remainder of the two KPI totals.
      expect(round4(businessTotal + undated)).toBeCloseTo(
        round4(kpis.won_revenue - kpis.after_hours_won_revenue),
        4,
      );

      // A stacked area must never carry a negative segment.
      for (const p of points) {
        expect(p.after).toBeGreaterThanOrEqual(0);
        expect(p.business).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it('the sample fixture has real won revenue to reconcile against', () => {
    expect(kpis.won_revenue).toBeGreaterThan(0);
    expect(kpis.after_hours_won_revenue).toBeGreaterThan(0);
  });
});

describe('buildRevenueSeries — dedupe and undated remainder', () => {
  it('counts a lead hit by several won calls once (like uniqueLeadSum)', () => {
    const calls = [
      call({ call_id: 'a', lead_id: 7, is_won: true, expected_revenue: 5000, ts: '2026-08-01T20:00:00Z' }),
      call({ call_id: 'b', lead_id: 7, is_won: true, expected_revenue: 5000, ts: '2026-08-02T21:00:00Z' }),
    ];
    const kpis = computeKpis(calls);
    const { plotted, undated } = buildRevenueSeries(calls, 'day');
    expect(kpis.won_revenue).toBe(5000); // deduped, not 10000
    expect(round4(plotted + undated)).toBeCloseTo(kpis.won_revenue, 4);
  });

  it('holds an undatable won lead out of the plot but keeps it in the total', () => {
    const calls = [
      call({ call_id: 'dated', lead_id: 1, after_hours: true, is_won: true, expected_revenue: 3000, ts: '2026-08-01T20:00:00Z' }),
      call({ call_id: 'undated', lead_id: 2, after_hours: null, is_won: true, expected_revenue: 2000, ts: null }),
    ];
    const kpis = computeKpis(calls);
    const { points, plotted, undated } = buildRevenueSeries(calls, 'day');
    expect(undated).toBe(2000);
    expect(plotted).toBe(3000);
    expect(round4(plotted + undated)).toBeCloseTo(kpis.won_revenue, 4); // 5000
    // The undated lead never appears as a bucket.
    expect(points.every((p) => p.business === 0)).toBe(true);
  });

  it('ignores won calls with no lead_id, exactly as the KPI does', () => {
    const calls = [
      call({ call_id: 'nolead', lead_id: null, is_won: true, expected_revenue: 9999, ts: '2026-08-01T20:00:00Z' }),
    ];
    const kpis = computeKpis(calls);
    const { plotted, undated } = buildRevenueSeries(calls, 'day');
    expect(kpis.won_revenue).toBe(0);
    expect(plotted + undated).toBe(0);
  });

  it('buckets business-hours won revenue into the brass channel', () => {
    const calls = [
      call({ call_id: 'biz', lead_id: 3, after_hours: false, is_won: true, expected_revenue: 4000, ts: '2026-07-15T15:00:00Z' }),
    ];
    const { points } = buildRevenueSeries(calls, 'month');
    expect(points).toHaveLength(1);
    expect(points[0].after).toBe(0);
    expect(points[0].business).toBe(4000);
    expect(points[0].key).toBe('2026-07');
  });
});
