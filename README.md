# retell-sync

Join **Retell AI** call logs with **Odoo CRM** leads to answer the question the
after-hours AI phone agent exists to answer: *does an after-hours call become a
customer, and what is it worth?*

Daily, `retell-sync` pulls Retell call logs and Odoo CRM leads, joins them by caller
phone number, tags each call as **after-hours** or **business-hours**, and computes a
**conversion funnel** (lead → quote → won/lost) plus **dollar value per after-hours
call**.

> **Status:** through PR 5 — the Retell + Odoo clients, the join/funnel logic, and
> the orchestrated `run` that writes the three deliverables are all in. A dashboard
> over `conversion.json` (PR 6) and scheduling (PR 7) are the remaining milestones.
> See [`master_plan.md`](master_plan.md) for the full roadmap and PR breakdown.

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
