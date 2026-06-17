# 一次性把这台 Windows 的 Ducky 升级到 GitHub main:停 daemon(解除文件锁)→ git 更新 → 重装。
# 设计成「分离进程」跑(由 bridge/手动用 Start-Process 拉起):这样脚本杀掉 daemon 时不会连自己一起杀,
# 解开"要停 daemon 才能更新、但 daemon 的子进程停了它自己也死"的死结。
# 日志写到 ~/.earpiece/redeploy.log,跑完可回看。
$ErrorActionPreference = 'Continue'
$ear = Join-Path $env:USERPROFILE '.earpiece'
New-Item -ItemType Directory -Force -Path $ear | Out-Null
Start-Transcript -Path (Join-Path $ear 'redeploy.log') -Force | Out-Null

Write-Host "=== 1) 停 daemon + 重启器(循环杀到干净) ==="
schtasks /Delete /TN EarpieceDaemon /F 2>$null
1..10 | ForEach-Object {
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like '*daemon-hidden*' -or $_.CommandLine -like '*agent\src\daemon.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 700
}
$left = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*daemon.js*' })
Write-Host ("剩余 daemon 进程数(应为 0): " + $left.Count)

Write-Host "=== 2) git 更新到 origin/main ==="
$repo = Join-Path $env:USERPROFILE 'codetalkie'
Set-Location $repo
git init 2>$null
git remote add origin https://github.com/swl521/codetalkie.git 2>$null
git remote set-url origin https://github.com/swl521/codetalkie.git
git fetch origin main
git reset --hard origin/main
git branch -M main 2>$null
git branch --set-upstream-to=origin/main main 2>$null
Write-Host ("HEAD: " + (git log --oneline -1))

Write-Host "=== 3) 重装 daemon + 批准 hook ==="
& (Join-Path $repo 'scripts\install-daemon.ps1')

Write-Host "=== 完成 ==="
Stop-Transcript | Out-Null
