/**
 * Settings page. Three sections: Appearance (theme), Display (KPI thresholds), and
 * Alerts (the host-backed recipient/SLA/on-off editor). Appearance + Display are
 * pure localStorage prefs and always render; the Alerts section renders only in the
 * host build (hidden when VITE_STATIC=true, since the static viewer has no host).
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
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe('SettingsPage — Appearance & Display', () => {
  it('always renders the theme control and the thresholds editor', async () => {
    stubFetch({ recipients: [], sla_hours: 48, enabled: false });
    render(<SettingsPage />);

    // Appearance: a theme radiogroup with the three choices.
    const themeGroup = screen.getByRole('radiogroup', { name: /theme/i });
    expect(themeGroup).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument();
    // Display: the KPI threshold editor group.
    expect(screen.getByRole('group', { name: /kpi health thresholds/i })).toBeInTheDocument();
  });

  it('selecting a theme marks it active (aria-checked)', async () => {
    stubFetch({ recipients: [], sla_hours: 48, enabled: false });
    const user = userEvent.setup();
    render(<SettingsPage />);

    const dark = screen.getByRole('radio', { name: 'Dark' });
    await user.click(dark);
    expect(dark).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

describe('SettingsPage — Alerts (host build)', () => {
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

describe('SettingsPage — static build', () => {
  it('hides the alert editor but keeps the prefs sections', async () => {
    vi.stubEnv('VITE_STATIC', 'true');
    // No host in the static build; a fetch here would be a bug, so make it throw.
    globalThis.fetch = vi.fn(async () => {
      throw new Error('no host in static build');
    }) as unknown as typeof fetch;

    render(<SettingsPage />);

    // Prefs still render...
    expect(screen.getByRole('radiogroup', { name: /theme/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /kpi health thresholds/i })).toBeInTheDocument();
    // ...but the alert editor (and its fetch) is absent.
    expect(screen.queryByLabelText('Recipient 1')).not.toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
