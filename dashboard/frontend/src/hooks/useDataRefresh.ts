/**
 * `useDataRefresh` — follow the desktop host's background data pull.
 *
 * The desktop app opens its window on the last saved report and pulls fresh
 * Retell + Odoo data behind it (see dashboard/host/DataRefresher.cs). This hook
 * reads that pull's status, polls while it runs, and calls `onFresh` once it
 * lands so the page re-reads the new conversion.json. `start` kicks off another
 * pull (the header's Refresh button).
 *
 * `status` stays `null` when refresh isn't available — the static web viewer, or
 * an older host without `/api/refresh` — and callers fall back to a plain reload.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchRefreshStatus, startRefresh } from '../api/client';
import { isStatic } from '../nav';
import type { RefreshStatus } from '../types/refresh';

const POLL_MS = 1500;

export interface UseDataRefresh {
  status: RefreshStatus | null;
  start: () => void;
}

export function useDataRefresh(onFresh: () => void): UseDataRefresh {
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const onFreshRef = useRef(onFresh);
  useEffect(() => {
    onFreshRef.current = onFresh;
  }, [onFresh]);

  // Initial read. If a pull already finished before the page loaded, the report
  // the page just fetched may predate it, so re-read once.
  useEffect(() => {
    if (isStatic()) return;
    let cancelled = false;
    fetchRefreshStatus()
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        if (s.state === 'succeeded') onFreshRef.current();
      })
      .catch(() => {
        /* no refresh support: leave status null */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll while a pull runs; reload the report when it succeeds.
  const running = status?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      fetchRefreshStatus()
        .then((s) => {
          setStatus(s);
          if (s.state === 'succeeded') onFreshRef.current();
        })
        .catch(() => {
          /* host briefly unreachable: keep the last status and retry */
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running]);

  const start = useCallback(() => {
    startRefresh()
      .then(setStatus)
      .catch((err: Error) =>
        setStatus((prev) => ({
          state: 'failed',
          startedAt: prev?.startedAt ?? null,
          finishedAt: new Date().toISOString(),
          message: err.message,
          logPath: prev?.logPath ?? null,
        })),
      );
  }, []);

  return { status, start };
}
