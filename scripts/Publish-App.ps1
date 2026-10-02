<#
.SYNOPSIS
  Build the Retell Dashboard desktop app: the admin app, or the shareable viewer.

.DESCRIPTION
  Both builds are ONE self-contained exe (no .NET install needed to run it) with the
  UI embedded, and open with no console window.

  Admin app (default) -> <repo>\app\RetellDashboard.exe
    Opens straight away on the last saved data and pulls fresh Retell + Odoo data
    in the background with Python. It lives inside the repo on purpose: it finds
    outputs\, data\ and the Python package by walking up to pyproject.toml.
      1. Sets up the per-user Python venv (%USERPROFILE%\.venvs\retell-sync) the
         data pull runs with, if it's missing (kept off OneDrive).
      2. Builds the desktop UI and publishes the exe.
      3. Adds "Retell Dashboard" shortcuts to the Desktop and the Start menu.

  Viewer (-Viewer) -> <repo>\dist\viewer\Retell Dashboard.exe
    For everyone else: copy the single exe to their PC (or a share) and they
    double-click it. It shows the data the server publishes every night (-DataUrl,
    the internal web viewer), so their PC needs no Python, no repo and no API keys.
    Read-only: no Settings alerts editor, Email Log or data pull. Needs the office
    network or VPN. Refresh re-reads the server's copy.

  Re-run after pulling new code. Close the admin app first: Windows won't let a
  running exe be replaced.

    powershell -ExecutionPolicy Bypass -File scripts\Publish-App.ps1
    ... -NoShortcut         # admin: just (re)build the app
    ... -SkipPythonSetup    # admin: the machine provides RETELL_SYNC_PYTHON instead
    ... -Viewer             # build the shareable viewer exe
    ... -Viewer -DataUrl http://dashboard.dkb.local:8090/

  Building needs the .NET 10 SDK and Node.js (and Python for the admin app's venv).
  Running needs only the WebView2 runtime (built into Windows 11), plus Python for
  the admin app's data pull.

.PARAMETER OutDir
  Where to publish (default: <repo>\app, or <repo>\dist\viewer with -Viewer).

.PARAMETER NoShortcut
  Admin only: don't create or update the Desktop / Start menu shortcuts.

.PARAMETER SkipPythonSetup
  Admin only: don't create the per-user venv (e.g. the server sets RETELL_SYNC_PYTHON
  to its service venv machine-wide).

.PARAMETER Viewer
  Build the shareable read-only viewer instead of the admin app.

.PARAMETER DataUrl
  Viewer only: the internal web viewer that serves conversion.json / history.json.
  Baked into the exe; a user can still override it with RETELL_DASHBOARD_DATA_URL.
#>
[CmdletBinding()]
param(
  [string]$OutDir,
  [switch]$NoShortcut,
  [switch]$SkipPythonSetup,
  [switch]$Viewer,
  [string]$DataUrl = 'http://192.168.10.32:8090/'
)

$ErrorActionPreference = 'Stop'

function Assert-Exit([string]$what) {
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." }
}

$Repo     = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $Repo 'dashboard\frontend'
$hostProj = Join-Path $Repo 'dashboard\host\RetellSync.Dashboard.csproj'
if (-not $OutDir) { $OutDir = if ($Viewer) { Join-Path $Repo 'dist\viewer' } else { Join-Path $Repo 'app' } }
$exe      = Join-Path $OutDir 'RetellDashboard.exe'
$final    = if ($Viewer) { Join-Path $OutDir 'Retell Dashboard.exe' } else { $exe }

foreach ($tool in 'dotnet', 'npm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH." }
}

