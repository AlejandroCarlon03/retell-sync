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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchHistory());
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: () => void load() };
}
