import { describe, expect, it } from 'vitest';

import sample from '../../../../samples/conversion.sample.json';
import type { CallRow, ConversionPayload } from '../types/conversion';
import { buildHighlights, MIN_DAY_VOLUME } from './highlights';

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

describe('buildHighlights — picks and figures against the sample fixture', () => {
  const calls = (sample as unknown as ConversionPayload).by_call;
  const h = buildHighlights(calls);

  it('picks the highest-converting qualifying day', () => {
    expect(h.bestConversion).not.toBeNull();
    expect(h.bestConversion!.date).toBe('2026-07-25');
    expect(h.bestConversion!.won).toBe(2);
    expect(h.bestConversion!.calls).toBe(5);
    expect(h.bestConversion!.rate).toBeCloseTo(2 / 5, 10);
    expect(h.bestConversion!.calls).toBeGreaterThanOrEqual(MIN_DAY_VOLUME);
  });

  it('picks the worst-performing qualifying day', () => {
    expect(h.worstConversion!.date).toBe('2026-07-09');
    expect(h.worstConversion!.won).toBe(0);
    expect(h.worstConversion!.calls).toBe(5);
    expect(h.worstConversion!.rate).toBe(0);
  });

  it('picks the highest-revenue day (lead-deduped won revenue)', () => {
    expect(h.bestRevenueDay!.date).toBe('2026-07-30');
    expect(h.bestRevenueDay!.wonRevenue).toBe(53000);
  });

  it('picks the largest single won deal with its source pointers', () => {
    expect(h.largestDeal!.revenue).toBe(53000);
    expect(h.largestDeal!.leadName).toBe('Patricia Sullivan');
    expect(h.largestDeal!.salesRep).toBe('Tom Becker');
    expect(h.largestDeal!.ts).toBe('2026-07-30T17:07:00+00:00');
    expect(h.largestDeal!.callId).toBeTruthy();
  });

  it('gates conversion picks on volume — only days with ≥3 calls qualify', () => {
    expect(h.qualifyingDays).toBe(6);
  });
});

describe('buildHighlights — gates, ties, and empty states', () => {
  it('returns no conversion pick when no day clears the volume gate', () => {
    const h = buildHighlights([
      call({ call_id: 'a', ts: '2026-08-01T20:00:00Z', is_won: true }),
      call({ call_id: 'b', ts: '2026-08-02T20:00:00Z', is_won: false }),
    ]);
    expect(h.bestConversion).toBeNull();
    expect(h.worstConversion).toBeNull();
    expect(h.qualifyingDays).toBe(0);
    // A real dollar deal is still meaningful at low volume.
    expect(h.largestDeal).not.toBeNull();
  });

  it('breaks a day-conversion tie toward the earlier date', () => {
    const mk = (date: string, won: boolean, id: string) =>
      call({ call_id: id, ts: `${date}T20:00:00Z`, is_won: won });
    // Two days, both 1-of-3 won (33%). Earliest wins both best and worst.
    const h = buildHighlights([
      mk('2026-07-10', true, 'a1'), mk('2026-07-10', false, 'a2'), mk('2026-07-10', false, 'a3'),
      mk('2026-07-20', true, 'b1'), mk('2026-07-20', false, 'b2'), mk('2026-07-20', false, 'b3'),
    ]);
    expect(h.bestConversion!.date).toBe('2026-07-10');
    expect(h.worstConversion!.date).toBe('2026-07-10');
  });

  it('breaks a largest-deal revenue tie toward the earlier timestamp', () => {
    const h = buildHighlights([
      call({ call_id: 'late', lead_id: 2, ts: '2026-07-20T10:00:00Z', is_won: true, expected_revenue: 9000 }),
      call({ call_id: 'early', lead_id: 3, ts: '2026-07-10T10:00:00Z', is_won: true, expected_revenue: 9000 }),
    ]);
    expect(h.largestDeal!.callId).toBe('early');
  });

  it('an empty window yields all-null highlights', () => {
    expect(buildHighlights([])).toEqual({
      bestConversion: null,
      worstConversion: null,
      bestRevenueDay: null,
      largestDeal: null,
      qualifyingDays: 0,
    });
  });

  it('a day-revenue figure counts one deal once even across several won calls', () => {
    const h = buildHighlights([
      call({ call_id: 'x', lead_id: 7, ts: '2026-07-15T20:00:00Z', is_won: true, expected_revenue: 4000 }),
      call({ call_id: 'y', lead_id: 7, ts: '2026-07-15T21:00:00Z', is_won: true, expected_revenue: 4000 }),
    ]);
    expect(h.bestRevenueDay!.wonRevenue).toBe(4000); // deduped, not 8000
  });
});
