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
  that pulls Retell + Odoo data, a **.NET 10** Photino host that opens the dashboard window,
  and a **React/Vite** frontend the host serves. `scripts\Publish-App.ps1` packages them as
  one double-click app, `C:\Tools\retell-sync\app\RetellDashboard.exe`, which opens the
  window and pulls fresh data in the background.
- Config is read by `AppConfig.from_env()`, which calls `load_dotenv(override=False)` —
  **real OS environment variables win over `.env`**. So when the three secrets are set as
  System env vars on the server, **no `.env` file is needed at all**, and the launcher
  skips its first-run Notepad prompt automatically.
- The venv lives per-user at `%USERPROFILE%\.venvs\retell-sync`, so each admin who logs in
  auto-builds their own on first launch (~1 min, self-healing). The source tree is shared.

## One-time server provisioning (do this once, elevated, over RDP)

### 1. Install the three runtimes system-wide (skip any already present)

- Python 3.11+ — **check "Add python.exe to PATH"** during install.
- .NET 10 SDK (the dashboard targets `net10.0`; .NET 9 support ends 2026-11-10).
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

To also send the **after-hours callback SLA digest** email, add the M365/Graph
secrets and a recipient — see [After-hours callback SLA digest](#after-hours-callback-sla-digest-email)
below for how to obtain them:

```bat
setx /M GRAPH_TENANT_ID "<entra tenant id>"
setx /M GRAPH_CLIENT_ID "<app registration (client) id>"
setx /M GRAPH_CLIENT_SECRET "<client secret value>"
setx /M ALERT_FROM "afterhours@dkbinc.co"
setx /M ALERT_TO "you@dkbinc.co"
setx /M RETELL_ALERT_ENABLED "true"
setx /M RETELL_ALERT_SLA_HOURS "48"
setx /M RETELL_ALERT_PER_REP "true"
```

To also email each salesperson their own overdue leads (in addition to the manager
digest sent to `ALERT_TO`), set `RETELL_ALERT_PER_REP=true`. Rep→email is read from
Odoo `res.users` by salesperson name; for any rep whose Odoo user has no email (or a
wrong one), add an override:

```bat
setx /M ALERT_REP_EMAILS "Jane Doe=jane@dkbinc.co;Rob Roe=rob@dkbinc.co"
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

### 4. Build the desktop app

From an elevated shell, build the app once and point it at the service venv (created in the
nightly-refresh section below), so admins don't each need their own Python environment:

```bat
setx /M RETELL_SYNC_PYTHON C:\ProgramData\retell-sync\venv\Scripts\python.exe
powershell -ExecutionPolicy Bypass -File C:\Tools\retell-sync\scripts\Publish-App.ps1 -SkipPythonSetup -NoShortcut
```

Each admin can then pin `C:\Tools\retell-sync\app\RetellDashboard.exe`, or run
`Publish-App.ps1` (without `-NoShortcut`) as themselves to get Desktop and Start menu
shortcuts. Without `RETELL_SYNC_PYTHON`, the app uses the per-user venv at
`%USERPROFILE%\.venvs\retell-sync`, which `Publish-App.ps1` creates.

`Retell-Dashboard.cmd` still works as a console fallback: it builds the per-user venv,
pulls data, rebuilds the UI and opens the window via `dotnet run`.

## Day-to-day use (any admin)

1. RDP into the VM server (mRemoteNG → the Windows VM).
2. Open **Retell Dashboard** (`C:\Tools\retell-sync\app\RetellDashboard.exe`). The window
   opens on the last saved data and refreshes itself once the background pull lands
   (usually within seconds). Opening it never sends the SLA emails; that's the nightly
   task's job.

## Updating

- **git-clone install:** run `Update-Dashboard.ps1` (below). It also republishes the desktop
  app when the dashboard changed; ask admins to close it first, since Windows won't replace
  a running exe.
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
server) writes a fresh `conversion.json` and `history.json`; a *viewer* (the static
frontend + those files on IIS) renders them. The admin Photino desktop app is unaffected
and keeps working.

**Desktop viewer for staff:** a desktop app that embeds this same static frontend and reads
the files from this IIS site. It depends on the nightly task below; if the published report
is more than 36 hours old the viewer shows a "This report is N days old" notice. There are
two ways to hand it out:

- **Installer** (`RetellDashboard-Viewer-Setup-<version>.exe`, from GitHub Releases or
  `scripts\Build-Installer.ps1`):
  - Installs per user to `%LOCALAPPDATA%\Programs\Retell Dashboard Viewer` (no admin rights).
  - Installs the WebView2 runtime if it's missing. Pre-Windows 11 PCs need internet the
    first time.
  - Writes the server address to `%LOCALAPPDATA%\RetellDashboard\viewer.json`.

  To roll it out silently (e.g. with Intune or a login script):
  ```bat
  RetellDashboard-Viewer-Setup-1.0.0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DATAURL=http://192.168.10.32:8090/
  ```
  To upgrade, run the newer installer the same way. It closes an open dashboard and keeps
  the address. To uninstall, use Apps & features or run
  `"%LOCALAPPDATA%\Programs\Retell Dashboard Viewer\unins000.exe" /VERYSILENT`. A silent
  uninstall keeps `viewer.json`; the interactive one asks first.
- **Single exe** (`scripts\Publish-App.ps1 -Viewer`): copy `Retell Dashboard.exe` to a PC or
  to `\\dkb.local\dfs\_Software\retell-sync\`.

**Code signing.** Both builds are unsigned by default. When someone downloads an unsigned
installer, SmartScreen shows *"Windows protected your PC"* with *Publisher: Unknown
publisher*, and they have to click **More info → Run anyway**.

To sign, set `RETELL_SIGN_COMMAND` to a command that signs one file, using `$f` for the
path. Example with a code-signing certificate:
`signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /f C:\certs\dkb.pfx /p <password> $f`.
Azure Trusted Signing plugs in the same way. `Build-Installer.ps1` then signs the viewer
exe, the setup and its uninstaller.

In CI, store that command as the repo secret `RETELL_SIGN_COMMAND`. To change the default
server, set the repo variable `VIEWER_DATA_URL`. A signed installer names the publisher
right away, but SmartScreen can keep warning until the certificate builds reputation.

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

   **If a refresh fails**, the script emails the error and the last 40 lines of
   `outputs\nightly.log` to `RETELL_FAILURE_TO` (else `ALERT_TO`) via
   `python -m retell_sync notify-failure`. It uses the same Graph secrets as the SLA
   digest (see [Env vars](#env-vars)), and the task still ends as failed in Task Scheduler.
   Without those secrets it just logs a warning. To preview the email:
   `python -m retell_sync notify-failure --reason "test" --dry-run`. When testing by hand,
   pass `-NoFailureAlert` to skip the email.
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

After it runs, hard-refresh the dashboard (Ctrl+F5) to pick up UI changes. If the dashboard
host or frontend changed, it also republishes `app\RetellDashboard.exe` (skipped with a
warning if an admin has it open; re-run with `-Force` once it's closed).

## After-hours callback SLA digest (email)

retell-sync can email a daily **SLA digest**: the after-hours callers who phoned the
Retell line, were matched to an Odoo lead, and still haven't been called back after
`SLA_HOURS` (the rep hasn't advanced the lead's stage). Each row links straight to the
Odoo lead and the Retell call. Detection is read-only over data the nightly `run`
already produces — no extra Odoo pull — and delivery is one M365 email via Microsoft
Graph.

**How it's sent.** The nightly `run` (see the scheduled task above) sends the digest at
the end of the run when `RETELL_ALERT_ENABLED=true`. You can also send/preview on demand:

```bat
python -m retell_sync alert --dry-run   REM print the overdue table, send nothing
python -m retell_sync alert             REM detect + email the digest
```

Nothing is sent when nobody is overdue.

### One-time Entra (Azure AD) app registration

Delivery uses Graph's **application (app-only) `Mail.Send`** with the client-credentials
flow — no signed-in user, so a headless SYSTEM task can send unattended. Scope it to the
single sender mailbox with an Application Access Policy so the app can't mail as anyone
else in the tenant.

1. **Entra admin center → App registrations → New registration.** Name it e.g.
   `retell-sync-mailer`, single-tenant, no redirect URI. Note the **Application (client)
   ID** and **Directory (tenant) ID** → `GRAPH_CLIENT_ID` / `GRAPH_TENANT_ID`.
2. **API permissions → Add a permission → Microsoft Graph → Application permissions →
   `Mail.Send`.** Then **Grant admin consent** (the status must show a green check). Do
   **not** add the delegated `Mail.Send`; app-only is what the client-credentials flow uses.
3. **Certificates & secrets → New client secret.** Copy the secret **Value** (not the
   Id) immediately → `GRAPH_CLIENT_SECRET`. Note its expiry and set a reminder to rotate.
4. **Scope the app to one mailbox** (so `Mail.Send` can't send as the whole tenant). In
   an elevated PowerShell with the Exchange Online module
   (`Install-Module ExchangeOnlineManagement`):
   ```powershell
   Connect-ExchangeOnline
   New-DistributionGroup -Name "retell-sync-senders" -Type Security `
     -Members afterhours@dkbinc.co
   New-ApplicationAccessPolicy -AppId "<GRAPH_CLIENT_ID>" `
     -PolicyScopeGroupId "retell-sync-senders" -AccessRight RestrictAccess `
     -Description "retell-sync may send only as the after-hours mailbox"
   Test-ApplicationAccessPolicy -Identity afterhours@dkbinc.co -AppId "<GRAPH_CLIENT_ID>"
   ```
   `ALERT_FROM` must be a real mailbox in that group. (Policy changes can take up to ~30
   minutes to apply.)

### Env vars

Set these as Machine-scope env vars (step 2 above) so the SYSTEM nightly task inherits them:

| Variable | Meaning |
| --- | --- |
| `GRAPH_TENANT_ID` | Directory (tenant) ID of the app registration |
| `GRAPH_CLIENT_ID` | Application (client) ID |
| `GRAPH_CLIENT_SECRET` | Client secret **value** |
| `ALERT_FROM` | Sender mailbox (must be in the access-policy group) |
| `ALERT_TO` | Manager digest recipient(s), comma-separated |
| `RETELL_ALERT_ENABLED` | `true` to send from the nightly `run` (default off) |
| `RETELL_ALERT_SLA_HOURS` | Overdue threshold in hours (default `48`) |
| `RETELL_ALERT_MAX_AGE_DAYS` | Only calls from the last N days count toward the digest (default `35`; `0` = no cap). The dashboard pull covers all history, so this keeps old leads out of the emails |
| `RETELL_ALERT_PER_REP` | `true` to also email each salesperson their own overdue leads (default off) |
| `ALERT_REP_EMAILS` | Manual `Name=addr;…` overrides for reps missing an Odoo email |
| `RETELL_SCORECARD_ENABLED` | `true` to enable the weekly rep scorecard email (default off) |
| `RETELL_SCORECARD_TO` | Scorecard recipient(s), comma-separated (defaults to `ALERT_TO`) |
| `RETELL_FAILURE_TO` | Who is emailed when the nightly refresh fails, comma-separated (defaults to `ALERT_TO`). Not gated by `RETELL_ALERT_ENABLED` |

The **weekly rep scorecard** is a separate command — a ranked per-salesperson
leaderboard (calls, leads, won deals, won revenue, win rate, overdue-now) emailed to
managers. Preview it with `python -m retell_sync scorecard --dry-run`, and schedule it
weekly with a second Task Scheduler job running `python -m retell_sync scorecard`
(the nightly `run` task only sends the overdue digest).

> `ALERT_TO` is the env fallback for the recipient list; an in-app recipient editor lands
> in a later PR. All seven are read by `AppConfig.from_env()`, so a local `.env` works for
> testing too — but on the server, set them as env vars, never in a committed file.

### Verify

With `ALERT_TO` set to yourself, run `python -m retell_sync alert`. If an after-hours
caller is currently overdue you'll get an M365 email whose Odoo/Retell links open the
lead and the call; if nobody is overdue it prints "nothing to send" and mails nothing.
Missing Graph secrets produce a clear `GRAPH_… not set` error (exit 2), not a traceback.

## Exact call → lead matching (optional)

By default a call joins to a lead on the caller's phone number. When a phone matches
several leads, the most recently edited one wins, so attribution can drift as those leads
change. Storing the Retell call id that created each lead pins the match.

**1. Add the field in Odoo** (once, as an Odoo admin). Settings → Technical → Fields → New:
- Model: *Lead/Opportunity* (`crm.lead`).
- Field name: `x_retell_call_id`.
- Type: *Char*.
- Turn on *Indexed*.

Studio works too. Use the technical name it shows.

**2. Give the API key write access.** The Odoo user behind `ODOO_API_KEY` needs to be able
to edit leads.

**3. Configure it** as Machine-scope env vars on the server, like the other secrets:

| Variable | Meaning |
| --- | --- |
| `ODOO_CALL_ID_FIELD` | The field's technical name, e.g. `x_retell_call_id`. When set, every lead pull reads it, and a call whose id is stored on a lead joins to that lead exactly, ahead of the phone match |
| `RETELL_WRITE_CALL_IDS` | `true` to have the nightly `run` stamp newly attributable leads (default off). Desktop-app pulls never write |

**4. Backfill the history.** Preview first; nothing is written without `--apply`:

```bat
python -m retell_sync backfill-call-ids
python -m retell_sync backfill-call-ids --apply
```

A lead is only stamped when **all** of these hold:
- its field is empty (nothing is ever overwritten);
- the caller's phone matches exactly one lead;
- the lead was created no earlier than its first call, minus `RETELL_NEW_CLIENT_GRACE_HOURS`,
  so that call plausibly created it;
- no other lead already holds that call id.

Existing clients whose lead predates their calls are left alone, and so are phones shared by
several leads. The nightly write only runs on the full-history pull (no `--days`/`--since`),
because a windowed pull can't prove a phone has one lead. If Odoo refuses three writes in a
row, the run stops trying and says why (a missing field or a read-only key).

## Troubleshooting

- **Launcher opens Notepad on the server** → the three env vars aren't visible to this
  shell. Re-check step 2 with a *new* shell; make sure you used `setx /M` (Machine scope).
- **"Python/.NET not found"** → runtime missing from PATH; re-run step 1 and reopen the
  shell.
- **UI didn't change after an update** → the frontend rebuilds on launch when Node is
  present; confirm `node --version` works, or delete `dashboard\frontend\dist` and relaunch.
- **Data pull fails but window still opens** → the launcher opens the last saved data; the
  error above the window names which API (Retell or Odoo) failed.
- **SLA digest email never arrives** → run `python -m retell_sync alert` by hand and read the
  message. `GRAPH_… / ALERT_… not set` means the env vars aren't visible to this shell (re-check
  step 2 in a *new* shell). `Graph token 401` means a bad/expired `GRAPH_CLIENT_SECRET`. `Graph
  sendMail 403` usually means the Application Access Policy hasn't taken effect yet (wait ~30 min)
  or `ALERT_FROM` isn't in the access-policy group. "nothing to send" means nobody is overdue —
  that's success, not a failure. Note `run` never fails on a digest problem: it prints
  `run: SLA digest not sent: …` and still writes the data outputs.
