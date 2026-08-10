<#
.SYNOPSIS
  Refresh the internal read-only dashboard's data on the VM server.

.DESCRIPTION
  The "producer" half of the salesperson web-viewer setup (see SETUP.md). Pulls
  fresh Retell + Odoo data with `python -m retell_sync run`, then copies the
  resulting conversion.json into the IIS web root the static dashboard is served
  from. Intended to run nightly as a Task Scheduler job under SYSTEM, and also
  usable by hand as a "refresh now".

  Secrets are read from Machine-scope environment variables (RETELL_API_KEY,
  ODOO_URL, ODOO_API_KEY) via config.py's load_dotenv(override=False) - no .env
  is needed on the server.

  Uses a dedicated service venv at a fixed path (not the per-user
  %USERPROFILE%\.venvs\retell-sync one) so it works regardless of which account
  the task runs as. Create it once:
    python -m venv C:\ProgramData\retell-sync\venv
    C:\ProgramData\retell-sync\venv\Scripts\python.exe -m pip install -e C:\Tools\retell-sync

.PARAMETER Python
  Path to the service venv's python.exe.

.PARAMETER Repo
  Path to the retell-sync working copy (holds outputs\conversion.json after a run).

.PARAMETER WebRoot
  IIS physical path the static dashboard is served from; conversion.json is
  copied here.
#>
[CmdletBinding()]
param(
  [string]$Python  = 'C:\ProgramData\retell-sync\venv\Scripts\python.exe',
  [string]$Repo    = 'C:\Tools\retell-sync',
  [string]$WebRoot = 'C:\inetpub\retell-dashboard'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Python))  { throw "Service venv python not found: $Python. Create it per the header comment." }
if (-not (Test-Path $WebRoot)) { throw "Web root not found: $WebRoot. Deploy the static site first (see SETUP.md)." }

$source = Join-Path $Repo 'outputs\conversion.json'
$stamp  = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

Write-Host "[$stamp] Pulling fresh Retell + Odoo data..."
& $Python -m retell_sync run
if ($LASTEXITCODE -ne 0) { throw "retell_sync run failed with exit code $LASTEXITCODE - conversion.json NOT updated." }

if (-not (Test-Path $source)) { throw "Run reported success but $source is missing." }

Copy-Item $source (Join-Path $WebRoot 'conversion.json') -Force
Write-Host "[$stamp] Published conversion.json -> $WebRoot"
