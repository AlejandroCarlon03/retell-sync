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

  it('shows the recap, the funnel stages, and the $/after-hours-call KPI', async () => {
    render(<App />);

    // KPI: dollars_per_after_hours_call = 3848.4848 -> "$3,848". It appears in both
    // the executive summary lede and the "at a glance" bench cell, so match all.
    expect((await screen.findAllByText('$3,848')).length).toBeGreaterThan(0);

    // The home is the merged after-hours recap: its "at a glance" bench heading
    // renders instead of the old full calls table (which now lives on All Calls).
    expect(screen.getByText('At a glance')).toBeInTheDocument();

    // Funnel stage labels: the payload's lowercase funnel_stage_order, title-cased
    // on the story pole.
    expect(screen.getByText('Qualified')).toBeInTheDocument();
    expect(screen.getByText('Proposition')).toBeInTheDocument();

    // The cost/return readout sits beside the dial.
    expect(screen.getByRole('region', { name: 'Return on agent cost' })).toBeInTheDocument();
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

describe('stale report in the read-only viewers', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('flags a published report that is days old', async () => {
    vi.stubEnv('VITE_STATIC', 'true');
    mockFetch({ ...SAMPLE, generated_at: new Date(Date.now() - 5 * 86_400_000).toISOString() });
    render(<App />);

    expect(await screen.findByText(/This report is 5 days old/)).toBeInTheDocument();
  });

  it('stays quiet for a fresh report, and always in the admin app', async () => {
    vi.stubEnv('VITE_STATIC', 'true');
    mockFetch({ ...SAMPLE, generated_at: new Date().toISOString() });
    const { unmount } = render(<App />);
    expect((await screen.findAllByText('$3,848')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/This report is/)).not.toBeInTheDocument();
    unmount();

    vi.stubEnv('VITE_STATIC', '');
    mockFetch(SAMPLE); // months old, but the admin app pulls its own fresh data
    render(<App />);
    expect((await screen.findAllByText('$3,848')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/This report is/)).not.toBeInTheDocument();
  });
});
