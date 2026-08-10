# retell-sync — shared VM server setup (multi-admin)

This is the one-time setup that lets **any DKB admin** run retell-sync's full dashboard
by RDP-ing into the shared Windows VM server and double-clicking one file. It replaces the
"each person installs it on their own laptop" model — the runtimes and secrets live on the
server, so a second admin needs *zero* local setup.

> **Discoverability copy:** a pointer to this lives at
> `\\dkb.local\dfs\_Software\retell-sync\`. The **running** copy is on the server's local
> disk at `C:\Tools\retell-sync` (see step 3 for why local, not the share).

> **Host choice:** prefer an internal **member server** (or an internal Linux + nginx box),
> **not a domain controller**. Running IIS + Node + Python and a SYSTEM scheduled task on a
> DC widens the attack surface of your most security-critical machine and is against
> hardening best practice. Nothing here assumes a DC — the same steps work on any internal,
> non-DC server. Whatever the host, keep the viewer **internal/VPN-only**; never expose the
> data (customer PII) through a public proxy.

## How it works

- retell-sync is a three-runtime stack: a **Python 3.11+** CLI (`python -m retell_sync run`)
  that pulls Retell + Odoo data, a **.NET 9** Photino host that opens the dashboard window,
  and a **React/Vite** frontend the host serves. `Retell-Dashboard.cmd` glues all three
  together on one double-click.
- Config is read by `AppConfig.from_env()`, which calls `load_dotenv(override=False)` —
  **real OS environment variables win over `.env`**. So when the three secrets are set as
  System env vars on the server, **no `.env` file is needed at all**, and the launcher
  skips its first-run Notepad prompt automatically.
- The venv lives per-user at `%USERPROFILE%\.venvs\retell-sync`, so each admin who logs in
  auto-builds their own on first launch (~1 min, self-healing). The source tree is shared.

## One-time server provisioning (do this once, elevated, over RDP)

### 1. Install the three runtimes system-wide (skip any already present)

- Python 3.11+ — **check "Add python.exe to PATH"** during install.
- .NET 9 SDK.
- Node.js LTS.

Verify in a fresh shell:

```bat
python --version
dotnet --version
node --version
```

### 2. Set the secrets as System (Machine-scope) env vars

So every admin who logs into the server inherits them. From an **elevated** prompt:

```bat
setx /M RETELL_API_KEY "<retell key>"
setx /M ODOO_URL "<odoo REST base url, no trailing slash>"
setx /M ODOO_API_KEY "<odoo bearer token>"
```

Optional but recommended so the dashboard's Odoo deep-links resolve:

```bat
setx /M ODOO_WEB_URL "https://dkbinc.co"
```

Do **not** copy the populated `.env` off anyone's laptop into the share or the server —
set the values as env vars here instead. Confirm in a **new** shell (`setx` only affects
future shells):

```bat
echo %RETELL_API_KEY%
echo %ODOO_URL%
echo %ODOO_API_KEY%
```

### 3. Put the code on the server's local disk

Use `C:\Tools\retell-sync` (local disk), **not** a `\\dkb.local\dfs\...` UNC path — the
editable `pip install -e .` and .NET's `bin`/`obj` writes don't belong on a DFS share, and
local avoids share-locking and perf issues.

**Preferred — git clone** (enables one-command updates), if the server can reach GitHub:

```bat
git clone https://github.com/AlejandroCarlon03/retell-sync C:\Tools\retell-sync
```

**Fallback — copy the working tree**, excluding build/venv/secret artifacts:

```bat
robocopy <source> C:\Tools\retell-sync /E /XD node_modules bin obj .venv .git /XF .env
```

### 4. First launch

Double-click `C:\Tools\retell-sync\Retell-Dashboard.cmd`. With the runtimes installed and
the System env vars set, it goes straight to: build venv → pull live data → build the UI →
open the dashboard window. No `.env`, no Notepad detour.

## Day-to-day use (any admin)

1. RDP into the VM server (mRemoteNG → the Windows VM).
2. Double-click `C:\Tools\retell-sync\Retell-Dashboard.cmd`.
3. First time *for that account only*, the per-user venv builds (~1 min). After that it's
   pull-fresh-data-and-open-window every time.

## Updating

- **git-clone install:** `git pull` in `C:\Tools\retell-sync`, then relaunch — the launcher
  re-runs `pip install -e .` (picks up Python changes) and rebuilds the frontend.
- **copy install:** re-run the same `robocopy` command (its `/XF .env` avoids clobbering,
  and secrets live in env vars, not files).

## Read-only web viewer (salespeople / non-admins)

Anyone who only needs to **look** at the numbers (e.g. a salesperson) does **not** need
the runtimes, the secrets, or RDP. The dashboard is a static React page whose only real
dependency is a `conversion.json` file — so we serve a built copy over **internal IIS** on
the DKB network and refresh the JSON on a schedule. Viewers just open a bookmarked URL.

> **Never host this on a public URL** (GitHub Pages, public Azure, etc.). `conversion.json`
> contains customer phone numbers, lead names, and revenue. It must stay on the internal
> network. The network boundary *is* the access control — there is no login.

**Architecture:** a *producer* (the Python `run`, has the secrets, runs nightly on the
server) writes a fresh `conversion.json`; a *viewer* (the static frontend + that JSON on
IIS) renders it. The admin Photino desktop app is unaffected and keeps working.

### One-time server setup (elevated)

1. **Service venv** (fixed path, independent of any user profile, so a SYSTEM task can use it):
   ```bat
   python -m venv C:\ProgramData\retell-sync\venv
   C:\ProgramData\retell-sync\venv\Scripts\python.exe -m pip install -e C:\Tools\retell-sync
   ```
2. **Enable IIS** — the "Web Server (IIS)" role / "Internet Information Services" Windows
   feature. The default `.json` MIME mapping is fine; because the app uses hash routing,
   **no URL Rewrite module or SPA-fallback rule is needed**.
3. **Build the static viewer and deploy it once:**
   ```bat
   cd C:\Tools\retell-sync\dashboard\frontend
   npm ci
   npm run build:static
   robocopy dist C:\inetpub\retell-dashboard /E
   copy C:\Tools\retell-sync\outputs\conversion.json C:\inetpub\retell-dashboard\
   ```
   `build:static` (vs plain `build`) produces a bundle that fetches a sibling
   `./conversion.json` instead of the desktop host's `/api/conversion` route.
4. **Create the IIS site** (e.g. "retell-dashboard") with physical path
   `C:\inetpub\retell-dashboard`, bound to an internal hostname or a chosen port. It is
   reachable only on the DKB LAN.
5. **Schedule the nightly refresh** — a Task Scheduler task, e.g. 05:00, **Run whether user
   is logged on or not**, as **SYSTEM** (it inherits the Machine-scope secrets and has
   outbound HTTPS to Retell/Odoo). Action:
   ```
   powershell -ExecutionPolicy Bypass -File C:\Tools\retell-sync\scripts\Publish-Dashboard-Data.ps1
   ```
   That script pulls fresh data and copies `conversion.json` into the web root. Run it once
   by hand first to confirm it works (it doubles as a manual "refresh now").
6. Give salespeople the URL, e.g. `http://<internal-host>/` — nothing to install, no login.

