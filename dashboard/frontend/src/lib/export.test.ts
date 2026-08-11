import { describe, expect, it } from 'vitest';

import { csvFilename, toCsv } from './export';
import type { DateRange } from './dateRange';
import type { CallRow, ConversionLinks } from '../types/conversion';

/** Minimal CallRow with sensible defaults; override only what a test cares about. */
function call(overrides: Partial<CallRow> = {}): CallRow {
  return {
    call_id: 'c1',
    phone_key: '6024481574',
    ts: '2026-08-04T21:03:00Z',
    after_hours: true,
    duration: 90,
    cost: 0.5,
    matched: true,
    lead_id: 4249,
    lead_name: 'Jane Doe',
    lead_created: '2026-08-01T00:00:00Z',
    new_after_hours_client: false,
    stage_label: 'Quotation',
    sales_rep: 'Alex Carlon',
    funnel_stage: 'Quotation',
    funnel_position: 2,
    probability: 30,
    expected_revenue: 3849,
    weighted_value: 1154.7,
    is_won: false,
    is_lost: false,
    ...overrides,
  };
}

const LINKS: ConversionLinks = {
  retell_call: 'https://retell.example/calls/{call_id}',
  odoo_lead: 'https://odoo.example/web#id={lead_id}&model=crm.lead',
};

describe('toCsv', () => {
  it('emits a header row and one CRLF-terminated line per call', () => {
    const csv = toCsv([call()]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'Time,Phone,Lead,Stage,Sales Rep,Revenue,Outcome,Matched,Retell URL,Odoo URL',
    );
    expect(lines[1]).toContain('2026-08-04T21:03:00Z');
    expect(lines[1]).toContain('6024481574');
    expect(lines[1]).toContain('3849');
    expect(lines[1]).toContain('open');
  });

  it('returns just the header for an empty array', () => {
    expect(toCsv([])).toBe(
      'Time,Phone,Lead,Stage,Sales Rep,Revenue,Outcome,Matched,Retell URL,Odoo URL',
    );
  });

  it('quotes fields containing commas, quotes, or newlines', () => {
    const csv = toCsv([
      call({ lead_name: 'Doe, Jane', stage_label: 'Says "maybe"', sales_rep: 'A\nB' }),
    ]);
    const row = csv.split('\r\n')[1];
    expect(row).toContain('"Doe, Jane"');
    expect(row).toContain('"Says ""maybe"""');
    expect(row).toContain('"A\nB"');
  });

  it('renders nulls as empty cells, not the literal "null"', () => {
    const row = toCsv([
      call({ phone_key: null, stage_label: null, sales_rep: null, expected_revenue: null }),
    ]).split('\r\n')[1];
    expect(row).not.toContain('null');
    expect(row.startsWith('2026-08-04T21:03:00Z,,')).toBe(true);
  });

  it('maps won / lost / open outcomes', () => {
    expect(toCsv([call({ is_won: true })]).split('\r\n')[1]).toContain('won');
    expect(toCsv([call({ is_lost: true })]).split('\r\n')[1]).toContain('lost');
    expect(toCsv([call()]).split('\r\n')[1]).toContain('open');
  });

  it('fills deep-link URLs for matched calls and leaves Odoo blank when unmatched', () => {
    const matched = toCsv([call()], LINKS).split('\r\n')[1];
    expect(matched).toContain('https://retell.example/calls/c1');
    expect(matched).toContain('id=4249');

    const unmatched = toCsv(
      [call({ matched: false, lead_id: null, lead_name: null })],
      LINKS,
    ).split('\r\n')[1];
    expect(unmatched).toContain('https://retell.example/calls/c1');
    expect(unmatched).toContain(',no,https://retell.example/calls/c1,');
    expect(unmatched.endsWith(',')).toBe(true);
  });
});

describe('csvFilename', () => {
  it('names an unbounded range "all-time"', () => {
    expect(csvFilename('calls')).toBe('calls_all-time.csv');
    const allTime: DateRange = { preset: 'all', from: null, to: null };
    expect(csvFilename('calls', allTime)).toBe('calls_all-time.csv');
  });

  it('formats a bounded range and nudges the exclusive upper bound back a day', () => {
    const july: DateRange = {
      preset: 'this-month',
      from: Date.UTC(2026, 6, 1),
      to: Date.UTC(2026, 7, 1),
    };
    expect(csvFilename('calls', july)).toBe('calls_2026-07-01_2026-07-31.csv');
  });
});
