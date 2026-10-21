/**
 * The running app's version and any published update (`GET /api/version`, see
 * dashboard/host/UpdateService.cs). Host-only: the static IIS viewer has no host,
 * so there is no version to show there (the web copy is always the current one).
 */
export interface AppVersion {
  /** This build's version, e.g. "1.0.0". */
  version: string;
  /** A newer published release, or null when up to date / no update feed. */
  update: { version: string; notes: string | null } | null;
  /** Why the update check failed (server unreachable), or null. */
  error: string | null;
}
