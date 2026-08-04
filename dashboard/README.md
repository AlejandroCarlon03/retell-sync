# retell-sync dashboard

A desktop dashboard over `conversion.json` — the payload written by
`python -m retell_sync run`. Built as a **Photino.NET (.NET 9) host + React/TypeScript
(Vite) frontend**, matching the other DKB dashboards (Cosmos Audit,
EntraSecurityWatcher).

> **Status: PR 7 — visualization.** On top of the PR 6 foundation (host, read-only
> `/api` layer, typed data model), the UI now renders the headline KPI tiles, the
> conversion funnel with its after-hours split, an after-hours vs business-hours
> comparison, and a sortable calls table — theme-aware (light/dark) and responsive.

The dashboard is **read-only**: it only ever reads a local `conversion.json`. It never
calls Retell/Odoo, writes files, or touches secrets.

## Layout

```
dashboard/
  host/        # .NET 9 Photino.NET window + ASP.NET Core minimal API (/api/*)
  frontend/    # Vite + React + TypeScript
```

## Prerequisites

- **.NET 9 SDK**
- **Node.js 20+** (22 recommended)
- On Windows the host uses the WebView2 runtime (present on Windows 11).

## Run it

```bash
cd dashboard/host
dotnet run
```

That builds the frontend if needed, starts a localhost server, and opens a Photino
window. With no real data yet it falls back to `samples/conversion.sample.json`, so the
window shows a populated dashboard out of the box.

Point it at real data by generating `outputs/conversion.json` first:

```bash
python -m retell_sync run
```

The host resolves the `conversion.json` path in this order:

1. a CLI argument — `dotnet run -- --conversion path/to/conversion.json`
2. the `RETELL_SYNC_CONVERSION_JSON` environment variable
3. `<repo>/outputs/conversion.json` (what `run` writes), if it exists
4. `<repo>/samples/conversion.sample.json` (the bundled dev fixture)

Resolution happens per request, so regenerating `outputs/conversion.json` and clicking
**Refresh** picks up the new data without a restart.

## API

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ "ok": true }` |
| `GET /api/conversion` | the full `conversion.json`, passed through verbatim |
| `GET /api/conversion/stats` | just `{ generated_at, window, kpis }` |

When the resolved file is missing or unparseable, the data endpoints return HTTP 404
with `{ error, resolvedPath }` so the UI can show a precise empty state.

## Frontend development

For fast UI iteration with hot-reload, run the host on a fixed port and Vite in dev mode
(its dev server proxies `/api` to the host):

```bash
# terminal 1 — host API on the port Vite proxies to
cd dashboard/host
dotnet run -- --port 5170 --no-window

# terminal 2 — Vite dev server
cd dashboard/frontend
npm install
npm run dev
```

## Checks

```bash
cd dashboard/frontend && npm run lint && npm run build   # frontend
cd dashboard/host && dotnet build                         # host
```

`--no-window` (or `DASHBOARD_NO_WINDOW=1`) runs the server headless — used by CI and
smoke tests that hit the API without a display.
