; Retell Dashboard viewer installer (Inno Setup 6).
;
; Wraps the single-file viewer exe from `scripts\Publish-App.ps1 -Viewer` in a
; per-user installer: no admin rights, installs to %LOCALAPPDATA%\Programs, adds a
; Start menu shortcut (desktop optional) and an Apps & features uninstall entry.
; Re-running a newer installer upgrades in place (same AppId).
;
; Build it with scripts\Build-Installer.ps1, which passes the defines below:
;   AppVersion      the csproj <Version> (e.g. 1.0.0)
;   SourceExe       the published "Retell Dashboard.exe"
;   WebView2Setup   Microsoft's Evergreen WebView2 bootstrapper
;   DefaultDataUrl  the server URL prefilled on the "Dashboard server" page
;   OutputDir       where the setup exe lands
;   Sign            (optional) sign setup + uninstaller with the "signtool" command
;
; Silent install: Setup.exe /VERYSILENT /SUPPRESSMSGBOXES [/DATAURL=http://host:8090/]

#ifndef AppVersion
  #error AppVersion is required (build with scripts\Build-Installer.ps1)
#endif

; "Viewer" keeps the shortcuts and install folder apart from the admin app's
; "Retell Dashboard" shortcuts (Publish-App.ps1) on a PC that has both.
#define AppName "Retell Dashboard Viewer"
#define AppExe "Retell Dashboard.exe"

[Setup]
; Never change AppId: it's how a newer installer finds and upgrades this one.
AppId={{E7C42185-A7E3-4271-BFE6-25E83C1D4B01}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Diamond Kitchen and Bath, Inc.
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}
; Per-user: {autopf} resolves to %LOCALAPPDATA%\Programs when not elevated.
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#AppName}
DisableDirPage=yes
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=RetellDashboard-Viewer-Setup-{#AppVersion}
SetupIconFile=..\dashboard\host\app.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
; An open dashboard holds its exe; ask to close it rather than fail the upgrade.
CloseApplications=yes
RestartApplications=no
#ifdef Sign
SignTool=signtool
SignedUninstaller=yes
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; DestName: "{#AppExe}"; Flags: ignoreversion
Source: "{#WebView2Setup}"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; Comment: "After-hours call conversion dashboard (read-only)"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[Code]
const
  WebView2ClientKey = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

var
  DataUrlPage: TInputQueryWizardPage;

{ %LOCALAPPDATA%\RetellDashboard\viewer.json: the app reads its server URL from here
  (see DashboardOptions.ViewerConfigPath). It is the user's setting, so an upgrade
  keeps it and an uninstall only removes it when asked. }
function SettingsDir: String;
begin
  Result := ExpandConstant('{localappdata}\RetellDashboard');
end;

function SettingsFile: String;
begin
  Result := SettingsDir + '\viewer.json';
end;

(* The "dataUrl" string in viewer.json, or '' (tiny parser: the file is only ever
   { "dataUrl": "<url>" }, and URLs with quotes or backslashes are refused below). *)
function ReadSavedDataUrl: String;
var
  Json: AnsiString;
  Text: String;
  P: Integer;
begin
  Result := '';
  if not LoadStringFromFile(SettingsFile, Json) then Exit;
  Text := String(Json);
  P := Pos('"dataUrl"', Text);
  if P = 0 then Exit;
  Delete(Text, 1, P + Length('"dataUrl"') - 1);
  P := Pos('"', Text);
  if P = 0 then Exit;
  Delete(Text, 1, P);
  P := Pos('"', Text);
  if P = 0 then Exit;
  Result := Copy(Text, 1, P - 1);
end;

function IsUsableUrl(const Url: String): Boolean;
var
  Lower: String;
begin
  Lower := LowerCase(Trim(Url));
  Result := ((Pos('http://', Lower) = 1) and (Length(Lower) > 7)) or
            ((Pos('https://', Lower) = 1) and (Length(Lower) > 8));
  Result := Result and (Pos('"', Url) = 0) and (Pos('\', Url) = 0) and (Pos(' ', Trim(Url)) = 0);
end;

{ The URL to offer: /DATAURL= on the command line, else the saved one (upgrade),
  else the build's default. }
function InitialDataUrl: String;
begin
  Result := ExpandConstant('{param:DATAURL|}');
  if Result = '' then Result := ReadSavedDataUrl;
  if Result = '' then Result := '{#DefaultDataUrl}';
end;

procedure InitializeWizard;
begin
  DataUrlPage := CreateInputQueryPage(wpSelectTasks,
    'Dashboard server',
    'Where should the dashboard read its data from?',
    'This is the internal server that publishes the nightly report. Leave the ' +
    'default unless you were given a different address. You can change it later ' +
    'by running this installer again.');
  DataUrlPage.Add('Server address:', False);
  DataUrlPage.Values[0] := InitialDataUrl;
end;

{ Interactive only: a silent install never stops on a prompt, and SaveDataUrl falls
  back to the saved/default URL when /DATAURL is unusable. }
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if WizardSilent then Exit;
  if (DataUrlPage <> nil) and (CurPageID = DataUrlPage.ID) and not IsUsableUrl(DataUrlPage.Values[0]) then
  begin
    MsgBox('Enter an address that starts with http:// or https://, for example ' +
           '{#DefaultDataUrl}', mbError, MB_OK);
    Result := False;
  end;
end;

function WebView2Installed: Boolean;
var
  Version: String;
begin
  Result :=
    (RegQueryStringValue(HKLM32, WebView2ClientKey, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, WebView2ClientKey, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

{ The dashboard window is a WebView2 control. Windows 11 ships the runtime; older
  machines get it from Microsoft's bootstrapper (per-user when not elevated). }
procedure EnsureWebView2;
var
  ResultCode: Integer;
begin
  if WebView2Installed then Exit;
  WizardForm.StatusLabel.Caption := 'Installing the Microsoft Edge WebView2 runtime...';
  ExtractTemporaryFile(ExtractFileName('{#WebView2Setup}'));
  if not Exec(ExpandConstant('{tmp}\') + ExtractFileName('{#WebView2Setup}'), '/silent /install', '',
              SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) or not WebView2Installed then
    SuppressibleMsgBox('The Microsoft Edge WebView2 runtime could not be installed (it needs an ' +
      'internet connection). The dashboard needs it to open; install it from ' +
      'https://go.microsoft.com/fwlink/p/?LinkId=2124703 and then start the dashboard.',
      mbInformation, MB_OK, IDOK);
end;

procedure SaveDataUrl;
var
  Url: String;
begin
  Url := Trim(DataUrlPage.Values[0]);
  if not IsUsableUrl(Url) then Url := InitialDataUrl;  { silent install with a bad /DATAURL }
  if not IsUsableUrl(Url) then Exit;
  ForceDirectories(SettingsDir);
  if not SaveStringToFile(SettingsFile, '{ "dataUrl": "' + Url + '" }' + #13#10, False) then
    Log('Could not write ' + SettingsFile);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then EnsureWebView2;
  if CurStep = ssPostInstall then SaveDataUrl;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  { A silent uninstall (or "No") keeps the server setting for a later reinstall. }
  if (CurUninstallStep = usPostUninstall) and DirExists(SettingsDir) and not UninstallSilent then
    if MsgBox('Also remove your dashboard settings (the server address)?', mbConfirmation, MB_YESNO) = IDYES then
      DelTree(SettingsDir, True, True, True);
end;
