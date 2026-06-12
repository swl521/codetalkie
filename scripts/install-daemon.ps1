# 安装 Earpiece daemon 为 Windows 登录自启任务(任务计划程序)。幂等:重复执行覆盖。
# 用法:PowerShell 里  .\install-daemon.ps1  (在仓库 scripts\ 目录下执行)
$ErrorActionPreference = "Stop"

$TaskName = "EarpieceDaemon"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$DaemonJs = Join-Path $RepoRoot "agent\src\daemon.js"
$LogDir = Join-Path $env:USERPROFILE ".earpiece"

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { Write-Error "找不到 node,请先安装 Node.js (https://nodejs.org)"; exit 1 }
if (-not (Test-Path $DaemonJs)) { Write-Error "找不到 $DaemonJs"; exit 1 }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# 用 wscript 包一层隐藏窗口(直接跑 node 会常驻一个黑框)+ keep-alive 循环
# (Windows 计划任务无 launchd 式 KeepAlive,崩了自己拉起;每次重启间隔 3 秒防抖)
$Vbs = Join-Path $LogDir "daemon-hidden.vbs"
@"
Set sh = CreateObject("WScript.Shell")
Do
  sh.Run """$Node"" ""$DaemonJs""", 0, True
  WScript.Sleep 3000
Loop
"@ | Set-Content -Path $Vbs -Encoding ASCII

# 任务不存在时 Delete 会喷 stderr,经 cmd 包裹吞掉,避免 Stop 模式下脚本中断
cmd /c "schtasks /Delete /TN $TaskName /F >nul 2>&1"
schtasks /Create /TN $TaskName /TR "wscript.exe `"$Vbs`"" /SC ONLOGON /RL LIMITED /F | Out-Null
schtasks /Run /TN $TaskName | Out-Null

Write-Host "已安装并启动 $TaskName"
Write-Host "  node: $Node"
Write-Host "  脚本: $DaemonJs"
Write-Host "  状态: http://127.0.0.1:7780/status (带 Bearer token)"
