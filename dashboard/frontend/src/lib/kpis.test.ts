import { describe, expect, it } from 'vitest';

import type { CallRow } from '../types/conversion';
import { agentCost, buildFunnel, computeKpis, emptyKpis, stageLeadValue } from './kpis';

/** Build a CallRow from a partial, defaulting every field. */
function call(over: Partial<CallRow>): CallRow {
  return {
    call_id: 'c1',
    phone_key: null,
    ts: '2026-08-06T09:00:00Z',
    after_hours: true,
    duration: null,
    cost: null,
    matched: false,
    lead_id: null,
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

describe('computeKpis', () => {
  it('returns the empty mapping for no calls', () => {
    expect(computeKpis([])).toEqual(emptyKpis());
  });

  it('counts calls, after/business-hours split, and undatable as neither', () => {
    const k = computeKpis([
      call({ after_hours: true }),
      call({ after_hours: false }),
      call({ after_hours: null }),
    ]);
    expect(k.total_calls).toBe(3);
    expect(k.after_hours_calls).toBe(1);
    expect(k.business_hours_calls).toBe(1);
  });

  it('counts distinct callers by phone, not calls', () => {
    const k = computeKpis([
      call({ phone_key: '5551234567' }),
      call({ phone_key: '5551234567' }),
      call({ phone_key: '5559999999' }),
      call({ phone_key: null }), // no person to count
    ]);
    expect(k.unique_callers).toBe(2);
  });

  it('dedupes revenue and pipeline on lead_id', () => {
    // One lead hit by two calls must count once in revenue.
    const k = computeKpis([
      call({ matched: true, lead_id: 7, is_won: true, expected_revenue: 1000, weighted_value: 500 }),
      call({ matched: true, lead_id: 7, is_won: true, expected_revenue: 1000, weighted_value: 500 }),
      call({ matched: true, lead_id: 8, is_won: false, expected_revenue: 400, weighted_value: 200 }),
    ]);
    expect(k.won_revenue).toBe(1000);
    expect(k.after_hours_won_revenue).toBe(1000);
    expect(k.weighted_pipeline).toBe(700); // 500 (lead 7) + 200 (lead 8)
    expect(k.won_calls).toBe(2); // calls, not leads
  });

  it('derives conversion rate and dollars-per-call', () => {
    const k = computeKpis([
      call({ is_won: true, expected_revenue: 900, lead_id: 1, matched: true }),
      call({ is_won: false }),
      call({ is_won: false }),
      call({ is_won: false }),
    ]);
    expect(k.conversion_rate).toBe(0.25);
    expect(k.after_hours_conversion_rate).toBe(0.25);
    expect(k.dollars_per_after_hours_call).toBe(225); // 900 / 4
  });

  it('tallies new-from-after-hours clients from the stored flag', () => {
    const k = computeKpis([
      call({ phone_key: 'a', new_after_hours_client: true, matched: true, lead_id: 1, is_won: true, expected_revenue: 500, weighted_value: 250 }),
      call({ phone_key: 'a', new_after_hours_client: true, matched: true, lead_id: 1, is_won: true, expected_revenue: 500, weighted_value: 250 }),
      call({ phone_key: 'b', new_after_hours_client: false }),
    ]);
    expect(k.after_hours_new_clients).toBe(1); // distinct people
    expect(k.after_hours_new_client_won_deals).toBe(1); // distinct leads
    expect(k.after_hours_new_client_won_revenue).toBe(500);
  });
});

describe('buildFunnel', () => {
  const order = ['contacted', 'qualified', 'proposition', 'won'];

  it('produces one cumulative row per stage', () => {
    const funnel = buildFunnel(
      [
        call({ funnel_position: 3, expected_revenue: 100 }), // reached "won"
        call({ funnel_position: 1, expected_revenue: 50 }), // reached "qualified"
        call({ funnel_position: null }), // unmatched, off the funnel
      ],
      order,
    );
    expect(funnel.map((s) => s.calls)).toEqual([2, 2, 1, 1]);
    expect(funnel[0].after_hours_calls).toBe(2);
    expect(funnel[3].expected_revenue).toBe(100);
  });

  it('returns a zeroed funnel for no calls', () => {
    const funnel = buildFunnel([], order);
    expect(funnel).toHaveLength(4);
    expect(funnel.every((s) => s.calls === 0)).toBe(true);
  });
});

describe('agentCost', () => {
  it('sums per-call cost and skips calls without cost data', () => {
    expect(agentCost([call({ cost: 0.25 }), call({ cost: null }), call({ cost: 0.5 })])).toBeCloseTo(0.75);
  });
});

describe('stageLeadValue', () => {
  it('counts each lead once at every stage it reached, however often it called', () => {
    const calls = [
      call({ call_id: 'a1', lead_id: 1, funnel_position: 2, expected_revenue: 1000 }),
      call({ call_id: 'a2', lead_id: 1, funnel_position: 2, expected_revenue: 1000 }),
      call({ call_id: 'b1', lead_id: 2, funnel_position: 0, expected_revenue: 300 }),
      call({ call_id: 'x', lead_id: 3, funnel_position: 2, expected_revenue: 999, after_hours: false }),
    ];
    expect(stageLeadValue(calls, 3)).toEqual([1300, 1000, 1000]);
  });
});
