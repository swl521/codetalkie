# Earpiece 菜单栏 App(macOS)

最小化的菜单栏伴侣应用,配合 Earpiece daemon(`agent/src/daemon.js`,监听 7780)使用。
无 Dock 图标(LSUIElement),菜单栏显示 🎧。

## 功能

- **状态:运行中 / 未运行** — 每 5 秒请求 `http://127.0.0.1:7780/status`,
  Bearer token 自动从 `~/.earpiece/lan-token` 读取。
- **在终端继续 ▸** — 读 `~/.earpiece/sessions.json`(格式 `{"项目@目录": "sessionId"}`),
  点击某项后通过 AppleScript 打开 Terminal,执行
  `cd <目录> && /opt/homebrew/bin/claude --resume <sessionId>`
  (用原始路径而不是 `claude` alias,因为 Terminal 新开 shell 执行 do script 时 alias 不可用)。
- **启动 daemon** — 直接 spawn `node ~/codetalkie/agent/src/daemon.js`,
  日志追加到 `~/.earpiece/daemon.log`;daemon 已在跑时置灰。
- **停止 daemon** — 先尝试 `launchctl bootout gui/$UID/com.earpiece.daemon`
  (LaunchAgent 管理的实例必须走 launchctl,否则 KeepAlive 会拉起来),
  失败再 `pkill -f 'agent/src/daemon.js'`;daemon 未运行时置灰。
- **退出** — 退出菜单栏 App(不影响 daemon)。

## 编译

需要 Xcode 命令行工具。本地 ad-hoc 签名(`CODE_SIGN_IDENTITY="-"`),无需开发者账号。

```bash
cd menubar
xcodebuild -project EarpieceMenubar.xcodeproj \
  -target EarpieceMenubar -configuration Debug \
  SYMROOT=build build
```

产物路径:

```
menubar/build/Debug/EarpieceMenubar.app
```

## 安装与运行

```bash
# 直接运行
open menubar/build/Debug/EarpieceMenubar.app

# 或安装到应用目录
cp -R menubar/build/Debug/EarpieceMenubar.app /Applications/
open /Applications/EarpieceMenubar.app
```

想随登录自启,可在「系统设置 → 通用 → 登录项」里把 EarpieceMenubar.app 加入登录项。

## 首次运行注意

1. **自动化授权**:第一次点「在终端继续」时,macOS 会弹窗询问是否允许
   EarpieceMenubar 控制 Terminal,需要点「允许」。误点拒绝后可去
   「系统设置 → 隐私与安全性 → 自动化」重新开启。
2. **token**:`~/.earpiece/lan-token` 不存在时状态会一直显示「未运行」
   (daemon 首次启动会自动生成 token)。
3. **node 路径**:「启动 daemon」按 `/opt/homebrew/bin/node`、`/usr/local/bin/node`、
   `/usr/bin/node` 顺序探测;都找不到时状态栏会提示「找不到 node」。
4. daemon 的开机自启请用 `scripts/install-daemon.sh`(LaunchAgent),
   卸载用 `scripts/uninstall-daemon.sh`。

## 文件结构

```
menubar/
├── EarpieceMenubar.xcodeproj/   # 手写 pbxproj(参考 spike/ios 的风格)
├── main.swift                   # 入口,手动启动 NSApplication
├── AppDelegate.swift            # 全部菜单逻辑
├── Info.plist                   # LSUIElement、本地网络、AppleEvents 用途说明
└── README.md
```
