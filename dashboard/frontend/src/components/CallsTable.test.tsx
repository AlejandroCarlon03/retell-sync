/**
 * CallsTable — focused on the optional Sentiment column. It is off by default
 * (the After-Hours table stays narrow) and, when `showQuality` is set, exposes
 * the per-call sentiment in human-readable form. The disconnection "Ending"
 * column was removed, so it must never render.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CallsTable } from './CallsTable';
import type { CallRow } from '../types/conversion';

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

describe('CallsTable quality columns', () => {
  it('hides the Sentiment column by default', () => {
    render(<CallsTable calls={[call({ sentiment: 'Positive' })]} mode="all" />);
    expect(screen.queryByRole('columnheader', { name: 'Sentiment' })).toBeNull();
  });

  it('shows humanized sentiment when showQuality is set', () => {
    render(
      <CallsTable calls={[call({ sentiment: 'Positive' })]} mode="all" showQuality />,
    );
    expect(screen.getByRole('columnheader', { name: 'Sentiment' })).toBeInTheDocument();
    expect(screen.getByText('Positive')).toBeInTheDocument();
  });

  it('never renders the removed Ending column, even with showQuality set', () => {
    render(
      <CallsTable
        calls={[call({ sentiment: 'Positive', disconnection_reason: 'voicemail_reached' })]}
        mode="all"
        showQuality
      />,
    );
    expect(screen.queryByRole('columnheader', { name: 'Ending' })).toBeNull();
    expect(screen.queryByText('Voicemail reached')).toBeNull();
  });

  it('renders an em dash when a call has no sentiment', () => {
    render(<CallsTable calls={[call({ sentiment: null })]} mode="all" showQuality />);
    // The empty Sentiment cell shows a dash (phone_key is set, so it is the only
    // forced dash among the visible columns).
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});
