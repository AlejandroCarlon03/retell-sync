/**
 * UpdateNotice + the sidebar version: what shows when the host reports a newer
 * release, what "Update now" sends, and that nothing shows without a host.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAppVersionCache } from '../hooks/useAppVersion';
import { Sidebar } from './Sidebar';
import { UpdateNotice } from './UpdateNotice';

type Route = (url: string, init?: RequestInit) => { ok: boolean; status: number; body: unknown };

function mockHost(route: Route) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const r = route(url, init);
    return { ok: r.ok, status: r.status, json: async () => r.body };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const NEWER = {
  version: '1.0.0',
  update: { version: '1.0.1', notes: 'Faster calls table.' },
  error: null,
};

beforeEach(() => resetAppVersionCache());
afterEach(() => vi.restoreAllMocks());

describe('UpdateNotice', () => {
  it('offers a newer version and installs it through the host', async () => {
    const fetchMock = mockHost((url) =>
      url === '/api/version'
        ? { ok: true, status: 200, body: NEWER }
        : { ok: true, status: 202, body: { installing: true } },
    );
    render(<UpdateNotice />);

    expect(await screen.findByText('Version 1.0.1 is available.')).toBeInTheDocument();
    expect(screen.getByText(/You have 1\.0\.0\./)).toBeInTheDocument();
    expect(screen.getByText(/Faster calls table\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(await screen.findByText('Installing version 1.0.1.')).toBeInTheDocument();
    const install = fetchMock.mock.calls.find(([u]) => u === '/api/update/install');
    const init = install?.[1] ?? {};
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'X-Retell-Dashboard': '1' });
  });

  it("says why when the install can't start, and offers a retry", async () => {
    mockHost((url) =>
      url === '/api/version'
        ? { ok: true, status: 200, body: NEWER }
        : { ok: false, status: 409, body: { error: 'Downloading the update failed (404).' } },
    );
    render(<UpdateNotice />);
    fireEvent.click(await screen.findByRole('button', { name: 'Update now' }));
    expect(await screen.findByText(/Downloading the update failed \(404\)\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('hides for this window on Later', async () => {
    mockHost(() => ({ ok: true, status: 200, body: NEWER }));
    render(<UpdateNotice />);
    fireEvent.click(await screen.findByRole('button', { name: 'Later' }));
    expect(screen.queryByText(/is available/)).toBeNull();
  });

  it('shows nothing when up to date or without a host', async () => {
    const upToDate = mockHost(() => ({
      ok: true,
      status: 200,
      body: { version: '1.0.0', update: null, error: null },
    }));
    const { unmount } = render(<UpdateNotice />);
    await waitFor(() => expect(upToDate).toHaveBeenCalled());
    expect(screen.queryByText(/is available/)).toBeNull();
    unmount();

    resetAppVersionCache();
    const noHost = mockHost(() => ({ ok: false, status: 404, body: {} }));
    render(<UpdateNotice />);
    await waitFor(() => expect(noHost).toHaveBeenCalled());
    expect(screen.queryByText(/is available/)).toBeNull();
  });
});

describe('Sidebar version', () => {
  it('shows the running version and flags an available update', async () => {
    mockHost(() => ({ ok: true, status: 200, body: NEWER }));
    render(<Sidebar />);
    expect(await screen.findByText(/Version 1\.0\.0/)).toHaveTextContent(
      'Version 1.0.0 · update available',
    );
  });

  it('shows no version without a host', async () => {
    const noHost = mockHost(() => ({ ok: false, status: 404, body: {} }));
    render(<Sidebar />);
    await waitFor(() => expect(noHost).toHaveBeenCalled());
    expect(screen.queryByText(/^Version /)).toBeNull();
  });
});
