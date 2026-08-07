import { describe, expect, it } from 'vitest';

import type { CallRow } from '../types/conversion';
import { filterCalls, isUnbounded, resolveRange } from './dateRange';

/** Minimal call row with only the fields date filtering reads. */
function call(ts: string | null): CallRow {
  return {
    call_id: `c-${ts ?? 'none'}`,
    phone_key: null,
    ts,
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
  };
}

const ANCHOR = '2026-08-07T12:00:00Z';

describe('resolveRange', () => {
  it('leaves "all" unbounded', () => {
    const r = resolveRange('all', ANCHOR);
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
    expect(isUnbounded(r)).toBe(true);
  });

  it('anchors relative day ranges to generated_at, not the wall clock', () => {
    const r = resolveRange('7d', ANCHOR);
    expect(r.to).toBe(Date.parse(ANCHOR));
    expect(r.from).toBe(Date.parse(ANCHOR) - 7 * 24 * 60 * 60 * 1000);
  });

  it('computes calendar month bounds in UTC for this/last month', () => {
    const thisMonth = resolveRange('this-month', ANCHOR);
    expect(thisMonth.from).toBe(Date.UTC(2026, 7, 1));
    expect(thisMonth.to).toBe(Date.UTC(2026, 8, 1));

    const lastMonth = resolveRange('last-month', ANCHOR);
    expect(lastMonth.from).toBe(Date.UTC(2026, 6, 1));
    expect(lastMonth.to).toBe(Date.UTC(2026, 7, 1));
  });

  it('makes a custom [from, to] inclusive of the chosen end day', () => {
    const r = resolveRange('custom', ANCHOR, { fromDate: '2026-07-10', toDate: '2026-07-20' });
    expect(r.from).toBe(Date.UTC(2026, 6, 10));
    // `to` advances to the next day 00:00 so the 20th is fully included.
    expect(r.to).toBe(Date.UTC(2026, 6, 21));
  });

  it('falls back to now when the anchor is missing', () => {
    const r = resolveRange('7d', null);
    expect(r.to).not.toBeNull();
    expect(r.from).not.toBeNull();
  });
});

describe('filterCalls', () => {
  const rows = [
    call('2026-08-06T09:00:00Z'), // in last 7d
    call('2026-08-01T09:00:00Z'), // in last 7d? anchor 08-07 minus 7d = 07-31, so yes
    call('2026-06-15T09:00:00Z'), // old
    call(null), // undatable
  ];

  it('returns every row (including undatable) when unbounded', () => {
    const kept = filterCalls(rows, resolveRange('all', ANCHOR));
    expect(kept).toHaveLength(4);
  });

  it('keeps only in-window datable rows for a bounded range', () => {
    const kept = filterCalls(rows, resolveRange('7d', ANCHOR));
    expect(kept.map((c) => c.ts)).toEqual(['2026-08-06T09:00:00Z', '2026-08-01T09:00:00Z']);
  });

  it('excludes undatable rows from any bounded window', () => {
    const kept = filterCalls(rows, resolveRange('90d', ANCHOR));
    expect(kept.some((c) => c.ts === null)).toBe(false);
  });

  it('treats the upper bound as exclusive', () => {
    // A call exactly at `to` (the anchor instant) is excluded.
    const kept = filterCalls([call(ANCHOR)], resolveRange('7d', ANCHOR));
    expect(kept).toHaveLength(0);
  });
});
