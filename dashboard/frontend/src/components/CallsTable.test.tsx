/**
 * CallsTable behaviour: the free-text search (by name or phone) and the Sales Rep
 * column. Rows are minimal hand-built CallRows — only the fields the table reads.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CallsTable } from './CallsTable';
import type { CallRow } from '../types/conversion';

function row(over: Partial<CallRow>): CallRow {
  return {
    call_id: 'c',
    phone_key: null,
    ts: '2026-08-05T20:00:00Z',
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
    ...over,
  };
}

const CALLS: CallRow[] = [
  row({ call_id: 'a', phone_key: '6024481574', matched: true, lead_name: 'Kim Willoughby', sales_rep: 'Maria Gomez' }),
  row({ call_id: 'b', phone_key: '4805559999', matched: true, lead_name: 'Deb Smith', sales_rep: null }),
  row({ call_id: 'c', phone_key: '7042777083', matched: false }),
];

describe('CallsTable search', () => {
  it('renders the Sales Rep column, with an em dash when none', () => {
    render(<CallsTable calls={CALLS} mode="all" />);
    expect(screen.getByRole('columnheader', { name: 'Sales Rep' })).toBeInTheDocument();
    expect(screen.getByText('Maria Gomez')).toBeInTheDocument();
  });

  it('filters by caller name (case-insensitive)', async () => {
    const user = userEvent.setup();
    render(<CallsTable calls={CALLS} mode="all" />);
    await user.type(screen.getByRole('searchbox'), 'kim');

    expect(screen.getByText('Kim Willoughby')).toBeInTheDocument();
    expect(screen.queryByText('Deb Smith')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 3 rows')).toBeInTheDocument();
  });

  it('filters by phone, ignoring punctuation in the query', async () => {
    const user = userEvent.setup();
    render(<CallsTable calls={CALLS} mode="all" />);
    await user.type(screen.getByRole('searchbox'), '(602) 448');

    expect(screen.getByText('Kim Willoughby')).toBeInTheDocument();
    expect(screen.queryByText('Deb Smith')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup();
    render(<CallsTable calls={CALLS} mode="all" />);
    await user.type(screen.getByRole('searchbox'), 'zzzzz');

    expect(screen.getByText(/No calls match/i)).toBeInTheDocument();
  });
});
