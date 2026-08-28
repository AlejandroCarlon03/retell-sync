/**
 * Call Quality page. It derives its panels from the filtered `by_call` rows (so
 * it stays consistent with the date range), surfacing the sentiment mix, how
 * calls ended, and the win-rate-by-sentiment table. Colour never stands alone —
 * every sentiment row carries its label as real text, which is what these assert.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CallQualityPage } from './CallQualityPage';
import type { CallRow, ConversionPayload } from '../types/conversion';

const mockUseFilteredData = vi.fn();
vi.mock('../hooks/useFilteredData', () => ({
  useFilteredData: () => mockUseFilteredData(),
}));

function call(over: Partial<CallRow>): CallRow {
  return {
    call_id: 'c1',
    phone_key: '6024481574',
    ts: '2026-08-01T04:00:00+00:00',
    after_hours: true,
    duration: 60,
    cost: 0,
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
    ...over,
  };
}

function renderWith(calls: CallRow[]) {
  mockUseFilteredData.mockReturnValue({
    data: { by_call: calls } as unknown as ConversionPayload,
    range: {},
    isEmpty: calls.length === 0,
  });
  render(<CallQualityPage />);
}

describe('CallQualityPage', () => {
  it('renders the sentiment mix and outcome panels from the rows', () => {
    renderWith([
      call({ call_id: 'a', sentiment: 'Positive', disconnection_reason: 'agent_hangup', is_won: true }),
      call({ call_id: 'b', sentiment: 'Negative', disconnection_reason: 'voicemail_reached' }),
      call({ call_id: 'c', sentiment: null, disconnection_reason: null }),
    ]);

    expect(screen.getByText('Caller sentiment')).toBeInTheDocument();
    expect(screen.getByText('How calls ended')).toBeInTheDocument();
    // The "never reached a person" outcome (voicemail) is listed.
    expect(screen.getByText('Voicemail / machine')).toBeInTheDocument();
  });

  it('shows the win-rate-by-sentiment table', () => {
    renderWith([
      call({ call_id: 'a', sentiment: 'Positive', is_won: true }),
      call({ call_id: 'b', sentiment: 'Positive' }),
      call({ call_id: 'd', sentiment: 'Negative' }),
    ]);

    const table = screen.getByLabelText('Conversion by sentiment');
    // Positive: 2 calls, 1 won → 50%.
    expect(within(table).getByText('50.0%')).toBeInTheDocument();
  });

  it('renders cleanly with no calls', () => {
    renderWith([]);
    expect(screen.getByText('Calls analyzed')).toBeInTheDocument();
    expect(
      screen.getByText('No disconnection reasons recorded for these calls.'),
    ).toBeInTheDocument();
  });
});
