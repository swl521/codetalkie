<#
  stage-runtime.ps1 — lay down the self-contained node runtime + agent next to
  the WPF project so they get published into the app folder.

  Produces:
    windows/Ducky/runtime/node/node.exe          (official win-x64 build)
    windows/Ducky/runtime/agent/src/*.js
    windows/Ducky/runtime/agent/lang/*.json

  The agent has ZERO npm dependencies (only node: builtins), so no `npm install`
  is needed — copying src + lang is the whole runtime.

  Usage (from repo root or anywhere):
    pwsh windows/packaging/stage-runtime.ps1 [-NodeVersion 22.14.0]
#>
[CmdletBinding()]
param(
    [string]$NodeVersion = "22.14.0"
)

$ErrorActionPreference = "Stop"

# repo root = two levels up from this script (windows/packaging/..)
$repoRoot   = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$proj       = Join-Path $repoRoot "windows\Ducky"
$runtime    = Join-Path $proj "runtime"
$nodeDir    = Join-Path $runtime "node"
$agentDst   = Join-Path $runtime "agent"
$agentSrc   = Join-Path $repoRoot "agent"

Write-Host "repo root : $repoRoot"
Write-Host "runtime   : $runtime"

# Fresh runtime each time (cheap; keeps stale files out of the package).
if (Test-Path $runtime) { Remove-Item $runtime -Recurse -Force }
New-Item -ItemType Directory -Force -Path $nodeDir  | Out-Null
New-Item -ItemType Directory -Force -Path $agentDst | Out-Null

# 1. node.exe (official win-x64). We only need node.exe itself; the zip ships it
#    at the top level of node-v<ver>-win-x64/.
$zipName = "node-v$NodeVersion-win-x64.zip"
$url     = "https://nodejs.org/dist/v$NodeVersion/$zipName"
$tmpZip  = Join-Path $env:TEMP $zipName
$tmpDir  = Join-Path $env:TEMP "node-v$NodeVersion-win-x64"

Write-Host "downloading $url ..."
Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing

if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
Expand-Archive -Path $tmpZip -DestinationPath $env:TEMP -Force

Copy-Item (Join-Path $tmpDir "node.exe") (Join-Path $nodeDir "node.exe") -Force
Write-Host "node.exe staged -> $nodeDir\node.exe"

# 2. agent src + lang (read-only copy from the repo).
Copy-Item (Join-Path $agentSrc "src")  (Join-Path $agentDst "src")  -Recurse -Force
Copy-Item (Join-Path $agentSrc "lang") (Join-Path $agentDst "lang") -Recurse -Force
Write-Host "agent staged -> $agentDst"

Write-Host "runtime staged OK."
