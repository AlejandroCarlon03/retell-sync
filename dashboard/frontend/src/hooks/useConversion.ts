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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchConversion());
    } catch (err) {
      setData(null);
      setError(
        err instanceof ApiError ? err : new ApiError(String(err), 0),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: () => void load() };
}
