/**
 * `useConversion` — load the full conversion payload once on mount and expose an
 * explicit `{ data, loading, error, reload }` state machine. Every consumer
 * (this PR's skeleton, PR 7's charts) reads the same hook, so loading/error/empty
 * handling lives in exactly one place.
 *
 * `error` is an `ApiError`, so the UI can distinguish "no conversion.json yet"
 * (status 404, with `resolvedPath`) from "host unreachable" (status 0) from any
 * other failure.
 */
import { useCallback, useEffect, useState } from 'react';

import { ApiError, fetchConversion } from '../api/client';
import type { ConversionPayload } from '../types/conversion';

export interface UseConversionState {
  data: ConversionPayload | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

export function useConversion(): UseConversionState {
  const [data, setData] = useState<ConversionPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<ApiError | null>(null);

  // Bumping `attempt` re-runs the fetch effect. State is only set from the
  // promise callbacks, and a superseded fetch is ignored if a reload overtakes it.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchConversion()
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
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
