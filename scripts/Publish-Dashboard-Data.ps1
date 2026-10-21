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

  If the pull or the publish fails, the run's output (outputs\nightly.log) and the
  error are emailed via `python -m retell_sync notify-failure` to RETELL_FAILURE_TO
  (else ALERT_TO), using the same Graph secrets as the SLA digest, and the script
  still exits non-zero so Task Scheduler records the failure too. Without those
  secrets the alert is skipped with a warning. -NoFailureAlert turns it off.

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

.PARAMETER NoFailureAlert
  Don't email anyone when the refresh fails (e.g. while testing by hand).
#>
[CmdletBinding()]
param(
  [string]$Python  = 'C:\ProgramData\retell-sync\venv\Scripts\python.exe',
  [string]$Repo    = 'C:\Tools\retell-sync',
  [string]$WebRoot = 'C:\inetpub\retell-dashboard',
  [switch]$NoFailureAlert
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Python))  { throw "Service venv python not found: $Python. Create it per the header comment." }
if (-not (Test-Path $WebRoot)) { throw "Web root not found: $WebRoot. Deploy the static site first (see SETUP.md)." }

$source = Join-Path $Repo 'outputs\conversion.json'
$log    = Join-Path $Repo 'outputs\nightly.log'
$stamp  = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

try {
  Write-Host "[$stamp] Pulling fresh Retell + Odoo data..."
  New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
  # Keep this run's output for the failure alert, as UTF-8 (Windows PowerShell's
  # Tee-Object would write UTF-16). A redirected native stderr line arrives as an
  # error record, which 'Stop' would make fatal, so relax it for the call.
  Set-Content -Path $log -Value "# retell_sync run - $stamp" -Encoding UTF8
  $ErrorActionPreference = 'Continue'
  & $Python -m retell_sync run -v 2>&1 | ForEach-Object {
    $line = "$_"
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding UTF8
  }
  $runExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($runExit -ne 0) { throw "retell_sync run failed with exit code $runExit - conversion.json NOT updated." }

  if (-not (Test-Path $source)) { throw "Run reported success but $source is missing." }

  Copy-Item $source (Join-Path $WebRoot 'conversion.json') -Force
  Write-Host "[$stamp] Published conversion.json -> $WebRoot"

  # The Trends page reads history.json beside conversion.json (web viewer and the
  # shareable viewer exe). Best-effort: it only exists after the first run.
  $history = Join-Path $Repo 'outputs\history.json'
  if (Test-Path $history) {
    Copy-Item $history (Join-Path $WebRoot 'history.json') -Force
    Write-Host "[$stamp] Published history.json -> $WebRoot"
  }
} catch {
  $reason = $_.Exception.Message
  Write-Warning "[$stamp] Refresh failed: $reason"
  if (-not $NoFailureAlert) {
    # Best-effort: a failed alert is reported but never hides the original error.
    $ErrorActionPreference = 'Continue'
    & $Python -m retell_sync notify-failure --reason $reason --log $log 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { Write-Warning "Failure alert not sent (exit code $LASTEXITCODE)." }
    $ErrorActionPreference = 'Stop'
  }
  throw
}
