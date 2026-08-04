/**
 * Mount test: render the whole dashboard from the real
 * samples/conversion.sample.json and assert the two acceptance signals — the
 * funnel stages and the dollars-per-after-hours-call KPI — plus the empty state.
 *
 * Recharts' ResponsiveContainer measures its parent, which is 0×0 in jsdom, so
 * it's mocked to hand the chart a fixed size; everything else is the real code.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import type { ConversionPayload } from './types/conversion';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const React = await import('react');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 800, height: 320 }),
  };
});

// Vitest's cwd is the frontend project dir; the fixture lives at <repo>/samples.
const SAMPLE: ConversionPayload = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../samples/conversion.sample.json'), 'utf-8'),
);

function mockFetch(payload: unknown, ok = true, status = 200): void {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dashboard render from the sample fixture', () => {
  beforeEach(() => mockFetch(SAMPLE));

  it('shows the funnel stages and the $/after-hours-call KPI', async () => {
    render(<App />);

    // KPI: dollars_per_after_hours_call = 3848.4848 -> "$3,848".
    expect(await screen.findByText('$3,848')).toBeInTheDocument();

    // Funnel stage labels (lowercase funnel_stage_order — distinct from the
    // capitalized stage_label column) rendered on the chart's category axis.
    expect(screen.getByText('qualified')).toBeInTheDocument();
    expect(screen.getByText('proposition')).toBeInTheDocument();

    // Calls table populated with one row per call.
    expect(screen.getByText(`${SAMPLE.by_call.length} rows`)).toBeInTheDocument();
  });
});

describe('empty window', () => {
  it('shows an empty state instead of charts when there are no calls', async () => {
    const empty: ConversionPayload = {
      generated_at: '2026-08-04T12:00:00Z',
      window: { since: null },
      kpis: { ...SAMPLE.kpis, total_calls: 0 },
      funnel: [],
      by_call: [],
    };
    mockFetch(empty);
    render(<App />);

    expect(await screen.findByText(/No calls in this window/i)).toBeInTheDocument();
  });
});
