/**
 * ExecutiveSummary renders prose straight from the kpis object, so the key
 * guarantee is that its figures match the dial and bench (same numbers, same
 * formatters) and that it degrades cleanly for an empty / zero-revenue window
 * rather than emitting "NaN" or a stray parenthetical.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ConversionKpis } from '../types/conversion';
import { ExecutiveSummary } from './ExecutiveSummary';

const KPIS: ConversionKpis = {
  total_calls: 52,
  after_hours_calls: 33,
  business_hours_calls: 18,
  matched_calls: 29,
  after_hours_matched_calls: 17,
  unique_callers: 45,
  known_callers: 22,
  after_hours_unique_callers: 33,
  after_hours_known_callers: 17,
  after_hours_new_clients: 9,
  after_hours_new_client_won_deals: 2,
  after_hours_new_client_won_revenue: 51000,
  after_hours_new_client_pipeline: 124900,
  won_calls: 8,
  after_hours_won_calls: 4,
  lost_calls: 4,
  conversion_rate: 0.153846,
  after_hours_conversion_rate: 0.121212,
  won_revenue: 180000,
  after_hours_won_revenue: 127000,
  dollars_per_after_hours_call: 3848.4848,
  weighted_pipeline: 332450,
  after_hours_weighted_pipeline: 248250,
};

describe('ExecutiveSummary', () => {
  it('cites the same figures the dial and bench show', () => {
    render(<ExecutiveSummary kpis={KPIS} />);
    const region = screen.getByRole('region', { name: /executive summary/i });

    // Matches the home verdict + bench: $/after-hours call, won revenue,
    // conversion, new customers.
    expect(within(region).getByText('$3,848')).toBeInTheDocument();
    expect(within(region).getByText('$127,000')).toBeInTheDocument();
    expect(within(region).getByText('12.1%')).toBeInTheDocument();
    expect(within(region).getByText('9')).toBeInTheDocument();
  });

  it('never prints NaN and drops the volume-share clause for an empty window', () => {
    const empty: ConversionKpis = {
      ...KPIS,
      total_calls: 0,
      after_hours_calls: 0,
      after_hours_won_calls: 0,
      after_hours_won_revenue: 0,
      after_hours_new_clients: 0,
      after_hours_new_client_won_revenue: 0,
      dollars_per_after_hours_call: 0,
      after_hours_conversion_rate: 0,
      after_hours_weighted_pipeline: 0,
    };
    render(<ExecutiveSummary kpis={empty} />);
    const region = screen.getByRole('region', { name: /executive summary/i });

    expect(region.textContent).not.toMatch(/NaN/);
    // With no calls there is no "% of all volume" clause to compute.
    expect(region.textContent).not.toMatch(/of all volume/);
  });
});
