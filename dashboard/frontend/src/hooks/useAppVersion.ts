/**
 * `useAppVersion` — the running app's version and any published update, read once
 * per window from the host (`GET /api/version`). The sidebar shows the version and
 * the update prompt offers the update, so both share one request: the promise is
 * kept at module level. `null` until it resolves, and stays `null` where there is
 * no host (the static IIS viewer).
 */
import { useEffect, useState } from 'react';

import { fetchVersion } from '../api/client';
import type { AppVersion } from '../types/version';

let request: Promise<AppVersion | null> | null = null;

/** Forget the cached request (tests). */
export function resetAppVersionCache(): void {
  request = null;
}

export function useAppVersion(): AppVersion | null {
  const [info, setInfo] = useState<AppVersion | null>(null);
  useEffect(() => {
    let cancelled = false;
    request ??= fetchVersion();
    void request.then((v) => {
      if (!cancelled) setInfo(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}
