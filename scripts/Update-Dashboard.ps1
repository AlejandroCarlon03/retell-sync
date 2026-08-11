<#
.SYNOPSIS
  One-command update + redeploy of the internal retell-sync dashboard on the server.

.DESCRIPTION
  Pulls the latest main into the server's clone and redeploys only what changed:
    - reinstalls the service venv *only* if Python dependencies (pyproject.toml) changed
      (the editable install already picks up plain .py edits, so no reinstall needed for those);
    - rebuilds the static web viewer *only* if the frontend changed, running `npm ci`
      first *only* if frontend dependencies changed;
    - deploys the built site to the IIS web root, purging stale hashed asset files
      WITHOUT touching the live conversion.json the nightly task publishes there.

  Data refreshes on its own via the "Retell Dashboard Refresh" scheduled task; pass
  -RefreshData to also pull fresh Retell + Odoo data immediately.

  Run ELEVATED on the server (needs write access to the IIS web root):
    powershell -ExecutionPolicy Bypass -File C:\Tools\retell-sync\scripts\Update-Dashboard.ps1
    ... -RefreshData      # also pull fresh data now
    ... -Force            # rebuild/redeploy even if git reports no changes

.PARAMETER Repo
  Path to the server's retell-sync clone.

.PARAMETER WebRoot
  IIS physical path the static dashboard is served from.

.PARAMETER Python
  Path to the service venv's python.exe (used only when Python deps changed, or with -RefreshData).

.PARAMETER RefreshData
  Also run scripts\Publish-Dashboard-Data.ps1 to pull fresh data and republish conversion.json now.

.PARAMETER Force
  Rebuild and redeploy the frontend (and reinstall the venv) even if git reports no changes.
#>
[CmdletBinding()]
param(
  [string]$Repo    = 'C:\Tools\retell-sync',
  [string]$WebRoot = 'C:\inetpub\retell-dashboard',
  [string]$Python  = 'C:\ProgramData\retell-sync\venv\Scripts\python.exe',
  [switch]$RefreshData,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

# robocopy uses exit codes 0-7 for success (bit flags); >=8 is a real failure.
function Assert-Exit([string]$what, [int]$max = 0) {
  if ($LASTEXITCODE -gt $max) { throw "$what failed (exit code $LASTEXITCODE)." }
}

# --- preconditions ---------------------------------------------------------
foreach ($p in @($Repo, $WebRoot)) {
  if (-not (Test-Path $p)) { throw "Path not found: $p" }
}
if (-not (Test-Path $Python))                              { throw "Service venv python not found: $Python" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is not on PATH." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is not on PATH." }

$frontend = Join-Path $Repo 'dashboard\frontend'
$dist     = Join-Path $frontend 'dist'
Set-Location $Repo

# --- 1. pull latest --------------------------------------------------------
$branch = (& git rev-parse --abbrev-ref HEAD); Assert-Exit 'git rev-parse'
$before = (& git rev-parse HEAD);              Assert-Exit 'git rev-parse'
Write-Host "Pulling latest on '$branch'..."
& git pull --ff-only; Assert-Exit 'git pull'
$after  = (& git rev-parse HEAD);              Assert-Exit 'git rev-parse'

if ($before -eq $after) {
  Write-Host "Repo already up to date ($($after.Substring(0,7)))."
  $changed = @()
} else {
  $changed = @(& git diff --name-only $before $after)
  Write-Host "Updated $($before.Substring(0,7)) -> $($after.Substring(0,7)) ($($changed.Count) file(s))."
}

# git diff --name-only uses forward slashes; pyproject.toml sits at the repo root.
$pyChanged = [bool]($Force -or ($changed -match '(^|/)pyproject\.toml$'))
$feChanged = [bool]($Force -or ($changed -match '^dashboard/frontend/'))
$feDeps    = [bool]($Force -or ($changed -match '^dashboard/frontend/(package\.json|package-lock\.json)$'))

if (-not ($pyChanged -or $feChanged) -and -not $RefreshData) {
  Write-Host "Nothing to redeploy. (-Force to rebuild anyway, -RefreshData to refresh data.)"
  return
}

# --- 2. service venv (only if Python deps changed) -------------------------
if ($pyChanged) {
  Write-Host "Python dependencies changed - reinstalling the service venv..."
  & $Python -m pip install -e $Repo; Assert-Exit 'pip install -e'
}

# --- 3. rebuild + redeploy the web viewer (only if the frontend changed) ---
if ($feChanged) {
  Push-Location $frontend
  try {
    if ($feDeps -or -not (Test-Path (Join-Path $frontend 'node_modules'))) {
      Write-Host "Installing frontend dependencies (npm ci)..."
      & npm ci; Assert-Exit 'npm ci'
    }
    Write-Host "Building the static viewer (build:static)..."
    & npm run build:static; Assert-Exit 'npm run build:static'
  } finally { Pop-Location }

  if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw "Build produced no dist\index.html." }

  Write-Host "Deploying to $WebRoot..."
  # Root files (index.html, favicon, ...) copied without deletion, so the live
  # conversion.json at the web root is preserved. Assets are handled separately.
  & robocopy $dist $WebRoot /E /XD (Join-Path $dist 'assets') /NFL /NDL /NJH /NJS /NP | Out-Null
  Assert-Exit 'robocopy (root files)' 7
  # Mirror just the assets folder to purge stale hashed bundles from old builds.
  & robocopy (Join-Path $dist 'assets') (Join-Path $WebRoot 'assets') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  Assert-Exit 'robocopy (assets)' 7
  Write-Host "Web viewer redeployed."
}

# --- 4. optional immediate data refresh ------------------------------------
if ($RefreshData) {
  Write-Host "Refreshing data now..."
  & (Join-Path $Repo 'scripts\Publish-Dashboard-Data.ps1') -Python $Python -Repo $Repo -WebRoot $WebRoot
}

# index.html now ships with a no-cache header (frontend/public/web.config on IIS,
# and the host's own static-file policy), so a redeploy is picked up on the next
# normal load — no Ctrl+F5 needed. The one exception is a browser that cached the
# OLD (pre-web.config) index.html heuristically; that tab needs a single hard
# refresh, after which it revalidates every load like the rest.
Write-Host "Done. Reload the dashboard to pick up UI changes (Ctrl+F5 once if it was open before this deploy)."
