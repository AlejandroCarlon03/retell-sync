/**
 * Settings page: loads the current alert settings, lets an admin edit the
 * recipient / SLA / enabled fields, and PUTs them back — the "flexible receiver"
 * acceptance in miniature (set an email, save, the host stores it).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsPage } from './SettingsPage';
import type { AlertSettings } from '../types/settings';

/** Install a fetch stub that answers GET /api/settings and captures the PUT body. */
function stubFetch(initial: AlertSettings) {
  const puts: AlertSettings[] = [];
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as AlertSettings;
      puts.push(body);
      return { ok: true, status: 200, json: async () => body } as Response;
    }
    return { ok: true, status: 200, json: async () => initial } as Response;
  }) as unknown as typeof fetch;
  return puts;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SettingsPage', () => {
  it('loads existing settings into the fields', async () => {
    stubFetch({ recipients: ['boss@dkbinc.co'], sla_hours: 24, enabled: true });
    render(<SettingsPage />);

    const recipient = (await screen.findByLabelText('Recipient 1')) as HTMLInputElement;
    expect(recipient.value).toBe('boss@dkbinc.co');
    expect((screen.getByLabelText(/SLA hours/i) as HTMLInputElement).value).toBe('24');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('saves an edited recipient via PUT and confirms', async () => {
    const puts = stubFetch({ recipients: [], sla_hours: 48, enabled: false });
    const user = userEvent.setup();
    render(<SettingsPage />);

    const recipient = await screen.findByLabelText('Recipient 1');
    await user.clear(recipient);
    await user.type(recipient, 'newrep@dkbinc.co');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => expect(screen.getByText(/saved\./i)).toBeInTheDocument());
    expect(puts).toHaveLength(1);
    expect(puts[0].recipients).toEqual(['newrep@dkbinc.co']);
  });

  it('blocks saving a malformed email', async () => {
    stubFetch({ recipients: [], sla_hours: 48, enabled: false });
    const user = userEvent.setup();
    render(<SettingsPage />);

    const recipient = await screen.findByLabelText('Recipient 1');
    await user.type(recipient, 'not-an-email');

    expect(screen.getByText(/not a valid email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save settings/i })).toBeDisabled();
  });
});
