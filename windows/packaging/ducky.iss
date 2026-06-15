; ducky.iss — Inno Setup script for 答鸭 Ducky.
; Compiled by build.ps1 (passes /dPublishDir=<self-contained publish folder>).
; Standalone: pass -dPublishDir and -dMyAppVersion on the ISCC command line.

#ifndef MyAppVersion
  #define MyAppVersion "0.1.0"
#endif
#ifndef PublishDir
  ; default relative guess if compiled by hand from this folder
  #define PublishDir "..\Ducky\bin\Release\net8.0-windows\win-x64\publish"
#endif

#define MyAppName "答鸭 Ducky"
#define MyAppExe "Ducky.exe"
#define MyAppId "com.example.codetalkie.desktop"
#define MyAppPublisher "Double Dragon"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
; Per-user install -> no admin/UAC needed.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Ducky
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=DuckySetup-{#MyAppVersion}
SetupIconFile=..\Ducky\Assets\ducky.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExe}

[Languages]
Name: "en";  MessagesFile: "compiler:Default.isl"

[Files]
; Whole self-contained publish folder (Ducky.exe + .NET runtime + runtime\node + runtime\agent).
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"

[Run]
; Launch right after install; the app itself registers HKCU\...\Run for next login.
Filename: "{app}\{#MyAppExe}"; Description: "启动 答鸭 Ducky"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
