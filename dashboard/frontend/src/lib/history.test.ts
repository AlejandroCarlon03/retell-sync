/**
 * Tests for the Trends page's history helpers — metric projection and the
 * first-vs-latest delta over the run-over-run series.
 */
import { describe, expect, it } from 'vitest';

import { TREND_METRICS, metricSeries, trendDelta } from './history';
import type { HistoryPoint, HistorySnapshotKpis } from '../types/history';

function snap(date: string, over: Partial<HistorySnapshotKpis>): HistoryPoint {
  return {
    date,
    generated_at: `${date}T06:00:00+00:00`,
    since: null,
    kpis: {
      total_calls: 0,
      after_hours_calls: 0,
      matched_calls: 0,
      won_calls: 0,
      conversion_rate: 0,
      after_hours_conversion_rate: 0,
      dollars_per_after_hours_call: 0,
      won_revenue: 0,
      weighted_pipeline: 0,
      after_hours_new_clients: 0,
      ...over,
    },
  };
}

const DPC = TREND_METRICS.find((m) => m.key === 'dollars_per_after_hours_call')!;

describe('metricSeries', () => {
  it('projects the chosen metric in the series order', () => {
    const history = [
      snap('2026-07-01', { dollars_per_after_hours_call: 2800 }),
      snap('2026-07-02', { dollars_per_after_hours_call: 3100 }),
    ];
    expect(metricSeries(history, DPC)).toEqual([
      { date: '2026-07-01', value: 2800 },
      { date: '2026-07-02', value: 3100 },
    ]);
  });
});

describe('trendDelta', () => {
  it('compares the latest snapshot to the earliest', () => {
    const history = [
      snap('2026-07-01', { dollars_per_after_hours_call: 2000 }),
      snap('2026-07-02', { dollars_per_after_hours_call: 2500 }),
      snap('2026-07-03', { dollars_per_after_hours_call: 3000 }),
    ];
    const d = trendDelta(history, DPC);
    expect(d.prior).toBe(2000);
    expect(d.recent).toBe(3000);
    expect(d.change).toBe(1000);
    expect(d.pct).toBeCloseTo(0.5);
  });

  it('returns a null pct when the first value is zero', () => {
    const history = [
      snap('2026-07-01', { dollars_per_after_hours_call: 0 }),
      snap('2026-07-02', { dollars_per_after_hours_call: 900 }),
    ];
    expect(trendDelta(history, DPC).pct).toBeNull();
  });

  it('is zero-safe on an empty history', () => {
    expect(trendDelta([], DPC)).toEqual({ recent: 0, prior: 0, change: 0, pct: null });
  });
});
