import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RefreshStatus } from '../types/refresh';
import { useDataRefresh } from './useDataRefresh';

function status(state: RefreshStatus['state'], message: string | null = null): RefreshStatus {
  return { state, startedAt: null, finishedAt: null, message, logPath: null };
}

/** Serve each GET /api/refresh from `sequence` in turn (repeating the last). */
function mockRefreshEndpoint(sequence: unknown[], post?: unknown): void {
  let i = 0;
  globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.method === 'POST' ? post : sequence[Math.min(i++, sequence.length - 1)];
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('useDataRefresh', () => {
  it('polls a running pull and reloads the report when it succeeds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockRefreshEndpoint([status('running'), status('running'), status('succeeded')]);
    const onFresh = vi.fn();

    const { result } = renderHook(() => useDataRefresh(onFresh));
    await waitFor(() => expect(result.current.status?.state).toBe('running'));
    expect(onFresh).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.status?.state).toBe('succeeded');
    expect(onFresh).toHaveBeenCalledTimes(1);
  });

  it('keeps a failure and its reason, without reloading', async () => {
    mockRefreshEndpoint([status('failed', 'Odoo request failed (502)')]);
    const onFresh = vi.fn();

    const { result } = renderHook(() => useDataRefresh(onFresh));
    await waitFor(() => expect(result.current.status?.state).toBe('failed'));
    expect(result.current.status?.message).toBe('Odoo request failed (502)');
    expect(onFresh).not.toHaveBeenCalled();
  });

  it('start() posts a new pull', async () => {
    mockRefreshEndpoint([status('idle')], status('running'));
    const { result } = renderHook(() => useDataRefresh(vi.fn()));
    await waitFor(() => expect(result.current.status?.state).toBe('idle'));

    act(() => result.current.start());
    await waitFor(() => expect(result.current.status?.state).toBe('running'));
  });

  it('stays unavailable when the host has no refresh route', async () => {
    mockRefreshEndpoint([{ generated_at: '2026-08-04T12:00:00Z' }]); // some other payload
    const { result } = renderHook(() => useDataRefresh(vi.fn()));
    await act(() => Promise.resolve());
    expect(result.current.status).toBeNull();
  });

  it('never calls the host in the static web viewer', async () => {
    vi.stubEnv('VITE_STATIC', 'true');
    mockRefreshEndpoint([status('running')]);
    const { result } = renderHook(() => useDataRefresh(vi.fn()));
    await act(() => Promise.resolve());
    expect(result.current.status).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
