<#
  build.ps1 — one-shot: stage runtime, publish self-contained, (optional) Inno setup.

  Output:
    windows/Ducky/bin/Release/net8.0-windows/win-x64/publish/   <- self-contained app folder
    windows/dist/DuckySetup-<ver>.exe                            <- if Inno Setup (ISCC) present

  Usage:
    pwsh windows/packaging/build.ps1 [-NodeVersion 22.14.0] [-SkipRuntime]
#>
[CmdletBinding()]
param(
    [string]$NodeVersion = "22.14.0",
    [switch]$SkipRuntime
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$proj     = Join-Path $repoRoot "windows\Ducky\Ducky.csproj"

if (-not $SkipRuntime) {
    & (Join-Path $PSScriptRoot "stage-runtime.ps1") -NodeVersion $NodeVersion
}

Write-Host "==> dotnet publish (self-contained, win-x64)"
dotnet publish $proj `
    -c Release -r win-x64 --self-contained true `
    /p:PublishSingleFile=false

$publishDir = Join-Path $repoRoot "windows\Ducky\bin\Release\net8.0-windows\win-x64\publish"
Write-Host "publish folder: $publishDir"

# Optional Inno Setup compile (ISCC on PATH). If absent, the self-contained
# folder + install.bat is the deliverable.
$iscc = Get-Command iscc.exe -ErrorAction SilentlyContinue
if (-not $iscc) {
    $iscc = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
}
if (-not $iscc) {
    $guess = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
    if (Test-Path $guess) { $iscc = @{ Source = $guess } }
}

if ($iscc) {
    Write-Host "==> Inno Setup compile"
    $iss = Join-Path $PSScriptRoot "ducky.iss"
    & $iscc.Source "/dMyAppVersion=0.1.0" "/dPublishDir=$publishDir" $iss
    Write-Host "installer -> windows\dist\"
} else {
    Write-Host "Inno Setup (ISCC) not found — skipping installer."
    Write-Host "Deliverable = self-contained folder + install.bat:"
    Write-Host "  $publishDir"
}
