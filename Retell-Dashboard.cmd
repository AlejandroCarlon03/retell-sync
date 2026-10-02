@echo off
setlocal enabledelayedexpansion
REM ===========================================================================
REM  Retell -> Conversion : console launcher (development fallback)
REM  Pulls fresh Retell + Odoo data, then opens the dashboard window.
REM  For everyday use, prefer the desktop app: scripts\Publish-App.ps1 builds
REM  app\RetellDashboard.exe, which opens instantly and refreshes in the background.
REM  Place this at the repo root (next to pyproject.toml). Double-click to run.
REM ===========================================================================
cd /d "%~dp0"
title Retell -> Conversion dashboard

set "VENV=%USERPROFILE%\.venvs\retell-sync"
set "PY=%VENV%\Scripts\python.exe"

echo.
echo   Retell -^> Conversion dashboard
echo   ------------------------------
echo.

REM --- 0. Prerequisites -------------------------------------------------------
where python >nul 2>&1 || (
  echo   [X] Python was not found on your PATH. Install Python 3.11+ and retry.
  echo       https://www.python.org/downloads/
  pause & exit /b 1
)
where dotnet >nul 2>&1 || (
  echo   [X] The .NET SDK was not found on your PATH. Install .NET 10 SDK and retry.
  echo       https://dotnet.microsoft.com/download
  pause & exit /b 1
)

REM --- 1. First-run credentials ----------------------------------------------
REM  If the required secrets are already provided as OS env vars (e.g. set at the
REM  System level on the shared VM server), config.py's load_dotenv(override=False)
REM  will use them and no .env is needed - skip the first-run .env bootstrap so a
REM  provisioned server is a true one-double-click experience.
if defined RETELL_API_KEY if defined ODOO_URL if defined ODOO_API_KEY goto :secrets_ok
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo   First run: I created a .env file for your credentials.
  echo   Notepad will open it now - paste your RETELL_API_KEY, ODOO_URL, and
  echo   ODOO_API_KEY ^(the same values the Zapier steps use^), then Save and close.
  echo.
  notepad ".env"
  echo   Saved. Double-click this launcher again to load your data.
  pause & exit /b 0
)
:secrets_ok

REM --- 2. Python environment (first run only) --------------------------------
if not exist "%PY%" (
  echo   Setting up the Python environment ^(first run only, ~1 minute^)...
  python -m venv "%VENV%" || goto :setup_fail
  "%PY%" -m pip install --upgrade pip >nul
  "%PY%" -m pip install -e . || goto :setup_fail
  echo   Environment ready.
  echo.
) else (
  REM Self-heal: venv exists but the package isn't installed in it yet.
  "%PY%" -c "import retell_sync" >nul 2>&1 || (
    echo   Installing the retell-sync package into the environment...
    "%PY%" -m pip install -e . || goto :setup_fail
  )
)

REM --- 3. Pull fresh data -----------------------------------------------------
echo   Pulling the latest calls and leads from Retell + Odoo...
"%PY%" -m retell_sync run -v
if errorlevel 1 (
  echo.
  echo   [!] The data pull did not complete ^(see the message above^).
  echo       Opening the dashboard with the most recent saved data, if any.
  echo.
)

REM --- 3b. Rebuild the dashboard UI ------------------------------------------
REM  The host serves a COMPILED copy of the frontend (dashboard\frontend\dist),
REM  and its MSBuild step only builds that when dist is missing. So without this
REM  step a UI change never shows up on relaunch. Rebuild it here so you always
REM  see the latest version. Needs Node/npm; if it's absent we fall back to the
REM  host's own one-time build.
where npm >nul 2>&1
if errorlevel 1 (
  echo   [i] Node/npm was not found on your PATH, so I can't rebuild the UI here.
  echo       The host will build it once if it has never been built. Install
  echo       Node.js to always pick up the latest UI: https://nodejs.org/
  echo.
) else (
  echo   Rebuilding the dashboard UI so you see the latest version...
  if not exist "dashboard\frontend\node_modules" (
    echo   Installing UI dependencies ^(first run only, ~1 minute^)...
    call npm --prefix "dashboard\frontend" ci
  )
  call npm --prefix "dashboard\frontend" run build
  if errorlevel 1 (
    echo.
    echo   [!] The UI build did not complete ^(see the message above^).
    echo       Opening the most recently built UI instead.
    echo.
  )
)

REM --- 4. Open the dashboard --------------------------------------------------
echo   Opening the dashboard window. You can minimize this black window;
echo   closing it will close the dashboard.
echo.
REM  --no-refresh: this launcher already pulled above, so the window doesn't pull again.
dotnet run --project "dashboard\host" -- --no-refresh
goto :eof

:setup_fail
echo.
echo   [X] Environment setup failed. Confirm Python 3.11+ is installed, then retry.
pause & exit /b 1
