<#
.SYNOPSIS
  Build the Retell Dashboard desktop app (RetellDashboard.exe) and add shortcuts.

.DESCRIPTION
  Produces a double-click app: a single self-contained RetellDashboard.exe (no
  .NET install needed to run it) plus its wwwroot UI folder, published to
  <repo>\app. Opening it shows the dashboard window straight away on the last
  saved data and pulls fresh Retell + Odoo data in the background. No console.

  The exe lives inside the repo on purpose: it finds outputs\, data\ and the
  Python package by walking up to pyproject.toml, exactly like the dev build.

  Steps:
    1. Sets up the per-user Python venv (%USERPROFILE%\.venvs\retell-sync) the
       app runs its data pull with, if it's missing (kept off OneDrive).
    2. Builds the desktop (non-static) frontend.
    3. dotnet publish -> <repo>\app\RetellDashboard.exe.
    4. Creates "Retell Dashboard" shortcuts on the Desktop and in the Start menu.

  Re-run it after pulling new code to update the app. Close the dashboard first:
  Windows won't let a running exe be replaced.

    powershell -ExecutionPolicy Bypass -File scripts\Publish-App.ps1
    ... -NoShortcut         # just (re)build the app
    ... -SkipPythonSetup    # the machine provides RETELL_SYNC_PYTHON instead

  Building needs the .NET 10 SDK, Node.js and Python 3.11+. Running the built app
  needs only Python (for the data pull) and the WebView2 runtime (built into
  Windows 11).

.PARAMETER OutDir
  Where to publish the app (default: <repo>\app).

.PARAMETER NoShortcut
  Don't create or update the Desktop / Start menu shortcuts.

.PARAMETER SkipPythonSetup
  Don't create the per-user venv (e.g. the server sets RETELL_SYNC_PYTHON to its
  service venv machine-wide).
#>
[CmdletBinding()]
param(
  [string]$OutDir,
  [switch]$NoShortcut,
  [switch]$SkipPythonSetup
)

$ErrorActionPreference = 'Stop'

function Assert-Exit([string]$what) {
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." }
}

$Repo     = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $Repo 'dashboard\frontend'
$hostProj = Join-Path $Repo 'dashboard\host\RetellSync.Dashboard.csproj'
if (-not $OutDir) { $OutDir = Join-Path $Repo 'app' }
$exe      = Join-Path $OutDir 'RetellDashboard.exe'

foreach ($tool in 'dotnet', 'npm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH." }
}

# --- 1. Python environment for the in-app data pull -----------------------
if (-not $SkipPythonSetup) {
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

# --- 2. Desktop frontend ----------------------------------------------------
# Always the normal build: the server's update script leaves a *static* build in
# dist (no host features), which must never be what the desktop app ships.
Push-Location $frontend
try {
  if (-not (Test-Path 'node_modules')) {
    Write-Host 'Installing UI dependencies (npm ci)...'
    & npm ci; Assert-Exit 'npm ci'
  }
  Write-Host 'Building the dashboard UI...'
  & npm run build; Assert-Exit 'npm run build'
} finally { Pop-Location }

# --- 3. Publish the exe -----------------------------------------------------
if (Get-Process -Name 'RetellDashboard' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $exe }) {
  throw "The dashboard is open ($exe). Close it, then run this again."
}

Write-Host "Publishing RetellDashboard.exe to $OutDir ..."
& dotnet publish $hostProj -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -p:DebugType=none `
    -p:SkipFrontend=true `
    -o $OutDir
Assert-Exit 'dotnet publish'
if (-not (Test-Path $exe)) { throw "Publish produced no $exe." }

# --- 4. Shortcuts -------------------------------------------------------------
if (-not $NoShortcut) {
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

$sizeMb = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host "Done: $exe ($sizeMb MB). Double-click it (or the shortcut) to open the dashboard."
