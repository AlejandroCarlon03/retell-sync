import { describe, expect, it } from 'vitest';

import { deltaOf, priorRange, topReps } from './board';
import type { DateRange } from './dateRange';
import type { CallRow } from '../types/conversion';

function call(overrides: Partial<CallRow> = {}): CallRow {
  return {
    call_id: 'c1',
    phone_key: '6024481574',
    ts: '2026-08-04T21:03:00Z',
    after_hours: true,
    duration: 90,
    cost: 0.5,
    matched: true,
    lead_id: 1,
    lead_name: 'Lead',
    lead_created: '2026-08-01T00:00:00Z',
    new_after_hours_client: false,
    stage_label: 'Quotation',
    sales_rep: 'Jane Doe',
    funnel_stage: 'Quotation',
    funnel_position: 2,
    probability: 30,
    expected_revenue: 1000,
    weighted_value: 300,
    is_won: false,
    is_lost: false,
    ...overrides,
  };
}

describe('priorRange', () => {
  it('returns the equal-length window immediately before a bounded range', () => {
    const july: DateRange = {
      preset: 'this-month',
      from: Date.UTC(2026, 6, 1),
      to: Date.UTC(2026, 7, 1),
    };
    const prior = priorRange(july);
    expect(prior).not.toBeNull();
    expect(prior!.to).toBe(july.from); // ends exactly where July begins
    expect(prior!.from).toBe(july.from! - (july.to! - july.from!)); // same length back
  });

  it('is null for an unbounded range (nothing to compare against)', () => {
    expect(priorRange({ preset: 'all', from: null, to: null })).toBeNull();
  });
});

describe('deltaOf', () => {
  it('computes change and a percentage against a non-zero prior', () => {
    expect(deltaOf(120, 100)).toEqual({ recent: 120, prior: 100, change: 20, pct: 0.2 });
  });

  it('leaves pct null when the prior is zero', () => {
    expect(deltaOf(5, 0)).toEqual({ recent: 5, prior: 0, change: 5, pct: null });
  });
});

describe('topReps', () => {
  it('ranks reps by won revenue, deduping deals per lead', () => {
    const calls = [
      // Jane: lead 1 won (1000), reached on two calls — counts once.
      call({ sales_rep: 'Jane Doe', lead_id: 1, is_won: true, expected_revenue: 1000 }),
      call({ sales_rep: 'Jane Doe', lead_id: 1, is_won: true, expected_revenue: 1000 }),
      // Rob: lead 2 won (2500).
      call({ sales_rep: 'Rob Roe', lead_id: 2, is_won: true, expected_revenue: 2500 }),
      // Jane: an open call (no win) still counts toward her call volume.
      call({ sales_rep: 'Jane Doe', lead_id: 3, is_won: false, expected_revenue: 800 }),
    ];
    const reps = topReps(calls);
    expect(reps.map((r) => r.rep)).toEqual(['Rob Roe', 'Jane Doe']); // Rob's 2500 > Jane's 1000
    const jane = reps.find((r) => r.rep === 'Jane Doe')!;
    expect(jane.wonRevenue).toBe(1000); // lead 1 counted once despite two won calls
    expect(jane.wonDeals).toBe(1);
    expect(jane.calls).toBe(3);
  });

  it('excludes calls with no assigned salesperson and honors the limit', () => {
    const calls = [
      call({ sales_rep: null, is_won: true, lead_id: 9 }),
      call({ sales_rep: '  ', is_won: true, lead_id: 10 }),
      call({ sales_rep: 'Amy', lead_id: 11, is_won: true, expected_revenue: 500 }),
      call({ sales_rep: 'Ben', lead_id: 12, is_won: true, expected_revenue: 400 }),
    ];
    const reps = topReps(calls, 1);
    expect(reps).toHaveLength(1);
    expect(reps[0].rep).toBe('Amy');
  });

  it('returns an empty list when no lead has a salesperson', () => {
    expect(topReps([call({ sales_rep: null })])).toEqual([]);
  });
});
