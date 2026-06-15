# Agent Earpiece — 产品进度

> 更新:2026-06-12 凌晨 · 上一版:2026-06-11 深夜

## 一句话状态

**📱📱 双端三机三引擎(2026-06-12):iOS + Android(华为真机)双客户端;Mac/Win/Linux 三机按项目名路由;Claude/Codex/Hermes 三引擎。手机和电脑窗口是同一个对话(agent-hub 桥 + hook 同步);Codex 手机/终端 resume 同一条会话;Android 带微软云端神经语音(晓晓)。产品能聊、能干、有刹车,还有副好嗓子。**

批准桥接:`--permission-prompt-tool` → approval-mcp(stdio MCP)→ daemon 挂起 → Mac 播报 + 手机推送(批准/拒绝按钮)
→ 或语音"告诉小易批准"(不带 id 命中最新挂起);120s 超时自动拒绝(已实测);拒绝路径 Claude 优雅收场(已实测);
批准路径文件真实落盘(已实测,`voice approved`)。
多 agent 并行交付:菜单栏 App+LaunchAgent 脚本(scripts/install-daemon.sh,装时先停手动 daemon)、
Codex 驱动(`--agent codex`,0.139.0 实测,resume 顺序确认)、App 图标、重设计主页、App 内大语音按钮(Speech zh-CN)。
公网:relay/(Cloudflare Worker+Durable Object)@ your-relay.example.com,手机蜂窝网络可用;Mac 出站长轮询,家里不开任何端口。
当前限制:Codex 批准走 sandbox 无 approval 事件(二期 app-server);daemon 仍手动跑(LaunchAgent 脚本已备未装)。

## 里程碑

| 日期 | 事件 |
|------|------|
| 06-10 | 产品定位、8 条技术决策、事件管线 spec 锁定 |
| 06-10 | Desktop Agent 管线 MVP 实现(9 模块,TDD) |
| 06-10 | 后台调研:批准桥接方案 + Codex 对称性确认 |
| 06-11 | **iOS 真机验证通过**:锁屏+AirPods,Siri 自动朗读自家 App 通知 ✅ |
| 06-11 | 项目名(title)朗读 ✅、5 连发无节流 ✅ |
| 06-11 | **MVP 范围变更:computer use 语音场景纳入**(用户拍板) |
| 06-11 | **真任务全链路冒烟通过**:Claude 真实跑任务,Mac 中文播报全程;**resume 持续对话验证**(追问"最大的质数"答 19) |
| 06-11 | 无头认证方案落地:`claude setup-token` 长期令牌 → `~/.earpiece/oauth-token`,Agent 自动注入(onboarding 流程原型) |
| 06-11 | .p8 到位(KeyID YOUR_KEY_ID),APNs 首推 200;push sink 接入管线(`--push`) |
| 06-11 | **🎉 产品完整闭环**:真任务(写诗)全程推送锁屏 iPhone,Siri AirPods 朗读 |
| 06-11 | 多机路由(relay 按机器分信箱)+ Windows 移植 + Hermes 引擎接入;三机四引擎全通 |
| 06-11 | Hermes 会话即项目(扫描/过滤/--resume 路由)+ 历史回填(export);iOS 引擎分组可折叠 |
| 06-12 | 历史回填 10→50 条;**seed/现场行分离**(回填不再冲掉手机消息,"发了没显示"根因修复) |
| 06-12 | **手机↔电脑同一个对话**:agent-hub 桥(daemon 注入活终端)+ window-listener(桌面窗口接指令)+ phone-sync hook(手机消息进窗口),全链路实测 |
| 06-12 | **Codex 同会话**:手机 resume 该目录最新落盘会话(终端 TUI 同链);attach.mjs 终端接回手机链 |
| 06-12 | **📱 Android 版真机落地**(华为):Kotlin+Compose 全套,前台轮询+TTS,Mac 全新工具链编译装机;weixin 重名 key 崩溃修复(同族 bug 第三案) |
| 06-12 | **Android 双语音引擎**:微软 Edge 云端神经语音(免费无 key,晓晓/云希等 6 音色,Sec-MS-GEC 签名)+ 系统 TTS 音色选择,点选即试听 |
| 06-11 | 开源库 codetalkie 同步(脱敏:域名/bundle/TeamID/KeyID/路径全替换,relay 与密钥排除) |
| 06-15 | **三端中英双语**:iOS/macOS SwiftUI 自动本地化(en/zh-Hans.lproj)+ String(localized:);菜单栏/Windows 托盘内联 L();agent i18n;跟随系统语言 |
| 06-15 | iOS 扫码配对(AVFoundation)+ 6 位码键盘「完成」键;菜单栏图标换手机同款答鸭(MenuBarIcon) |
| 06-15 | **agent-hub channel 心跳重注册**:被清/重建/daemon 重启自愈,启动顺序无关(根治"哪个重启就乱") |
| 06-15 | **跨机派活** dispatch.js(电脑↔电脑派任务,结果回流)+ **`@机器名` 定向**(中继 routeCommand,绕开重名歧义);Mac↔Win 真机验证(回「Windows 10 Pro」) |
| 06-15 | **批准/通知集中经中继发推送**(relay 内置 APNs ES256/http2;没 .p8 的机器如 Windows 也能弹到手机);批准超时 120→300s;.p8+apns.json 部署到 VM(scripts/deploy-relay-apns.sh) |
| 06-15 | **通用选择题**:ask_user 工具(ask-mcp)+ daemon /choice 挂起 + ①②③ 通知按钮(长按)+ 文字数字兜底;真机验证(点③→沙拉、打"2"→香蕉) |
| 06-15 | Windows 托盘双语 + 「在终端继续(agent-hub)」;Windows 源码脱敏进公开库;安装包产线(build.ps1/Inno)经 Mac 跨机驱动 Windows 编译验证 |