# --- 1. Python environment for the admin app's data pull --------------------
if (-not $Viewer -and -not $SkipPythonSetup) {
  $venv = Join-Path $env:USERPROFILE '.venvs\retell-sync'
  $py   = Join-Path $venv 'Scripts\python.exe'
  if (-not (Test-Path $py)) {
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
      throw 'Python 3.11+ is not on PATH (needed once to create the venv the app pulls data with).'
    }
    Write-Host "Creating the Python environment at $venv ..."
    & python -m venv $venv; Assert-Exit 'python -m venv'
    & $py -m pip install --quiet --upgrade pip; Assert-Exit 'pip upgrade'
  }
  # Windows PowerShell turns a redirected native stderr into a terminating error
  # under 'Stop', so relax it just for this probe.
  $ErrorActionPreference = 'Continue'
  & $py -c 'import retell_sync' *> $null
  $installed = $LASTEXITCODE -eq 0
  $ErrorActionPreference = 'Stop'
  if (-not $installed) {
    Write-Host 'Installing the retell-sync package into the environment...'
    & $py -m pip install --quiet -e $Repo; Assert-Exit 'pip install -e'
  }
}

# --- 2. Frontend ------------------------------------------------------------
# Admin = the desktop build (talks to the host's /api). Viewer = the static build
# (reads ./conversion.json + ./history.json, hides the admin pages). Always rebuilt:
# dist is shared, and the server's update script leaves a static build in it.
Push-Location $frontend
try {
  if (-not (Test-Path 'node_modules')) {
    Write-Host 'Installing UI dependencies (npm ci)...'
    & npm ci; Assert-Exit 'npm ci'
  }
  $script = if ($Viewer) { 'build:static' } else { 'build' }
  Write-Host "Building the dashboard UI ($script)..."
  & npm run $script; Assert-Exit "npm run $script"
} finally { Pop-Location }

# --- 3. Publish the exe -----------------------------------------------------
if (Get-Process -Name 'RetellDashboard', 'Retell Dashboard' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $final }) {
  throw "The dashboard is open ($final). Close it, then run this again."
}

$props = @(
  '-p:PublishSingleFile=true',
  '-p:IncludeNativeLibrariesForSelfExtract=true',
  '-p:EnableCompressionInSingleFile=true',
  '-p:DebugType=none',
  '-p:SkipFrontend=true',
  '-p:EmbedFrontend=true'
)
if ($Viewer) { $props += "-p:ViewerDataUrl=$DataUrl" }

Write-Host "Publishing to $OutDir ..."
# The UI is embedded now; drop a wwwroot left by an older, folder-based publish.
Remove-Item (Join-Path $OutDir 'wwwroot') -Recurse -Force -ErrorAction SilentlyContinue
& dotnet publish $hostProj -c Release -r win-x64 --self-contained true @props -o $OutDir
Assert-Exit 'dotnet publish'
if (-not (Test-Path $exe)) { throw "Publish produced no $exe." }

if ($Viewer) {
  # One friendly file to hand out; the icon is embedded, so app.ico isn't needed.
  Move-Item $exe $final -Force
  Remove-Item (Join-Path $OutDir 'app.ico') -ErrorAction SilentlyContinue
}

# --- 4. Shortcuts (admin app) ------------------------------------------------
if (-not $Viewer -and -not $NoShortcut) {
  $shell = New-Object -ComObject WScript.Shell
  $places = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
  )
  foreach ($dir in $places) {
    $lnk = $shell.CreateShortcut((Join-Path $dir 'Retell Dashboard.lnk'))
    $lnk.TargetPath       = $exe
    $lnk.WorkingDirectory = $OutDir
    $lnk.IconLocation     = "$exe,0"
    $lnk.Description      = 'After-hours call conversion dashboard (Retell + Odoo)'
    $lnk.Save()
  }
  Write-Host 'Added "Retell Dashboard" to the Desktop and the Start menu.'
}

$sizeMb = [math]::Round((Get-Item $final).Length / 1MB, 1)
if ($Viewer) {
  Write-Host "Done: $final ($sizeMb MB), reading $DataUrl"
  Write-Host 'Copy that one file to anyone who needs the dashboard (or to a shared folder).'
} else {
  Write-Host "Done: $final ($sizeMb MB). Double-click it (or the shortcut) to open the dashboard."
}
