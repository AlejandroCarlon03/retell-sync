<img src="dashboard/design-reference/logo.png" alt="" width="96" align="right">

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

## Quick start (desktop app)

For everyday use, open **Retell Dashboard** from the Desktop or Start menu shortcut (or
`app\RetellDashboard.exe`). The window opens straight away on the last saved data while
the latest Retell + Odoo data is pulled in the background; the dashboard updates itself
when the pull finishes. No console window. The header's **Refresh** button pulls again.

Build the app once, and again after pulling new code (close the dashboard first):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Publish-App.ps1
```

It sets up the Python environment the app pulls data with (`%USERPROFILE%\.venvs\retell-sync`),
builds the UI, publishes a self-contained `app\RetellDashboard.exe`, and adds the
shortcuts. Building needs the .NET 10 SDK, Node.js and Python 3.11+; running the app needs
only Python (for the data pull). Credentials come from OS env vars or a `.env` at the repo
root (copy `.env.example`: `RETELL_API_KEY`, `ODOO_URL`, `ODOO_API_KEY`). If a pull fails,
the dashboard keeps the last saved report and shows why; the full output is in
`outputs\refresh.log`.

`Retell-Dashboard.cmd` is the older console launcher and still works for development: it
pulls data in the console, rebuilds the UI, and runs the host with `dotnet run`.

## Running on the shared VM server (multi-admin)

To let several DKB admins use this without each installing it locally, provision it **once**
on the shared Windows VM server and have everyone RDP in and run it there. See
[`SETUP.md`](SETUP.md) for the full steps. In short:

- Install the three runtimes on the server once; put the running copy at `C:\Tools\retell-sync`.
- Set `RETELL_API_KEY`, `ODOO_URL`, and `ODOO_API_KEY` as **System** env vars on the server
  (`setx /M ...`). Because `AppConfig.from_env()` uses `load_dotenv(override=False)`, real
  OS env vars win — so **no `.env` is needed** and the launcher skips its first-run Notepad
  prompt automatically when those three vars are present.
- Each admin's per-user venv (`%USERPROFILE%\.venvs\retell-sync`) auto-builds on their first
  launch; after that it's one double-click.

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
| `RETELL_DASHBOARD_URL` | Dashboard links (optional) | Retell dashboard host; call link is `{host}/call-history?history={call_id}` (default `https://dashboard.retellai.com`) |
| `RETELL_CALL_URL_TEMPLATE` | Dashboard links (optional) | Full override for the call link, with a `{call_id}` placeholder — use when your dashboard's per-call path differs |
| `ODOO_WEB_URL` | Dashboard links (optional) | Odoo **web UI** base (e.g. `https://dkbinc.co`); lead link is `{base}/odoo/crm/{lead_id}`. Distinct from `ODOO_URL` (the REST endpoint). Blank hides the Odoo links. |
| `ODOO_LEAD_URL_TEMPLATE` | Dashboard links (optional) | Full override for the lead link, with a `{lead_id}` placeholder |

> The dashboard's **Links** column deep-links each after-hours call to its Retell
> transcript and, when the caller is already a lead, to their Odoo record. Set
> `ODOO_WEB_URL` (e.g. `https://dkbinc.co`) so the Odoo links resolve; the links
> are baked into `conversion.json`, so **re-run `python -m retell_sync run`** after
> changing any of these. If a link opens the wrong page, set the matching
> `*_URL_TEMPLATE` to your exact URL format.

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
