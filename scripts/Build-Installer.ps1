<#
.SYNOPSIS
  Build the Retell Dashboard viewer installer (RetellDashboard-Viewer-Setup-<ver>.exe).

.DESCRIPTION
  Wraps the single-file viewer from Publish-App.ps1 -Viewer in a per-user Inno Setup
  installer (installer\RetellDashboard-Viewer.iss): no admin rights, Start menu and
  optional desktop shortcut, an Apps & features uninstall entry, the WebView2 runtime
  installed if the PC lacks it, and a "Dashboard server" page that writes
  %LOCALAPPDATA%\RetellDashboard\viewer.json.

    powershell -ExecutionPolicy Bypass -File scripts\Build-Installer.ps1
    ... -DataUrl http://dashboard.dkb.local:8090/   # default for the server page + exe
    ... -SkipPublish                                # reuse dist\viewer's exe

  Needs what Publish-App.ps1 -Viewer needs (.NET 10 SDK, Node.js) plus Inno Setup 6
  (winget install JRSoftware.InnoSetup). The release workflow
  (.github/workflows/release.yml) runs this on a version tag.

  Code signing: set RETELL_SIGN_COMMAND to a command line that signs one file, with
  $f where the file path goes, e.g.
    signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /f C:\certs\dkb.pfx /p <pw> $f
  The viewer exe, the setup and its uninstaller are then signed. Unset = unsigned
  (Windows SmartScreen shows "Unknown publisher"; see SETUP.md).

.PARAMETER DataUrl
  The server URL baked into the exe and prefilled on the installer's server page.
  Default: Publish-App.ps1's -DataUrl default.

.PARAMETER Version
  Override the version (e.g. to test an upgrade); it is stamped into both the
  installer and the exe. Default: the host csproj <Version>, which is what releases
  use. With -SkipPublish the existing exe keeps whatever version it was built with.

.PARAMETER SkipPublish
  Don't rebuild the viewer exe; package the one already in dist\viewer.

.PARAMETER OutDir
  Where the setup exe lands (default: <repo>\dist\installer).
#>
[CmdletBinding()]
param(
  [string]$DataUrl,
  [string]$Version,
  [switch]$SkipPublish,
  [string]$OutDir
)

$ErrorActionPreference = 'Stop'

function Assert-Exit([string]$what) {
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." }
}

$Repo    = Split-Path -Parent $PSScriptRoot
$publish = Join-Path $PSScriptRoot 'Publish-App.ps1'
$iss     = Join-Path $Repo 'installer\RetellDashboard-Viewer.iss'
$exe     = Join-Path $Repo 'dist\viewer\Retell Dashboard.exe'
if (-not $OutDir) { $OutDir = Join-Path $Repo 'dist\installer' }
New-Item -ItemType Directory -Force $OutDir | Out-Null

# --- Version + default server URL (single sources of truth) ------------------
if (-not $Version) {
  $csproj  = [xml](Get-Content (Join-Path $Repo 'dashboard\host\RetellSync.Dashboard.csproj') -Raw)
  $Version = ($csproj.Project.PropertyGroup | Where-Object { $_.Version } | Select-Object -First 1).Version
  if (-not $Version) { throw 'No <Version> in RetellSync.Dashboard.csproj.' }
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version '$Version' isn't major.minor.patch." }

if (-not $DataUrl) {
  # Publish-App.ps1 owns the default; read it from its param block.
  $ast   = [System.Management.Automation.Language.Parser]::ParseFile($publish, [ref]$null, [ref]$null)
  $param = $ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'DataUrl' }
  $DataUrl = $param.DefaultValue.Value
  if (-not $DataUrl) { throw "Couldn't read the default -DataUrl from $publish." }
}

# --- Inno Setup compiler ----------------------------------------------------
$iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
  $iscc = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $iscc) { throw 'Inno Setup 6 is not installed (winget install JRSoftware.InnoSetup).' }

# --- 1. The viewer exe ------------------------------------------------------
if (-not $SkipPublish) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $publish -Viewer -DataUrl $DataUrl -Version $Version
  Assert-Exit 'Publish-App.ps1 -Viewer'
}
if (-not (Test-Path $exe)) { throw "No viewer exe at $exe (run without -SkipPublish)." }

# --- 2. WebView2 Evergreen bootstrapper (Microsoft's official ~2 MB stub) ----
$cache = Join-Path $Repo 'dist\installer-cache'
$wv2   = Join-Path $cache 'MicrosoftEdgeWebview2Setup.exe'
if (-not (Test-Path $wv2)) {
  New-Item -ItemType Directory -Force $cache | Out-Null
  Write-Host 'Downloading the WebView2 bootstrapper...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $wv2 -UseBasicParsing
  $sig = Get-AuthenticodeSignature $wv2
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    Remove-Item $wv2 -Force
    throw 'The downloaded WebView2 bootstrapper is not validly signed by Microsoft.'
  }
}

# --- 3. Signing hook ----------------------------------------------------------
$isccArgs = @(
  "/DAppVersion=$Version",
  "/DSourceExe=$exe",
  "/DWebView2Setup=$wv2",
  "/DDefaultDataUrl=$DataUrl",
  "/DOutputDir=$OutDir"
)
$sign = $env:RETELL_SIGN_COMMAND
if ($sign) {
  if ($sign -notmatch '\$f') { throw 'RETELL_SIGN_COMMAND must contain $f where the file path goes.' }
  Write-Host 'Signing the viewer exe...'
  & cmd /c ($sign.Replace('$f', "`"$exe`""))
  Assert-Exit 'Signing the viewer exe'
  $isccArgs += '/DSign', "/Ssigntool=$sign"
} else {
  Write-Host 'RETELL_SIGN_COMMAND not set: building an unsigned installer.'
}

# --- 4. Compile ---------------------------------------------------------------
Write-Host "Compiling the installer (v$Version, server $DataUrl)..."
& $iscc /Q @isccArgs $iss
Assert-Exit 'ISCC'

$setup = Join-Path $OutDir "RetellDashboard-Viewer-Setup-$Version.exe"
if (-not (Test-Path $setup)) { throw "ISCC produced no $setup." }
$sizeMb = [math]::Round((Get-Item $setup).Length / 1MB, 1)
Write-Host "Done: $setup ($sizeMb MB)"
