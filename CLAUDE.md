# CLAUDE.md

retell-sync joins Retell AI call logs with Odoo CRM leads to measure after-hours call
conversion and what it's worth in dollars. It has three parts: a Python CLI (`retell_sync`)
that pulls, joins and writes the reports; a React dashboard; and a .NET 10 Photino desktop
host that serves the dashboard and its `/api/*` endpoints. README.md covers usage,
SETUP.md the server install, and DESIGN.md / PRODUCT.md the dashboard's design and intent.

## Layout

- `retell_sync/`: the Python package (3.11+). `cli.py` is the entry point (`retell-sync`,
  `python -m retell_sync`) and `config.py` reads every env var. `retell.py` and `odoo.py`
  are the API clients, `conversion.py` does the call → lead join and metrics, and
  `output.py` writes the reports. `sla.py`, `digest.py`, `scorecard.py`, `mailer.py` and
  `sendlog.py` handle the overdue digest, the weekly scorecard, Graph email and the send
  log. `callids.py` is the opt-in call-id write-back to Odoo.
- `tests/`: pytest. Fully mocked with a fake `requests.Session`, no network.
- `dashboard/frontend/`: React 19 + TypeScript + Vite + Recharts, with oxlint and vitest.
  `src/api/client.ts` is the only code that talks to the host.
- `dashboard/host/`: the .NET 10 Photino host. `ApiServer.cs` defines the HTTP API.
- `dashboard/host.tests/`: xUnit tests for the host.
- `scripts/`: PowerShell to publish the app, data, installer and updates, plus
  `make_logo.py`. `installer/` holds the Inno Setup script.
- `samples/`: reference `conversion.json` / `history.json`, i.e. the data contract.

## Check suite (same as CI)

Python, from the repo root (the local venv is `~/.venvs/retell-sync`):

```bash
pip install -e ".[dev]"
ruff check .
pytest
```

Frontend, in `dashboard/frontend`:

```bash
npm ci
npm run lint
npm run test
npm run build
```

Host:

```bash
dotnet build dashboard/host -c Release -p:SkipFrontend=true
dotnet test dashboard/host.tests -c Release -p:SkipFrontend=true
```

## Fixed contracts

Don't change these unless explicitly asked:

- The shape of `outputs/conversion.json`, `history.json`, and the CSVs
  (`conversion_by_call.csv`, `conversion_funnel.csv`). The dashboard reads them, and
  `samples/` shows the format.
- The HTTP API between `dashboard/host/ApiServer.cs` and
  `dashboard/frontend/src/api/client.ts`.
- CLI commands, flags and env var names. Keep `.env.example` in sync with `config.py`.

## Safety rules

- Never call live Retell, Odoo or email (Microsoft Graph). Don't run `retell-sync run`
  or `pull`, `alert` / `scorecard` / `notify-failure` without `--dry-run`, or
  `backfill-call-ids --apply`. Use tests and mocks.
- `.env` holds real credentials. Never print it or commit it.
- Ask before deleting a file, adding a dependency, or a refactor that touches more than
  about 5 files.
- Keep the existing style: ruff (configured in `pyproject.toml`: line length 100,
  py311), oxlint, and the current naming.

## Don't touch

- Third-party design tooling (gitignored): `.github/skills/`, `.github/agents/`,
  `.github/hooks/`, `.impeccable/`. Also `.claude/`.
- Build and runtime output: `dist/`, `bin/`, `obj/`, `app/`, `node_modules/`, `outputs/`,
  `data/`, `*.egg-info`, and caches.

## Git

- Branch off `main` (`feature/…`, `fix/…`, `docs/…`, `chore/…`).
- One concern per commit.
- Merge through a PR (squash-merged) once the check suite passes, then delete the branch.
