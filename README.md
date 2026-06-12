# Codetalkie 🎧

**耳机里的 AI 副驾** — 为 Claude Code / Codex / Hermes 打造的"脱手"语音层,一部手机驱动多台电脑。

> 手机锁屏在口袋,你在跑步。说一句"维基 跑测试",电脑上的 AI 开始干活;每步进展翻成人话,Siri 念进你的 AirPods;要删文件时它先问你:"批准吗?"——你说"告诉小易批准",它继续。全程手机不出口袋。
>
> Like a dispatcher on a trucker's radio: your coding agent reports progress into your earbuds while you're away from the screen.

## 它不是什么

- 不是又一个手机聊天客户端——创建/管理项目请用 Claude Code 和 Codex 本体
- 不是远程桌面——屏幕不存在是这个产品的设计前提

## 三条管道

```
【下行】CLI 事件流 → 归一/过滤/合并 → 人话 → 推送/朗读 → 耳机
【上行】说话(Siri / App)→ relay 按项目名路由到对应电脑 → 注入活终端窗口(同一个对话)/ 无头 CLI
【批准环】Agent 要权限 → 耳机播报"批准吗?" → 通知按钮 / 语音"批准" → 放行
```

- **三引擎**:Claude Code(stream-json)、Codex(exec --json,手机/终端 resume 同一条会话)、Hermes(文本模式,会话即项目)
- **多机**:relay 按机器分信箱,项目名自动路由(Mac / Windows / Linux 已实测)
- **同一个对话**:手机指令优先注入正开着的终端窗口(agent-hub 桥);UserPromptSubmit hook 把手机线程新消息自动带进电脑窗口

## 组成

| 目录 | 内容 |
|------|------|
| `agent/` | Desktop Agent(Node.js 零依赖):事件归一(三引擎)、状态机、5 级播报过滤、合并队列、APNs 推送、批准桥接、项目/会话扫描、历史回填、agent-hub 桥、daemon |
| `spike/ios/` | iOS App(SwiftUI,手写 pbxproj 命令行可编译):引擎分组项目列表(可折叠)、字幕回放对话页、大语音按钮、Siri App Intents、批准横幅、M3 底栏 |
| `android/` | Android App(Kotlin + Compose):同款主页/对话页/设置,前台服务轮询 + TTS 朗读;双语音引擎(微软 Edge 云端神经语音 / 系统 TTS),华为真机实测 |
| `relay/`(公开版未含) | 公网中继(Cloudflare Worker + Durable Object)需自部署;接口形状见 agent/src/daemon.js 的 relayApi |
| `menubar/` | macOS 菜单栏 App:daemon 状态、在终端继续会话 |
| `scripts/` | 安装脚本(macOS LaunchAgent / Linux systemd / Windows ps1)、attach.mjs(终端接回手机会话)、phone-sync-hook.mjs(手机消息同步进窗口)、window-listener.mjs(桌面窗口接手机指令) |
| `docs/` | 设计 spec、进度、Windows 部署(中文) |

## 快速开始(局域网模式)

前提:macOS + Node 22+,已安装并登录 Claude Code(和/或 Codex CLI),iPhone + Xcode。

```bash
# 1. Mac 端:无头认证(一次)
claude setup-token   # 按提示登录,把 token 存入 ~/.earpiece/oauth-token

# 2. 起 daemon(监听 0.0.0.0:7780,自动扫描你的 Claude/Codex 项目)
node agent/src/main.js --project demo "说个 ok"   # 先单发验证
node agent/src/daemon.js                           # 常驻

# 3. iOS 端:复制配置模板并填入你 Mac 的局域网 IP 和 ~/.earpiece/lan-token
cp spike/ios/EarpieceConfig.sample.swift spike/ios/EarpieceConfig.swift
# 编辑后用 Xcode 打开 spike/ios/EarpieceSpike.xcodeproj,签名换成你自己的 Team,装上真机
```

测试:打开 App → 点「发给电脑」→ Mac 开始干活并把播报推回手机。锁屏戴 AirPods,Siri 会自动朗读(系统「宣布通知」需开启)。

> 推送(APNs)需要你自己的 Apple 开发者 .p8 密钥,配置见 `spike/README.md`。
> 公网模式:自部署 `relay/`(Cloudflare Worker),各机器 `~/.earpiece/relay.json` 填中继地址。
> Android:见 `README-ANDROID.md`(不需要 Firebase,前台轮询 + TTS 即可用)。
> Windows / Linux 部署:`docs/WINDOWS.md`、`scripts/install-daemon-linux.sh`。

## 测试

```bash
npm test   # node:test,零依赖
```

## License

MIT
