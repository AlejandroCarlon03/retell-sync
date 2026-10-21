/**
 * CallsTable — focused on the optional Sentiment column. It is off by default
 * (the After-Hours table stays narrow) and, when `showQuality` is set, exposes
 * the per-call sentiment in human-readable form. The disconnection "Ending"
 * column was removed, so it must never render.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CallsTable, PAGE_SIZE } from './CallsTable';
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

describe('CallsTable paging', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      call({
        call_id: `c${i}`,
        phone_key: `480555${String(i).padStart(4, '0')}`,
        ts: `2026-08-01T04:${String(i % 60).padStart(2, '0')}:00+00:00`,
        matched: i === 0,
        lead_name: i === 0 ? 'Acme Reno' : null,
      }),
    );
  const bodyRows = () => screen.getAllByRole('row').length - 1; // minus the header row

  it('renders a page at a time, then more, then all', () => {
    const total = PAGE_SIZE * 2 + 50;
    render(<CallsTable calls={many(total)} mode="all" />);
    expect(bodyRows()).toBe(PAGE_SIZE);
    expect(screen.getByText(`Showing ${PAGE_SIZE} of ${total}`)).toBeInTheDocument();
    expect(screen.getByText(`${total} rows`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: `Show ${PAGE_SIZE} more` }));
    expect(bodyRows()).toBe(PAGE_SIZE * 2);
    expect(screen.getByRole('button', { name: 'Show 50 more' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: `Show all ${total}` }));
    expect(bodyRows()).toBe(total);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('has no paging foot for a short list', () => {
    render(<CallsTable calls={many(5)} mode="all" />);
    expect(bodyRows()).toBe(5);
    expect(screen.queryByText(/^Showing /)).toBeNull();
  });

  it('starts again from the first page when the search changes', () => {
    render(<CallsTable calls={many(PAGE_SIZE * 3)} mode="all" />);
    fireEvent.click(screen.getByRole('button', { name: /Show all/ }));
    expect(bodyRows()).toBe(PAGE_SIZE * 3);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '480555' } });
    expect(bodyRows()).toBe(PAGE_SIZE);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Acme' } });
    expect(bodyRows()).toBe(1);
    expect(screen.queryByText(/^Showing /)).toBeNull();
  });
});
