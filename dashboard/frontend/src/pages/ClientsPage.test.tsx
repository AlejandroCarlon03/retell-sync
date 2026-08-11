/**
 * Known-clients page. Focus here is the "Top repeat callers" table: it shows the
 * caller's name when the number is matched to a lead (phone kept as a quiet
 * secondary line), falls back to the raw phone when unmatched, and renders an
 * Odoo deep-link only when both a lead id and the `odoo_lead` template exist.
 */
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientsPage } from './ClientsPage';
import type { CallRow, ConversionLinks, ConversionPayload } from '../types/conversion';

const mockUseFilteredData = vi.fn();
vi.mock('../hooks/useFilteredData', () => ({
  useFilteredData: () => mockUseFilteredData(),
}));

/** A CallRow with sensible defaults; override just the fields a test cares about. */
function call(over: Partial<CallRow>): CallRow {
  return {
    call_id: 'c1',
    phone_key: null,
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

/** Minimal payload — only the fields ClientsPage reads need to be realistic. */
function payload(calls: CallRow[], links?: ConversionLinks): ConversionPayload {
  return {
    generated_at: '2026-08-11T00:00:00+00:00',
    window: { since: null },
    links,
    kpis: {
      unique_callers: 3,
      known_callers: 1,
      after_hours_new_clients: 0,
    },
    funnel: [],
    by_call: calls,
  } as unknown as ConversionPayload;
}

function renderWith(calls: CallRow[], links?: ConversionLinks) {
  mockUseFilteredData.mockReturnValue({
    data: payload(calls, links),
    range: { since: null, until: null },
    isEmpty: calls.length === 0,
  });
  render(<ClientsPage />);
}

const ODOO: ConversionLinks = {
  retell_call: null,
  odoo_lead: 'https://odoo.example/web#id={lead_id}&model=crm.lead',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('ClientsPage — Top repeat callers', () => {
  it('shows the matched caller name with the phone as a secondary line', () => {
    renderWith(
      [
        call({ call_id: 'a1', phone_key: '+15551230001', matched: true, lead_id: 42, lead_name: 'Ada Lovelace' }),
        call({ call_id: 'a2', phone_key: '+15551230001', matched: true, lead_id: 42, lead_name: 'Ada Lovelace' }),
      ],
      ODOO,
    );

    const row = screen.getByText('Ada Lovelace').closest('tr') as HTMLElement;
    expect(within(row).getByText('+15551230001')).toBeInTheDocument();
  });

  it('falls back to the phone number when the repeat caller is unmatched', () => {
    renderWith(
      [
        call({ call_id: 'b1', phone_key: '+15559990002' }),
        call({ call_id: 'b2', phone_key: '+15559990002' }),
      ],
      ODOO,
    );

    // No name to show, so the phone stands in as the caller label.
    expect(screen.getByText('+15559990002')).toBeInTheDocument();
  });

  it('renders an Odoo link only when a lead id and the odoo_lead template both exist', () => {
    renderWith(
      [
        // Matched → linkable.
        call({ call_id: 'm1', phone_key: '+15551110003', matched: true, lead_id: 7, lead_name: 'Grace Hopper' }),
        call({ call_id: 'm2', phone_key: '+15551110003', matched: true, lead_id: 7, lead_name: 'Grace Hopper' }),
        // Unmatched → no lead id, so no link.
        call({ call_id: 'u1', phone_key: '+15552220004' }),
        call({ call_id: 'u2', phone_key: '+15552220004' }),
      ],
      ODOO,
    );

    const matchedRow = screen.getByText('Grace Hopper').closest('tr') as HTMLElement;
    const link = within(matchedRow).getByRole('link', { name: 'Odoo' });
    expect(link).toHaveAttribute('href', 'https://odoo.example/web#id=7&model=crm.lead');

    const unmatchedRow = screen.getByText('+15552220004').closest('tr') as HTMLElement;
    expect(within(unmatchedRow).queryByRole('link', { name: 'Odoo' })).toBeNull();
  });

  it('omits the Odoo link when no odoo_lead template is configured', () => {
    renderWith([
      call({ call_id: 'n1', phone_key: '+15553330005', matched: true, lead_id: 9, lead_name: 'Alan Turing' }),
      call({ call_id: 'n2', phone_key: '+15553330005', matched: true, lead_id: 9, lead_name: 'Alan Turing' }),
    ]); // no links passed → odoo_lead undefined

    const row = screen.getByText('Alan Turing').closest('tr') as HTMLElement;
    expect(within(row).queryByRole('link', { name: 'Odoo' })).toBeNull();
  });
});
