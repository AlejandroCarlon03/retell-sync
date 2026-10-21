/**
 * CallBackList — the Home "call these back" list: who shows, how many, the empty
 * state, and the hand-off link to Follow-ups once the list is capped.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CALL_BACK_LIMIT, CallBackList } from './CallBackList';
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

const LINKS = {
  retell_call: 'https://retell.example/call/{call_id}',
  odoo_lead: 'https://odoo.example/lead/{lead_id}',
};

describe('CallBackList', () => {
  it('lists a stalled lead with its rep and Odoo link, and an unmatched caller without one', () => {
    render(
      <CallBackList
        links={LINKS}
        calls={[
          call({
            call_id: 's1',
            phone_key: '4805550001',
            ts: '2026-08-02T04:00:00+00:00',
            matched: true,
            lead_id: 7,
            lead_name: 'Acme Reno',
            sales_rep: 'Jane Doe',
            funnel_position: 0,
          }),
          call({ call_id: 'u1', phone_key: '4805550002' }),
        ]}
      />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Acme Reno')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Stalled lead')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('link', { name: 'Odoo' })).toHaveAttribute(
      'href',
      'https://odoo.example/lead/7',
    );
    expect(within(rows[1]).getByText('Not in CRM', { selector: '.caller-name' })).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('link', { name: 'Odoo' })).toBeNull();
    expect(screen.getByText('2 waiting')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /See all/ })).toBeNull();
  });

  it('caps the list and links to Follow-ups for the rest', () => {
    const calls = Array.from({ length: CALL_BACK_LIMIT + 3 }, (_, i) =>
      call({ call_id: `u${i}`, phone_key: `48055500${String(i).padStart(2, '0')}` }),
    );
    render(<CallBackList calls={calls} links={LINKS} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(CALL_BACK_LIMIT);
    expect(screen.getByRole('link', { name: `See all ${CALL_BACK_LIMIT + 3} in Follow-ups` })).toHaveAttribute(
      'href',
      '#/follow-up',
    );
  });

  it('says so when nobody is waiting', () => {
    render(<CallBackList calls={[call({ after_hours: false })]} links={LINKS} />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('Nobody waiting')).toBeInTheDocument();
  });
});
