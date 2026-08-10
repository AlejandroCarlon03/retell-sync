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
 *
 * Static-hosting build: for the internal read-only web viewer there is no .NET
 * host — the built app is served by a plain static server (IIS) alongside a
 * sibling `conversion.json`. `build:static` (Vite `--mode static`, see
 * .env.static) sets VITE_CONVERSION_URL=./conversion.json so `fetchConversion`
 * reads that file directly. When unset (the normal Photino build), it defaults to
 * the host's `/api/conversion` route — behaviour is unchanged.
 */
import type { ConversionPayload, ConversionStats } from '../types/conversion';

/**
 * Where the conversion payload is fetched from. Defaults to the Photino host's
 * `/api/conversion` route; overridden to a sibling `./conversion.json` for the
 * static web-viewer build via VITE_CONVERSION_URL (see .env.static).
 */
const CONVERSION_URL = import.meta.env.VITE_CONVERSION_URL ?? '/api/conversion';

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

/** Fetch the full conversion payload (`GET /api/conversion`, or the static file). */
export function fetchConversion(): Promise<ConversionPayload> {
  return getJson<ConversionPayload>(CONVERSION_URL);
}

/** Fetch the lightweight header slice (`GET /api/conversion/stats`). */
export function fetchStats(): Promise<ConversionStats> {
  return getJson<ConversionStats>('/api/conversion/stats');
}