### Updating the deployment after a code change

Once features are merged to `main`, update the server with the one-command script
(run **elevated**, since it writes to the IIS web root):

```
powershell -ExecutionPolicy Bypass -File C:\Tools\retell-sync\scripts\Update-Dashboard.ps1
```

`Update-Dashboard.ps1` pulls the latest `main` and redeploys only what changed: it
reinstalls the service venv only if `pyproject.toml` changed (plain `.py` edits are already
live via the editable install), rebuilds the static viewer only if the frontend changed
(running `npm ci` only if frontend deps changed), and redeploys to the web root — purging
stale hashed asset bundles **without** deleting the live `conversion.json`. Flags:

- `-RefreshData` — also pull fresh Retell + Odoo data now (otherwise the nightly task
  keeps it current).
- `-Force` — rebuild/redeploy even if git reports no changes.

After it runs, hard-refresh the dashboard (Ctrl+F5) to pick up UI changes. The admin
desktop app updates itself: after the pull, admins just relaunch `Retell-Dashboard.cmd`.

## Troubleshooting

- **Launcher opens Notepad on the server** → the three env vars aren't visible to this
  shell. Re-check step 2 with a *new* shell; make sure you used `setx /M` (Machine scope).
- **"Python/.NET not found"** → runtime missing from PATH; re-run step 1 and reopen the
  shell.
- **UI didn't change after an update** → the frontend rebuilds on launch when Node is
  present; confirm `node --version` works, or delete `dashboard\frontend\dist` and relaunch.
- **Data pull fails but window still opens** → the launcher opens the last saved data; the
  error above the window names which API (Retell or Odoo) failed.
