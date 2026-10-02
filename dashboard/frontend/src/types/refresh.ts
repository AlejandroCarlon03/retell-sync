/**
 * Status of the desktop host's background data pull (`GET/POST /api/refresh`,
 * see dashboard/host/DataRefresher.cs). The host serializes with System.Text.Json
 * web defaults, hence camelCase. Host-only: the static web viewer has no pull.
 */
export type RefreshState = 'idle' | 'running' | 'succeeded' | 'failed';

export interface RefreshStatus {
  state: RefreshState;
  startedAt: string | null;
  finishedAt: string | null;
  /** Why the pull failed (its last error line), or a short note. */
  message: string | null;
  /** Full output of the last pull, for diagnosing a failure. */
  logPath: string | null;
}
