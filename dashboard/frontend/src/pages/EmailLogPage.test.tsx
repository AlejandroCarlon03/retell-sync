/**
 * Email Log page. Reads GET /api/email-log and lists delivered digests grouped by
 * day, newest first; a row expands to a sandboxed frame of the exact sent HTML.
 * An empty log shows an explanatory state (per-rep digests are gated by env).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmailLogPage } from './EmailLogPage';
import type { EmailLogRecord } from '../types/emailLog';

function stubLog(records: EmailLogRecord[]) {
  globalThis.fetch = vi.fn(async () => {
    return { ok: true, status: 200, json: async () => records } as Response;
  }) as unknown as typeof fetch;
}

const REC: EmailLogRecord = {
  sent_at: '2026-08-11T15:30:00+00:00',
  kind: 'per_rep',
  rep: 'Jane Doe',
  recipients: ['jane@dkbinc.co'],
  subject: 'Your 2 after-hours callers overdue past 48h',
  lead_count: 2,
  html: '<p>Jane, you have 2 overdue callers.</p>',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('EmailLogPage', () => {
  it('lists a sent per-rep digest with the salesperson and day', async () => {
    stubLog([REC]);
    render(<EmailLogPage />);

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Aug 11, 2026')).toBeInTheDocument();
    expect(screen.getByText(/Per-rep/i)).toBeInTheDocument();
  });

  it('expands a row to reveal the exact sent email in a frame', async () => {
    stubLog([REC]);
    const user = userEvent.setup();
    render(<EmailLogPage />);

    const toggle = await screen.findByRole('button', { expanded: false });
    await user.click(toggle);

    // Recipient surfaced and a sandboxed preview frame carrying the sent HTML.
    expect(screen.getByText(/jane@dkbinc\.co/)).toBeInTheDocument();
    const frame = screen.getByTitle(/Email sent/i) as HTMLIFrameElement;
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('srcdoc')).toContain('2 overdue callers');
  });

  it('shows the gated empty state when nothing has been sent', async () => {
    stubLog([]);
    render(<EmailLogPage />);

    expect(await screen.findByText(/No digests sent yet/i)).toBeInTheDocument();
    expect(screen.getByText(/RETELL_ALERT_PER_REP/)).toBeInTheDocument();
  });

  it('groups sends under their day headings, newest first', async () => {
    const older: EmailLogRecord = {
      ...REC,
      sent_at: '2026-08-09T12:00:00+00:00',
      kind: 'manager',
      rep: null,
      subject: '3 after-hours callers overdue past 48h',
      lead_count: 3,
    };
    stubLog([older, REC]); // stored oldest-first; page must render newest-first
    render(<EmailLogPage />);

    // The two day headings appear in newest-first document order.
    await screen.findByText('Aug 11, 2026');
    const days = screen.getAllByRole('heading', { level: 3 });
    expect(days[0]).toHaveTextContent('Aug 11, 2026');
    expect(days[1]).toHaveTextContent('Aug 9, 2026');
  });
});
