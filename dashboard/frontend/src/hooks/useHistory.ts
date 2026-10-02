/**
 * `useHistory` — load the cross-run KPI history once on mount and expose an
 * explicit `{ data, loading, error, reload }` state machine, mirroring
 * `useConversion`. The Trends page is the only consumer; it renders its own
 * loading / error / "collecting history" states off this hook rather than the
 * shared conversion gates in App (the history is a separate fetch, and can exist
 * even when the current window has no calls).
 *
 * `fetchHistory` already normalizes "no history yet" (404 / absent file) to an
 * empty array, so `error` is reserved for a genuinely unreachable host or an
 * unparseable file.
 */
import { useCallback, useEffect, useState } from 'react';

import { ApiError, fetchHistory } from '../api/client';
import type { HistoryPoint } from '../types/history';

export interface UseHistoryState {
  data: HistoryPoint[] | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

export function useHistory(): UseHistoryState {
  const [data, setData] = useState<HistoryPoint[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiError | null>(null);

  // Bumping `attempt` re-runs the fetch effect (same shape as useConversion):
  // state is only set from the promise callbacks, and a superseded fetch is ignored.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchHistory()
      .then((points) => {
        if (cancelled) return;
        setData(points);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(null);
        setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { data, loading, error, reload };
}
