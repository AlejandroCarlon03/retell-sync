/**
 * Trends Over Time page. Two behaviours matter: it degrades to a clear
 * "collecting history" state with fewer than two snapshots (one dot is not a
 * trend), and with a real series it surfaces the latest value and the
 * first-vs-latest movement.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TrendsPage } from './TrendsPage';
import type { HistoryPoint, HistorySnapshotKpis } from '../types/history';

const mockUseHistory = vi.fn();
vi.mock('../hooks/useHistory', () => ({
  useHistory: () => mockUseHistory(),
}));

// TrendsPage renders <PageFoot>, which reads the conversion context via
// useFilteredData; stub it so the foot renders nothing and the page stands alone.
vi.mock('../hooks/useFilteredData', () => ({
  useFilteredData: () => ({ data: null, range: {}, isEmpty: true }),
}));

function snap(date: string, over: Partial<HistorySnapshotKpis>): HistoryPoint {
  return {
    date,
    generated_at: `${date}T06:00:00+00:00`,
    since: null,
    kpis: {
      total_calls: 40,
      after_hours_calls: 26,
      matched_calls: 22,
      won_calls: 5,
      conversion_rate: 0.1,
      after_hours_conversion_rate: 0.12,
      dollars_per_after_hours_call: 2800,
      won_revenue: 120000,
      weighted_pipeline: 300000,
      after_hours_new_clients: 6,
      ...over,
    },
  };
}

function renderWith(state: Partial<ReturnType<typeof mockUseHistory>>) {
  mockUseHistory.mockReturnValue({ data: [], loading: false, error: null, reload: () => {}, ...state });
  render(<TrendsPage />);
}

describe('TrendsPage', () => {
  it('shows a "collecting history" state with no snapshots', () => {
    renderWith({ data: [] });
    expect(screen.getByText(/Collecting history/i)).toBeInTheDocument();
    expect(screen.getByText(/No snapshots yet/i)).toBeInTheDocument();
  });

  it('still explains itself with a single snapshot (not a trend yet)', () => {
    renderWith({ data: [snap('2026-07-01', {})] });
    expect(screen.getByText(/Only one snapshot so far/i)).toBeInTheDocument();
  });

  it('renders the latest value and the metric heading with a real series', () => {
    renderWith({
      data: [
        snap('2026-07-01', { dollars_per_after_hours_call: 2000 }),
        snap('2026-07-05', { dollars_per_after_hours_call: 3200 }),
      ],
    });
    // Default metric is $/after-hours call; the latest snapshot's value shows.
    expect(screen.getByText('Dollars per after-hours call')).toBeInTheDocument();
    expect(screen.getByText('Snapshots')).toBeInTheDocument();
    // $3,200 is the headline readout *and* the last row of the chart's data
    // table (the non-visual alternative to the SVG), so scope to the readout.
    expect(screen.getByText('$3,200', { selector: '.kpi-value' })).toBeInTheDocument();
    // The same reading is reachable as text behind the chart.
    const table = screen.getByRole('table', { name: /by run/i });
    expect(within(table).getByRole('row', { name: /2026-07-05\s+\$3,200/ })).toBeInTheDocument();
  });

  it('surfaces a load error', () => {
    renderWith({ data: null, error: { message: 'host down' } });
    expect(screen.getByText(/Couldn’t load the KPI history/i)).toBeInTheDocument();
  });
});
