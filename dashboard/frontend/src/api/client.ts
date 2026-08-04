/**
 * Typed client for the dashboard host's read-only API.
 *
 * Requests are same-origin: in production the Photino host serves both the built
 * frontend and these endpoints from one localhost server, and in `npm run dev`
 * Vite proxies `/api` to the host (see vite.config.ts). So a relative base ("")
 * is correct in both modes.
 *
 * The host returns HTTP 404 with a JSON body `{ error, resolvedPath }` when the
 * conversion.json file is missing or unparseable; `ApiError` surfaces that so the
 * UI can show a precise empty/error state (including which path was tried).
 */
import type { ConversionPayload, ConversionStats } from '../types/conversion';

/** Error carrying the HTTP status and, when present, the host's resolvedPath. */
export class ApiError extends Error {
  readonly status: number;
  readonly resolvedPath?: string;

  constructor(message: string, status: number, resolvedPath?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.resolvedPath = resolvedPath;
  }
}

interface HostErrorBody {
  error?: string;
  resolvedPath?: string;
}

async function getJson<T>(path: string): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(path, { headers: { Accept: 'application/json' } });
  } catch {
    // Network-level failure (host not running / connection refused).
    throw new ApiError(`Could not reach the dashboard host at ${path}.`, 0);
  }

  if (!resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as HostErrorBody;
    throw new ApiError(
      body.error ?? `Request to ${path} failed (${resp.status}).`,
      resp.status,
      body.resolvedPath,
    );
  }

  return (await resp.json()) as T;
}

/** Fetch the full conversion payload (`GET /api/conversion`). */
export function fetchConversion(): Promise<ConversionPayload> {
  return getJson<ConversionPayload>('/api/conversion');
}

/** Fetch the lightweight header slice (`GET /api/conversion/stats`). */
export function fetchStats(): Promise<ConversionStats> {
  return getJson<ConversionStats>('/api/conversion/stats');
}
