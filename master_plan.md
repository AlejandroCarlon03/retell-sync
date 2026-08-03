# Master Plan — `retell-sync`: After-Hours Call → Conversion Analytics

> Standalone project. It does **not** depend on or modify any other repo. Where it
> says "reference," that means *read the pattern and re-implement cleanly here* —
> not import. Implement incrementally across the PRs below, not in one shot.

---

## Context / Why

DKB runs an after-hours AI phone agent ("Mia," on Retell AI) that enriches calls
into Odoo CRM via a Zapier pipeline. Today we can see call **cost and volume**, but
not the question that justifies the agent: *does an after-hours call become a
customer, and what is it worth?*

`retell-sync` answers that. Daily, it pulls Retell call logs and Odoo CRM leads,
joins them by caller phone number, tags each call as after-hours or business-hours,
and computes a **conversion funnel** (lead → quote → won/lost) plus **dollar value
per after-hours call**.

**Decisions already made:**
- **Its own repo / package** — no coupling to the cost-forecasting project.
- **Python** for the join/funnel work (pandas makes the aggregation trivial and the
  reference logic is easy to port). *Reconfirm if desired:* the earlier lean toward
  Python assumed reuse of another package; as a standalone it's a fresh choice, but
  Python is still the recommendation for this data-shaping task.
- Pull Retell via its **list-calls API**; pull Odoo via its **REST API**.
- Join call→lead by **phone re-match at analytics time** — no changes to the live
  Zap or Odoo schema. (Durable future upgrade, out of scope: write the Retell
  `call_id` onto the lead at call time for exact joins.)

---

## Reference implementations (read-only, in other repos — borrow the pattern, do not import)

- **`WebstormProjects/RetellAI/odoo-crm-inbound-call-enrichment.js`** — the exact
  Odoo request shape (`POST {ODOO_URL}/crm.lead/search_read`, bearer auth,
  `{result: ...}` unwrap) and the last-10-digit phone matching
  (`findOpportunitiesByPhone`, `normalize` on `phone`/`name`, `write_date desc`
  tie-break). Port this to `odoo.py`.
- **`WebstormProjects/RetellAI/zapier-store-locator-and-utm-lookup.js`** — shows the
  Odoo get-or-create pattern and how store/UTM data attaches to a lead (context for
  what fields exist on `crm.lead`).
- **`call-forecast` (cost-forecasting project)** — *separate project, do not touch.*
  Useful only as a reference for two patterns if you want them: robust
  timestamp/currency parsing and `call_id` dedup (its `ingest.py`), and JSON-safe
  payload building for a dashboard (its `serialize.py`). Re-implement, don't depend.

---

## Architecture (target end state)

```
retell.py  --list-calls API-->  call records (call_id, phone, ts, duration, cost, direction)
odoo.py    --search_read API--> lead records (id, phone/mobile, stage, probability,
                                              expected_revenue, won/lost, dates)
                         \                /
                   conversion.py: join on last-10-digit phone,
                   tag after-hours (business-hours config),
                   map stage -> funnel position, roll up $ + counts
                                 |
              conversion_by_call.csv + conversion_funnel.csv + conversion.json
                                 |
                   (optional) dashboard consuming conversion.json
```

### Package layout
```
retell-sync/
  pyproject.toml
  .env.example            # RETELL_API_KEY, ODOO_URL, ODOO_API_KEY
  README.md
  retell_sync/
    __init__.py
    __main__.py
    config.py             # dataclasses: RetellConfig, OdooConfig, ConversionConfig, BusinessHours
    retell.py             # list-calls API client
    odoo.py               # crm.lead client + normalize_phone
    conversion.py         # join + funnel (pure functions)
    output.py             # write CSV + JSON-safe payload
    cli.py                # `pull`, `run`
  tests/
```

### Gotchas
- **Lost leads are archived in Odoo** (`active = false`). The lead query MUST disable
  `active_test` (or query `active in [true, false]`) or the funnel silently drops
  every loss.
- Phone re-match can multi-match; break ties by most-recently-touched lead
  (`write_date desc`) — same rule the Zapier JS uses.
- Normalize both sides to **last 10 digits** before joining (calls `from_number`,
  leads `phone` **and** `mobile`).
- Secrets via env only — `RETELL_API_KEY`, `ODOO_URL`, `ODOO_API_KEY`. Never commit;
  ship a `.env.example`.
