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
      WITHOUT touching the live conversion.json the nightly task publishes there;
    - republishes the admin desktop app (app\RetellDashboard.exe, see Publish-App.ps1)
      if it's installed and the dashboard host or frontend changed.

  Data refreshes on its own via the "Retell Dashboard Refresh" scheduled task; pass
  -RefreshData to also pull fresh Retell + Odoo data immediately.

  Run ELEVATED on the server (needs write access to the IIS web root):
    powershell -ExecutionPolicy Bypass -File C:\Tools\retell-sync\scripts\Update-Dashboard.ps1
    ... -RefreshData      # also pull fresh data now
    ... -Force            # rebuild/redeploy even if git reports no changes

.PARAMETER Repo
  Path to the server's retell-sync clone.

.PARAMETER Branch
  The branch to deploy (default: main). The script fetches, switches the clone to
  this branch if it is sitting on another, and fast-forwards it against origin —
  so a server left on a stale (or since-deleted) feature branch self-corrects
  instead of pulling that branch's old code, or failing outright when its upstream
  is gone.

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
  [string]$Branch  = 'main',
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

# --- 1. fetch + fast-forward the deploy branch -----------------------------
# Deploy always tracks $Branch, regardless of what branch the clone is sitting
# on. Pulling "whatever is checked out" is how the server drifted onto a stale,
# since-deleted feature branch — whose upstream ref was gone, so `git pull`
# failed outright. Fetch explicitly (pruning deleted remotes), switch onto the
# deploy branch if needed, then fast-forward it against origin.
Write-Host "Fetching origin (pruning deleted branches)..."
& git fetch origin --prune; Assert-Exit 'git fetch'

$current = (& git rev-parse --abbrev-ref HEAD); Assert-Exit 'git rev-parse'
$switched = $false
if ($current -ne $Branch) {
  Write-Host "Clone was on '$current'; switching to deploy branch '$Branch'."
  & git checkout $Branch; Assert-Exit "git checkout $Branch"
  # The working tree just changed wholesale; the commit-diff below can't see that,
  # so force a full rebuild/redeploy regardless of what the fast-forward reports.
  $switched = $true
}

$before = (& git rev-parse HEAD); Assert-Exit 'git rev-parse'
Write-Host "Fast-forwarding '$Branch' to origin/$Branch..."
# --ff-only against the just-fetched remote ref: a clean no-op when already
# current, and a loud, safe failure (never a merge commit) if the clone has
# drifted with local commits.
& git merge --ff-only "origin/$Branch"; Assert-Exit 'git merge --ff-only'
$after  = (& git rev-parse HEAD); Assert-Exit 'git rev-parse'

if ($before -eq $after) {
  Write-Host "Repo already up to date ($($after.Substring(0,7)))."
  $changed = @()
} else {
  $changed = @(& git diff --name-only $before $after)
  Write-Host "Updated $($before.Substring(0,7)) -> $($after.Substring(0,7)) ($($changed.Count) file(s))."
}

# A branch switch (or -Force) rebuilds everything, since the working tree changed
# wholesale and the commit diff below wouldn't reflect it.
$rebuildAll = [bool]($Force -or $switched)

# git diff --name-only uses forward slashes; pyproject.toml sits at the repo root.
$pyChanged = [bool]($rebuildAll -or ($changed -match '(^|/)pyproject\.toml$'))
$feChanged = [bool]($rebuildAll -or ($changed -match '^dashboard/frontend/'))
$feDeps    = [bool]($rebuildAll -or ($changed -match '^dashboard/frontend/(package\.json|package-lock\.json)$'))
$hostChanged = [bool]($rebuildAll -or ($changed -match '^dashboard/host/'))
$appDir    = Join-Path $Repo 'app'

if (-not ($pyChanged -or $feChanged -or $hostChanged) -and -not $RefreshData) {
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

# --- 3b. republish the admin desktop app (only if it's installed here) -----
# Publish-App rebuilds the *desktop* frontend itself, so this runs after the static
# deploy above. A running copy locks the exe: warn instead of failing the deploy.
if (($feChanged -or $hostChanged) -and (Test-Path (Join-Path $appDir 'RetellDashboard.exe'))) {
  Write-Host "Republishing the desktop app ($appDir)..."
  try {
    & (Join-Path $Repo 'scripts\Publish-App.ps1') -OutDir $appDir -NoShortcut -SkipPythonSetup
  } catch {
    Write-Warning "Desktop app not republished: $($_.Exception.Message) Re-run with -Force once it's closed."
  }
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