## 已验证(降为零风险)

- ✅ **锁屏耳机朗读**(产品存亡):本地 time-sensitive 通知,iPhone 14 真机
- ✅ **项目名播报**:Siri 念 title,"每句带项目名"方案坐实
- ✅ **话痨档可行**:5 条/4 秒间隔无吞条
- ✅ **管线正确性**:36 单测 + 1/3/4 级回放 + 真实故障中 stuck 报警/坏消息提级首秀

## 已建成(代码,git 仓库 20+ 提交)

| 模块 | 状态 |
|------|------|
| 事件归一(Claude stream-json) | ✅ 测试覆盖 |
| 事件归一(Codex exec --json) | ✅ 测试覆盖,7/8 事件对称 |
| 状态机 / 5 级过滤 / 坏消息提级 | ✅ 测试覆盖 |
| 合并队列 / 静默监视(stuck+心跳) | ✅ 测试覆盖 |
| 人话翻译(编程 + **GUI/computer-use 工具**) | ✅ 测试覆盖 |
| Mac 扬声器(say)端到端 | ✅ 回放验证 |
| APNs 推送模块(JWT/payload/http2) | ✅ 测试覆盖,待 .p8 |
| 会话存储 + 自动 --resume(持续对话) | ✅ 测试覆盖 |
| iOS spike App(token 显示 + 测试按钮) | ✅ 真机运行中 |

## MVP 范围(本次更新)

1. 编程任务语音层(Claude Code + Codex)——原范围
2. ~~computer use 语音层~~ → **降回二期**(2026-06-12 实测确认:无头会话没有 computer-use 工具,需独立 MCP+系统授权才成立;翻译词典已备)
3. 双向接力:外出无头驱动 ↔ 回桌 `claude --resume` 开窗口接管(菜单栏一键,待做)
4. 批准桥接:CLI 权限提示 → 耳机播报 + 批准(方案已调研,待实现)

## 阻塞项

**无。** 历史阻塞(401 认证、.p8 密钥)均已解决。

## 已知限制(如实记录)

- computer use 任务要求 Mac 不锁屏(CLI 任务无此限制);onboarding 须引导
- 同一会话同时只能一扇门(无头 / 窗口)
- 运行中无法插话,追加指令 = 等本轮完 + resume(CLI 能力边界)

## 下一步(优先级序)

1. 户外真实场景实测(蜂窝网络 + AirPods + 跑步)——产品定义场景的最终检验
2. Android 二期:FCM 推送(省电息屏版,需用户 Firebase 项目)、语音输入、Siri 对位(快捷指令)
3. Hermes 二期:经批准环投递到飞书等真人渠道(现为只读,绝不自动发真人)
4. onboarding 打磨;Codex app-server 批准(二期);Watch 扩展(二期)
   - ✅ APNs 已移入 relay(.p8 单点,集中发批准/选择题推送);✅ 跨机派活 + @机器名;✅ 通用选择题(ask_user)
