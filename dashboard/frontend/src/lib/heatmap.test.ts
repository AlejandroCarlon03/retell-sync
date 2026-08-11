import { describe, expect, it } from 'vitest';

import {
  areaCodeOf,
  buildGeoByState,
  buildTimeHeatmap,
  rampColor,
  rankStates,
} from './heatmap';
import type { CallRow } from '../types/conversion';

function call(overrides: Partial<CallRow> = {}): CallRow {
  return {
    call_id: 'c1',
    phone_key: '6024481574', // AZ area code 602
    ts: '2026-06-15T12:00:00Z',
    after_hours: true,
    duration: 90,
    cost: 0.5,
    matched: true,
    lead_id: 1,
    lead_name: 'Lead',
    lead_created: '2026-06-01T00:00:00Z',
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

function nonZeroCells(grid: number[][]): { d: number; h: number; v: number }[] {
  const cells: { d: number; h: number; v: number }[] = [];
  grid.forEach((row, d) => row.forEach((v, h) => v > 0 && cells.push({ d, h, v })));
  return cells;
}

describe('buildTimeHeatmap', () => {
  it('buckets in Phoenix local time (UTC−7), rolling over midnight', () => {
    const t = buildTimeHeatmap(
      [
        call({ ts: '2026-06-15T06:59:00Z' }), // Phoenix 23:59 the day before
        call({ ts: '2026-06-15T07:00:00Z' }), // Phoenix 00:00
      ],
      'calls',
    );
    const cells = nonZeroCells(t.grid);
    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.h).sort((a, b) => a - b)).toEqual([0, 23]);
    // The two land on consecutive weekday rows (midnight rollover).
    const days = cells.map((c) => c.d).sort((a, b) => a - b);
    expect((days[1] - days[0] + 7) % 7).toBe(1);
    expect(t.total).toBe(2);
  });

  it('skips undatable calls and tracks the peak cell', () => {
    const t = buildTimeHeatmap(
      [call({ ts: null }), call({ ts: '2026-06-15T12:00:00Z' }), call({ ts: '2026-06-15T12:30:00Z' })],
      'calls',
    );
    expect(t.total).toBe(2); // the null-ts call dropped
    expect(t.max).toBe(2); // both datable calls share the 05:00 Phoenix bucket
  });

  it("'won' and 'revenue' dedupe per lead across buckets", () => {
    const rows = [
      call({ lead_id: 7, is_won: true, expected_revenue: 5000, ts: '2026-06-15T12:00:00Z' }),
      call({ lead_id: 7, is_won: true, expected_revenue: 5000, ts: '2026-06-16T20:00:00Z' }),
      call({ lead_id: 8, is_won: false, expected_revenue: 999 }),
    ];
    expect(buildTimeHeatmap(rows, 'won').total).toBe(1); // lead 7 once, lead 8 not won
    expect(buildTimeHeatmap(rows, 'revenue').total).toBe(5000); // counted once
  });
});

describe('areaCodeOf', () => {
  it('takes the first three digits of a 10-digit key', () => {
    expect(areaCodeOf('6024481574')).toBe('602');
  });
  it('returns null for short or missing keys', () => {
    expect(areaCodeOf('12345')).toBeNull();
    expect(areaCodeOf(null)).toBeNull();
    expect(areaCodeOf('')).toBeNull();
  });
});

describe('buildGeoByState', () => {
  it('maps area codes to states and buckets unmappable calls to unknown', () => {
    const geo = buildGeoByState(
      [
        call({ phone_key: '6024481574' }), // 602 -> AZ
        call({ phone_key: '4805550000' }), // 480 -> AZ
        call({ phone_key: '2125550000' }), // 212 -> NY
        call({ phone_key: '0001234567' }), // 000 -> unknown
        call({ phone_key: '12345' }), // too short -> unknown
      ],
      'calls',
    );
    expect(geo.byState.AZ).toBe(2);
    expect(geo.byState.NY).toBe(1);
    expect(geo.total).toBe(3);
    expect(geo.unknown).toBe(2);
    expect(geo.max).toBe(2); // AZ
  });

  it("'revenue' dedupes per lead", () => {
    const geo = buildGeoByState(
      [
        call({ phone_key: '6024481574', lead_id: 5, is_won: true, expected_revenue: 2500 }),
        call({ phone_key: '6024481574', lead_id: 5, is_won: true, expected_revenue: 2500 }),
      ],
      'revenue',
    );
    expect(geo.byState.AZ).toBe(2500);
  });
});

describe('rankStates', () => {
  it('sorts states by value descending', () => {
    const geo = buildGeoByState(
      [
        call({ phone_key: '2125550000' }),
        call({ phone_key: '6024481574' }),
        call({ phone_key: '4805550000' }),
      ],
      'calls',
    );
    expect(rankStates(geo).map((r) => r.state)).toEqual(['AZ', 'NY']);
  });
});

describe('rampColor', () => {
  it('is the bare surface at zero and a series mix above zero', () => {
    expect(rampColor(0, 10)).toBe('var(--surface-2)');
    const c = rampColor(5, 10);
    expect(c).toContain('color-mix');
    expect(c).toContain('var(--series-after)');
  });
  it('scales up with value (more intense at the max)', () => {
    const pct = (s: string) => Number(s.match(/(\d+)%/)?.[1]);
    expect(pct(rampColor(10, 10))).toBeGreaterThan(pct(rampColor(2, 10)));
  });
});
