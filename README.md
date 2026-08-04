# retell-sync

Join **Retell AI** call logs with **Odoo CRM** leads to answer the question the
after-hours AI phone agent exists to answer: *does an after-hours call become a
customer, and what is it worth?*

Daily, `retell-sync` pulls Retell call logs and Odoo CRM leads, joins them by caller
phone number, tags each call as **after-hours** or **business-hours**, and computes a
**conversion funnel** (lead → quote → won/lost) plus **dollar value per after-hours
call**.

> **Status:** the Retell + Odoo clients, the join/funnel logic, the orchestrated
> `run`, and the Photino + React dashboard are all in (PR 1–7). Automated daily
> scheduling is the remaining milestone. See [`master_plan.md`](master_plan.md) for
> the full roadmap and PR breakdown.

## Quick start (one click)

For everyday use, you don't need the terminal. Double-click **`Retell-Dashboard.cmd`**
in this folder — it pulls the latest Retell + Odoo data and opens the dashboard window.

The very first time, it will:

1. Create a `.env` file and open it in Notepad — paste your `RETELL_API_KEY`,
   `ODOO_URL`, and `ODOO_API_KEY` (the same values the Zapier steps use), save, close.
2. Set up its Python environment automatically (one-time, ~1 minute).

After that, **double-clicking the file is the whole workflow**: fresh data + dashboard.
Requires Python 3.11+, the .NET 9 SDK, and Node.js installed (one-time). The sections
below document the underlying commands the launcher runs, for development or debugging.

## Install (development)

Create the virtual environment **off any OneDrive-synced folder** — OneDrive file
locks corrupt pip installs:

```bash
python -m venv ~/.venvs/retell-sync
# Windows PowerShell: & "$HOME\.venvs\retell-sync\Scripts\Activate.ps1"
source ~/.venvs/retell-sync/bin/activate
pip install -e ".[dev]"
```

## Configure

Copy the example env file and fill in your secrets (never commit `.env`):

```bash
cp .env.example .env
```

| Variable | Used by | Description |
|---|---|---|
| `RETELL_API_KEY` | Retell puller (PR 3) | Retell AI API key |
| `ODOO_URL` | Odoo puller (PR 2) | Base URL of the Odoo REST endpoint |
| `ODOO_API_KEY` | Odoo puller (PR 2) | Bearer token for Odoo API auth |
| `RETELL_DASHBOARD_URL` | Dashboard links (optional) | Retell dashboard host for call-transcript links (default `https://dashboard.retellai.com`) |
| `ODOO_WEB_URL` | Dashboard links (optional) | Odoo **web UI** base (e.g. `https://yourco.odoo.com`) for lead links. Distinct from `ODOO_URL` (the REST endpoint). Leave blank to hide the Odoo links. |

> The dashboard's **Links** column deep-links each after-hours call to its Retell
> transcript and, when the caller is already a lead, to their Odoo record. The
> Retell link works out of the box; the Odoo link appears only once `ODOO_WEB_URL`
> is set. Re-run `python -m retell_sync run` after adding it so the links are baked
> into `conversion.json`.

## Usage

```bash
python -m retell_sync --help
python -m retell_sync --version
python -m retell_sync pull -v                 # pull recent Retell calls (PR 3)
python -m retell_sync pull --days 7           # limit the window to 7 days
python -m retell_sync pull --since 2026-07-01 # explicit ISO start
python -m retell_sync pull --no-cache         # don't write files, just summarize
python -m retell_sync run -v                  # pull + join + write the deliverables
python -m retell_sync run --days 7            # limit the window to 7 days
python -m retell_sync run --since 2026-07-01  # explicit ISO start
```

`pull` fetches, normalizes, and dedups Retell calls, prints a summary, and (unless
`--no-cache`) writes the raw pull and a normalized `retell_calls.csv` to `data/`.

`run` does the whole flow: pull Retell calls **and** Odoo leads for the window, join
them on the caller's phone number, tag each call after-hours vs business-hours, and
write three files to `outputs/`:

| File | What it is |
|---|---|
| `conversion_by_call.csv` | one row per call, joined to its best-matching lead, with funnel stage and won/lost |
| `conversion_funnel.csv` | the ordered, cumulative funnel (calls + dollars per stage, with an after-hours split) |
| `conversion.json` | a JSON-safe payload (metadata + KPIs + both frames) for the dashboard — no `NaN`, numpy, or raw timestamps |

Each external pull is guarded independently, so an outage on one API produces a
clear, attributable error and a non-zero exit code rather than a traceback.

## Develop

```bash
ruff check .
pytest
```

## Related

Part of DKB's after-hours phone-agent stack (Retell AI + Zapier + Odoo). The Odoo
request shape and phone-matching logic are ported from the existing Zapier "Code"
steps in the `RetellAI` project (reference only — not a dependency).
