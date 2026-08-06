# Handoff — retell-sync (session ending 2026-08-04)

For the next Claude Code session. Summarizes what this session built, the current
state, and — most importantly — **what has not yet been verified against the live
APIs**. Read this, then `master_plan.md` for the roadmap.

## What this project is

`retell-sync` answers: *does an after-hours call to DKB's Retell AI agent ("Mia")
become a customer, and what is it worth?* It pulls Retell call logs + Odoo CRM leads,
joins them by caller phone (last 10 digits), tags each call after-hours vs
business-hours (America/Phoenix), and computes a conversion funnel + $/after-hours
call. A desktop dashboard renders the result.

- **Repo:** `C:\Users\AlexL\WebstormProjects\retell-sync` (standalone; does not import
  from any other repo).
- **Python venv:** `~/.venvs/retell-sync` — **must live off OneDrive** (this repo is on
  a synced path history; OneDrive file locks corrupt pip). Use
  `~/.venvs/retell-sync/Scripts/python.exe`.
- **Toolchain present:** Python 3.11+, .NET 9 SDK (9.0.315), Node 24.

## Architecture

```
retell_sync/ (Python package)
  config.py      typed config; secrets from env/.env (RETELL_API_KEY, ODOO_URL, ODOO_API_KEY)
  retell.py      Retell /v2/list-calls client -> normalized call frame
  odoo.py        Odoo crm.lead/search_read client + normalize_phone (last 10 digits)
  conversion.py  PURE join + funnel + KPIs (no IO) -> ConversionResult
  output.py      writes conversion_by_call.csv, conversion_funnel.csv, conversion.json (JSON-safe)
  cli.py         `pull` (Retell only) and `run` (pull both -> join -> write outputs/)

dashboard/ (desktop app; READ-ONLY over conversion.json)
  host/          .NET 9 Photino window + ASP.NET Core minimal API
                 /api/conversion (verbatim), /api/conversion/stats, /api/health
  frontend/      Vite + React 19 + TS (strict). KPI tiles, funnel (Recharts),
                 after-hours split, sortable calls table. Theme-aware (light/dark).

Retell-Dashboard.cmd   one double-click: .env -> venv -> `run` -> open dashboard
samples/conversion.sample.json   realistic 52-call dev fixture (schema-perfect)
```

Data flows Python `run` -> `outputs/conversion.json` -> host `/api/conversion` -> React.

## What this session did (all MERGED to main)

