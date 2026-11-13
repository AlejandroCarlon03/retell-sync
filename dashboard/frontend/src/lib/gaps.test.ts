import { describe, expect, it } from 'vitest';

import { callBackList, classifyGap, filterGap, gapCounts } from './gaps';
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
    stage_label: 'New',
    sales_rep: 'Jane',
    funnel_stage: 'new',
    funnel_position: 2,
    probability: 30,
    expected_revenue: 1000,
    weighted_value: 300,
    is_won: false,
    is_lost: false,
    ...overrides,
  };
}

describe('classifyGap', () => {
  it('flags an after-hours call with no lead as unmatched', () => {
    expect(classifyGap(call({ matched: false, lead_id: null }))).toBe('unmatched');
  });

  it('flags a matched entry-stage after-hours lead as stalled', () => {
    expect(classifyGap(call({ funnel_position: 0 }))).toBe('stalled');
  });

  it('is ok once the lead has advanced past entry', () => {
    expect(classifyGap(call({ funnel_position: 1 }))).toBe('ok');
  });

  it('is ok for won or lost leads even at entry', () => {
    expect(classifyGap(call({ funnel_position: 0, is_won: true }))).toBe('ok');
    expect(classifyGap(call({ funnel_position: 0, is_lost: true }))).toBe('ok');
  });

  it('ignores business-hours and undatable calls', () => {
    expect(classifyGap(call({ after_hours: false, matched: false }))).toBe('ok');
    expect(classifyGap(call({ after_hours: null, matched: false }))).toBe('ok');
  });
});

describe('filterGap', () => {
  it('returns only rows of the requested bucket, order preserved', () => {
    const rows = [
      call({ call_id: 'a', matched: false, lead_id: null }), // unmatched
      call({ call_id: 'b', funnel_position: 0 }), // stalled
      call({ call_id: 'c', funnel_position: 3 }), // ok
    ];
    expect(filterGap(rows, 'unmatched').map((c) => c.call_id)).toEqual(['a']);
    expect(filterGap(rows, 'stalled').map((c) => c.call_id)).toEqual(['b']);
  });
});

describe('gapCounts', () => {
  it('dedupes unmatched callers by phone and stalled leads by id, summing at-risk revenue', () => {
    const rows = [
      // Same caller, two unmatched calls -> one caller, two calls.
      call({ matched: false, lead_id: null, phone_key: '4805550000' }),
      call({ matched: false, lead_id: null, phone_key: '4805550000' }),
      // Stalled lead 7 reached twice -> one stalled lead, revenue counted once.
      call({ funnel_position: 0, lead_id: 7, expected_revenue: 5000 }),
      call({ funnel_position: 0, lead_id: 7, expected_revenue: 5000 }),
      // Another stalled lead.
      call({ funnel_position: 0, lead_id: 8, expected_revenue: 1500 }),
      // Advanced lead -> not counted.
      call({ funnel_position: 4, lead_id: 9 }),
    ];
    const c = gapCounts(rows);
    expect(c.unmatchedCallers).toBe(1);
    expect(c.unmatchedCalls).toBe(2);
    expect(c.stalledLeads).toBe(2);
    expect(c.stalledRevenue).toBe(6500); // 5000 (once) + 1500
  });

  it('is all-zero when there are no gaps', () => {
    expect(gapCounts([call({ funnel_position: 5 })])).toEqual({
      unmatchedCallers: 0,
      unmatchedCalls: 0,
      stalledLeads: 0,
      stalledRevenue: 0,
    });
  });
});

describe('callBackList', () => {
  const unmatched = (id: string, phone: string, ts: string) =>
    call({ call_id: id, phone_key: phone, ts, matched: false, lead_id: null });
  const stalled = (id: string, phone: string, ts: string) =>
    call({ call_id: id, phone_key: phone, ts, funnel_position: 0 });

  it('keeps one entry per caller, on their latest gap call', () => {
    const { items, total } = callBackList(
      [
        unmatched('a1', '1110000000', '2026-08-01T05:00:00Z'),
        unmatched('a2', '1110000000', '2026-08-03T05:00:00Z'),
        stalled('b1', '2220000000', '2026-08-02T05:00:00Z'),
      ],
      5,
    );
    expect(total).toBe(2);
    expect(items.map((i) => i.call.call_id)).toEqual(['a2', 'b1']);
    expect(items.map((i) => i.kind)).toEqual(['unmatched', 'stalled']);
  });

  it('skips calls that need nothing and business-hours calls', () => {
    const { total } = callBackList(
      [
        call({ call_id: 'ok', funnel_position: 2 }),
        call({ call_id: 'won', funnel_position: 0, is_won: true }),
        call({ call_id: 'biz', after_hours: false, matched: false }),
      ],
      5,
    );
    expect(total).toBe(0);
  });

  it('caps the list but reports every waiting caller', () => {
    const calls = Array.from({ length: 8 }, (_, i) =>
      unmatched(`c${i}`, `30000000${i}0`, `2026-08-0${i + 1}T05:00:00Z`),
    );
    const { items, total } = callBackList(calls, 3);
    expect(total).toBe(8);
    expect(items.map((i) => i.call.call_id)).toEqual(['c7', 'c6', 'c5']);
  });

  it('keeps phoneless gap calls apart', () => {
    const { total } = callBackList(
      [unmatched('x', '', '2026-08-01T05:00:00Z'), unmatched('y', '', '2026-08-02T05:00:00Z')],
      5,
    );
    expect(total).toBe(2);
  });
});
