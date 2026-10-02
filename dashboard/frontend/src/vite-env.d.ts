/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Overrides where the dashboard fetches its conversion payload. Set to
   * `./conversion.json` by the static web-viewer build (see .env.static /
   * `build:static`); unset for the normal Photino build, which falls back to the
   * host's `/api/conversion` route.
   */
  readonly VITE_CONVERSION_URL?: string;
  /**
   * Overrides where the dashboard fetches its KPI history (the Trends page). Set
   * to `./history.json` by the static web-viewer build; unset for the Photino
   * build, which falls back to the host's `/api/history` route.
   */
  readonly VITE_HISTORY_URL?: string;
  /**
   * `'true'` in the read-only static web-viewer build (see .env.static /
   * `build:static`). Hides host-only destinations like the Settings page, which
   * needs the .NET host's `/api/settings` endpoint. Unset for the Photino build.
   */
  readonly VITE_STATIC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