- **PR5 (#7)** — `output.py` + `cli.py run`. Wires pull->join->write; guards each API
  pull independently (outage => clear error + non-zero exit, not a crash). JSON-safe
  serializer (`_json_safe`): NaN/NaT/pd.NA -> null, numpy -> native, timestamps -> ISO.
  **Also fixed a latent PR4 bug** in `build_conversion_funnel`: unmatched calls have a
  `<NA>` funnel_position, which made `(positions >= k)` a nullable boolean that
  `.to_numpy(dtype=bool)` rejected — filled NA before masking. Any real run has
  unmatched calls, so this would have crashed live.
- **Docs (#8)** — renumbered the plan: PR6 = dashboard foundation, PR7 = dashboard
  visualization, PR8 = scheduling (was PR7). Added `samples/conversion.sample.json`.
- **PR6 (#9)** — dashboard foundation: Photino host, `/api/*`, typed data model, hook,
  skeleton. Single `dotnet run` builds the frontend (MSBuild target) and serves it.
- **PR7 (#10)** — dashboard visualization: KPI tiles, funnel with after-hours split,
  split meters, sortable null-safe calls table, theme toggle. Colors validated with the
  dataviz skill's palette validator (after-hours=blue / business=orange pass both modes).
  15 Vitest tests (format helpers + a mount test over the sample fixture + empty state).
- **Launcher (#11)** — `Retell-Dashboard.cmd`: one double-click for non-terminal use.

## >>> BIGGEST OPEN ITEM: never run against live APIs <<<

Everything above is tested on **mocked** responses only. The code has **never hit the
real Retell or Odoo APIs**. The user is about to add real keys to `.env` and try it.
Expect possibly one round of fixups. Three likely snags, in order:

1. **Retell response shape** (`retell.py`). Assumes `/v2/list-calls`, fields
   `from_number` / `start_timestamp` (epoch ms) / `call_cost.combined_cost` (cents) /
   `duration_ms`, descending pagination via `pagination_key`, and tolerant envelope
   unwrapping (`calls`/`result`/`data`). If the live account differs, calls come back
   empty or mis-parsed. **Diagnose:** `python -m retell_sync pull --days 7` prints
   `pulled N call(s)`; if N=0, inspect the cached `data/retell_calls_raw_*.json`.
2. **Odoo URL/auth** (`odoo.py`). POSTs `{ODOO_URL}/crm.lead/search_read` with Bearer
   auth, unwraps `{result:...}`. `ODOO_URL` must be the base that makes that path valid
   (same endpoint the Zapier steps use). NB: lead fields WERE checked against live prod
   during PR2 (crm.lead has `phone` but **no** `mobile`). **Diagnose:** one-liner in
   README/step-2 of the prior chat; check `df['active'].value_counts()` shows both
   True AND False (archived = lost leads must appear, or the "lost" funnel arm is empty).
3. **Phone join** (`conversion.py`). Matches on last 10 digits of Retell `from_number`
   vs Odoo `phone`. If real formats don't reduce to the same 10 digits you get calls but
   `matched=0` (data shows, nothing links). **Diagnose:** open
   `outputs/conversion_by_call.csv`, compare `phone_key` to the leads' phones.

Read-only throughout (only list-calls + search_read), so trying it is safe.

## How to run / verify

```bash
# Python pipeline
~/.venvs/retell-sync/Scripts/python.exe -m pytest -q          # 115+ tests
python -m retell_sync pull --days 7                            # Retell only
python -m retell_sync run --days 7 -v                          # full -> outputs/

# Dashboard
cd dashboard/frontend && npm run lint && npm run test && npm run build
cd dashboard/host && dotnet build
dotnet run --project dashboard/host                            # opens Photino window
#   headless (CI/smoke, no display): dotnet run -- --port 5170 --no-window
#   then GET http://127.0.0.1:5170/api/conversion
```

Conversion.json path resolution (host): CLI `--conversion` > env
`RETELL_SYNC_CONVERSION_JSON` > `<repo>/outputs/conversion.json` > sample fixture.

## Gotchas / notes for next session

- **Photino needs a display + WebView2.** In a headless/sandboxed agent env you cannot
  screenshot the window; use `--no-window` + curl the API, and load the host URL in a
  browser tool to inspect the React render. On the user's Win11 box the window opens fine.
- **`dotnet run --no-build` skips the CopyFrontend target** — after a frontend change,
  do a real `dotnet build` (or `dotnet run` without `--no-build`) so `wwwroot` updates,
  and **stop any running host first** (it locks the exe).
- Frontend build (`tsc -b`) **excludes** test files (see `tsconfig.app.json`); Vitest
  type-checks/runs them separately.
- Recharts v3: custom tooltip typing uses `TooltipContentProps`, and the mount test
  mocks `ResponsiveContainer` to give the chart a fixed size (jsdom is 0x0).
- CI (`.github/workflows/ci.yml`) has two jobs: `test` (Python ruff+pytest) and
  `dashboard` (Node lint+test+build, then `dotnet build`). Keep them green.

## Remaining work (roughly prioritized)

1. **Live-data validation + fixups** — the #1 item above. Wait for the user's first-run
   console output (`pulled…` / `Fetched…` / any error) and adjust retell.py / odoo.py /
   phone matching as needed.
2. **PR8 — Scheduling + docs** (master_plan): daily automated `run` (Windows Task
   Scheduler script or GitHub Actions cron), README ops section.
3. **Optional UX:** an in-app "Refresh from Retell + Odoo" button (host endpoint that
   shells out to the venv `python -m retell_sync run`, then the UI reloads) — proposed
   to the user, not yet built. Would remove the need to re-run the launcher.
4. Consider committing a built/published dashboard exe so non-dev machines don't need the
   .NET SDK (currently the launcher uses `dotnet run`).

## Memory

Persistent memory has a `retell-sync` entry (standalone project, built PR-by-PR per
master_plan.md) and `python-venv-outside-onedrive`. Worth adding: the dashboard is a
Photino .NET 9 + React app under `dashboard/`, and live-API validation is still pending.
