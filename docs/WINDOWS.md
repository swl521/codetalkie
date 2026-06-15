# Windows 上手(Codex 先行版)

> 前提:Windows 机器装好 Node.js 22+;Codex CLI 已登录(`codex` 命令可用)。
> Claude Code 没登录也能用——Claude 项目等登录后自动出现。

## 安装(5 分钟)

```powershell
# 1. 拿代码(私有仓需先 gh auth login)
git clone https://github.com/swl521/claude-remo-app
cd claude-remo-app

# 2. 写配置:同一个 relay、同一个 token(和 Mac 共用)
mkdir $env:USERPROFILE\.earpiece -Force
'{ "url": "https://your-relay.example.com", "token": "<lan-token 内容>" }' |
  Set-Content $env:USERPROFILE\.earpiece\relay.json

# 3. (可选)给这台机器起个短名,默认用主机名
'Win' | Set-Content $env:USERPROFILE\.earpiece\machine-id

# 4. 装成登录自启 + 立即启动
cd scripts
powershell -ExecutionPolicy Bypass -File .\install-daemon.ps1
```

## 验证

```powershell
# 本机健康(token 与 relay.json 一致)
curl.exe -s http://127.0.0.1:7780/status -H "Authorization: Bearer <token>"
```

手机打开小易 → 项目列表会多出这台机器的 Codex 项目(跨机器同名会标"重名,长按改名")。
对着手机说"<项目名> + 要做的事",指令自动路由到项目所在的机器。

## 已知差异(对比 Mac)

- 本机不出声(产品的喇叭是手机/耳机;Mac 的 `say` 是开发福利)
- 无菜单栏 App(二期)
- Claude 项目需在本机登录 Claude Code 后出现;无头跑 Claude 还需 `claude setup-token`
  并把 token 存入 `%USERPROFILE%\.earpiece\oauth-token`

## 卸载

```powershell
schtasks /Delete /TN EarpieceDaemon /F
```
