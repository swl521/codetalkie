# Agent Earpiece — 产品进度

> 更新:2026-06-11 深夜 · 上一版:2026-06-10 产品讨论全文档

## 一句话状态

**🌍 公网开通(2026-06-11):relay=https://your-relay.example.com(Cloudflare Worker+DO),手机任何网络可用,Mac 出站长轮询免开端口。三管道全通(2026-06-11):下行(电脑→耳机)+ 上行(说话→电脑)+ 批准环(它问你批)全部用户实测成立。产品能聊、能干、有刹车。**

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
| 06-11 | .p8 到位(KeyID XXXXXXXXXX),APNs 首推 200;push sink 接入管线(`--push`) |
| 06-11 | **🎉 产品完整闭环**:真任务(写诗)全程推送锁屏 iPhone,Siri AirPods 朗读 |

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
2. **computer use 语音层(新):耳机指挥 Claude 操作电脑(邮件/文件/浏览器),同一管线,翻译词典已支持**
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
2. daemon 转 LaunchAgent 常驻 + 装菜单栏 App(脚本/产物已备)
3. onboarding 打磨(自检 401→引导 setup-token;通知/麦克风授权引导)
4. Codex app-server 批准(二期);Watch 扩展(二期)
