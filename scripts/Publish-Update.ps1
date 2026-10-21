<#
.SYNOPSIS
  Publish a viewer installer to the internal server so installed viewers offer it.

.DESCRIPTION
  Copies RetellDashboard-Viewer-Setup-<version>.exe into <WebRoot>\updates\ and
  writes <WebRoot>\updates\latest.json beside it:

    { "version": "1.0.1", "file": "RetellDashboard-Viewer-Setup-1.0.1.exe",
      "sha256": "...", "notes": "...", "published_at": "..." }

  Installed viewers read that file from the same server they read the report from
  (<data url>/updates/latest.json). When it names a newer version than theirs, the
  dashboard shows "Version X is available" with an Update now button; the app
  downloads the setup from here, checks the SHA-256 against latest.json, runs it
  silently and reopens. latest.json is written last (via a temp file + rename), so
  a viewer never sees it pointing at a half-copied installer.

    powershell -ExecutionPolicy Bypass -File scripts\Publish-Update.ps1 -WebRoot C:\inetpub\retell-dashboard
    ... -Setup dist\installer\RetellDashboard-Viewer-Setup-1.0.1.exe -Notes "Faster calls table"
    ... -WebRoot \\dkb-vm01\c$\inetpub\retell-dashboard     # from an admin PC

  Release flow: bump <Version> in dashboard/host/RetellSync.Dashboard.csproj, run
  Build-Installer.ps1, then this.

.PARAMETER WebRoot
  The IIS physical path the dashboard is served from (local path or UNC share).

.PARAMETER Setup
  The installer to publish. Default: the highest-versioned setup in dist\installer.

.PARAMETER Notes
  One line shown under the update prompt (optional).

.PARAMETER Keep
  How many installers to keep in <WebRoot>\updates (default 3; older ones are removed).
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$WebRoot,
  [string]$Setup,
  [string]$Notes,
  [int]$Keep = 3
)

$ErrorActionPreference = 'Stop'
$Repo    = Split-Path -Parent $PSScriptRoot
$pattern = '^RetellDashboard-Viewer-Setup-(\d+\.\d+\.\d+)\.exe$'

function Get-SetupVersion([IO.FileInfo]$file) {
  if ($file.Name -match $pattern) { return [version]$Matches[1] }
  return $null
}

if (-not (Test-Path $WebRoot)) { throw "Web root not found: $WebRoot" }

if ($Setup) {
  $file = Get-Item $Setup
} else {
  $file = Get-ChildItem (Join-Path $Repo 'dist\installer') -Filter 'RetellDashboard-Viewer-Setup-*.exe' -ErrorAction SilentlyContinue |
    Where-Object { Get-SetupVersion $_ } |
    Sort-Object { Get-SetupVersion $_ } -Descending |
    Select-Object -First 1
  if (-not $file) { throw 'No installer in dist\installer. Run scripts\Build-Installer.ps1 first.' }
}
$version = Get-SetupVersion $file
if (-not $version) { throw "$($file.Name) isn't named RetellDashboard-Viewer-Setup-<major.minor.patch>.exe." }

$updates = Join-Path $WebRoot 'updates'
New-Item -ItemType Directory -Force $updates | Out-Null

# Refuse to go backwards: a viewer only installs a strictly newer version anyway,
# and a lower latest.json would hide the real latest from new installs.
$feed = Join-Path $updates 'latest.json'
if (Test-Path $feed) {
  $current = Get-Content $feed -Raw | ConvertFrom-Json
  if ([version]$current.version -gt $version) {
    throw "The server already offers $($current.version); refusing to publish older $version."
  }
}

Write-Host "Copying $($file.Name) to $updates ..."
Copy-Item $file.FullName (Join-Path $updates $file.Name) -Force
$sha = (Get-FileHash (Join-Path $updates $file.Name) -Algorithm SHA256).Hash.ToLowerInvariant()

$manifest = [ordered]@{
  version      = $version.ToString()
  file         = $file.Name
  sha256       = $sha
  notes        = $Notes
  published_at = (Get-Date).ToUniversalTime().ToString('o')
}
$tmp = Join-Path $updates 'latest.json.tmp'
# UTF-8 without a BOM (Windows PowerShell's -Encoding UTF8 would add one).
[IO.File]::WriteAllText($tmp, ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
Move-Item $tmp $feed -Force

# Keep the newest few installers; a viewer mid-download keeps its file handle.
Get-ChildItem $updates -Filter 'RetellDashboard-Viewer-Setup-*.exe' |
  Where-Object { Get-SetupVersion $_ } |
  Sort-Object { Get-SetupVersion $_ } -Descending |
  Select-Object -Skip ([Math]::Max(1, $Keep)) |
  ForEach-Object { Remove-Item $_.FullName -Force; Write-Host "Removed old $($_.Name)" }

Write-Host "Published $version ($sha). Installed viewers will offer it within 30 minutes or on next launch."