- **Create the venv off OneDrive** (e.g. `~/.venvs/retell-sync`). If this repo lives
  on the synced Desktop/OneDrive, OneDrive file locks corrupt pip installs.

---

## PR Breakdown

### PR 1 — Repo scaffolding
- **Scope:** `pyproject.toml`, package skeleton, `config.py` dataclasses
  (`RetellConfig`, `OdooConfig`, `ConversionConfig`, business-hours window),
  env loading, `.env.example`, README, CI (lint + pytest).
- **Tests:** config parse/defaults; `python -m retell_sync --help` works.
- **Acceptance:** `pip install -e .` in a clean venv; CI green on an empty test suite.

### PR 2 — Odoo client (`odoo.py`)
- **Scope:** Port `normalize_phone` + `crm.lead/search_read` from the reference JS.
  `search_leads(since)` → leads DataFrame with `id, name, phone, mobile, user_id,
  stage_id, probability, type, expected_revenue, date_closed, active, create_date,
  write_date`. Disable `active_test` so lost leads are included.
- **Tests:** `normalize_phone` edge cases, domain construction, `{result}` unwrap,
  archived-lead inclusion (mocked HTTP).
- **Acceptance:** manual/integration check fetches a known phone's opportunity with
  stage + `expected_revenue`.

### PR 3 — Retell client (`retell.py`) + `pull` CLI
- **Scope:** Paginated list-calls (`RETELL_API_KEY`), normalize to call records
  (`call_id, from_number, ts, duration, cost, direction, disconnection_reason,
  sentiment`). Dedup on `call_id`. Add `pull` subcommand (optionally cache raw pulls
  to disk for reproducibility).
- **Tests:** response→record mapping, pagination, dedup idempotency.
- **Acceptance:** `python -m retell_sync pull` returns/persists a normalized call set.

### PR 4 — Conversion join + funnel (`conversion.py`), pure functions
- **Scope:** Join calls + leads on normalized phone; tag `after_hours` from the
  business-hours config; map `stage_id` → ordered funnel position; compute
  `conversion_by_call` + `conversion_funnel` frames and KPIs (conversion rate,
  $/after-hours call, weighted pipeline = Σ revenue×probability).
- **Tests:** synthetic calls+leads → expected funnel/KPIs; after-hours boundary;
  multi-match tie-break; won/lost classification.
- **Acceptance:** unit tests green; no IO in this module.

### PR 5 — Orchestration + outputs (`output.py`, `cli.py run`)
- **Scope:** `run` command wires pull → join → write `conversion_by_call.csv`,
  `conversion_funnel.csv`, `conversion.json` (JSON-safe: no NaN/numpy/timestamps).
  Guard each external pull so one API outage produces a clear error, not a crash.
- **Tests:** end-to-end on mocked API responses produces all three files.
- **Acceptance:** `python -m retell_sync run` writes the three deliverables.

### PR 6 — Dashboard (optional, can be its own later milestone)
- **Scope:** A view over `conversion.json` — simplest is a single self-contained HTML
  page; React only if you want parity with other DKB dashboards.
- **Acceptance:** funnel + $/after-hours-call render from a real `conversion.json`.

### PR 7 — Scheduling + docs
- **Scope:** Daily run (Windows Task Scheduler script or GitHub Actions cron;
  Azure Python timer Function optional/off-machine). README ops section,
  `.env.example` finalized.
- **Acceptance:** documented one-command daily run; no secrets committed.

---

## Dependency order
`PR1 → PR2, PR3 (parallel) → PR4 → PR5 → PR6, PR7 (parallel)`

## End-to-end verification (after PR5)
1. Venv at `~/.venvs/retell-sync`; `pip install -e .`.
2. `pull` a 7-day window; confirm calls come back normalized and deduped.
3. Pick 2–3 real after-hours calls with known outcomes; confirm
   `conversion_by_call.csv` maps them to the right lead/stage.
4. `run` → three deliverables written; after-hours vs business-hours counts and
   $/call are plausible.

## First riskiest checks (do early)
- **PR2:** verify the `active_test`-disabled query actually returns lost/archived
  leads — the entire "lost" arm of the funnel depends on it.
- **PR4:** most of the value and the subtle bugs live here; it's pure functions, so
  test it hard with synthetic data.
