# 答鸭 Ducky 隐私政策 / Privacy Policy

最后更新 / Last updated: 2026-06-12

## 中文

答鸭(Ducky)是一个"耳机里的 AI 副驾":你的电脑上的编码 Agent 把进展用语音播报到你手机/耳机,你也能用语音把指令发回电脑。我们极度重视你的隐私,核心原则是**数据尽量不经过我们**。

**我们不收集**:你的姓名、邮箱、账号、通讯录、位置、广告标识。App 不含任何第三方分析或广告 SDK。

**配对**:电脑生成一个随机「账户密钥」,手机通过一次性 6 位配对码换取它。账户密钥只存在你的设备上,是隔离命名空间——不同账户的数据互相不可见。我们不要求注册、不绑定任何个人身份。

**中继服务器只过路、不留底**:你的指令文字和"进展摘要字幕"经我们的中继服务器在你的手机与电脑之间转发,按账户隔离临时存放(最多 200 条/项目的滚动字幕),**不含你的源代码或 Agent 完整输出**——那些直接在你电脑与手机之间走推送,不进我们服务器。删除手机端 App 或在电脑端退出即停止。

**语音**:语音转文字在你的设备本地用系统(Apple/Android)语音框架完成,我们不接收原始音频。

**推送**:用苹果 APNs / 安卓推送把播报送到锁屏。推送内容是已翻译的进展摘要。

**第三方**:中继托管于 Cloudflare 与自有服务器;推送经 Apple/Google。语音引擎可选用微软 Edge 在线语音(仅发送待朗读的文本,不发个人信息)。

**联系**:问题或数据删除请求,发邮件到 doubledragonele@icloud.com。

---

## English

Ducky is an "AI copilot in your earbuds": coding agents on your computer speak their progress to your phone/earbuds, and you can send commands back by voice. We take privacy seriously; the core principle is **keep data off our servers whenever possible**.

**We do not collect** your name, email, account, contacts, location, or advertising identifiers. The app contains no third-party analytics or ad SDKs.

**Pairing**: your computer generates a random account key; your phone obtains it via a one-time 6-digit pairing code. The account key lives only on your devices and acts as an isolation namespace — different accounts cannot see each other's data. No sign-up, no personal identity.

**Relay is pass-through**: command text and short "progress captions" are relayed between your phone and computer through our relay, stored briefly per-account (a rolling buffer, ≤200 lines per project). It **never holds your source code or full agent output** — those go directly between your computer and phone via push. Deleting the app or quitting on the computer stops it.

**Voice**: speech-to-text runs locally on your device via the system (Apple/Android) speech framework; we never receive raw audio.

**Push**: Apple APNs / Android push deliver progress captions to your lock screen.

**Third parties**: relay is hosted on Cloudflare and our own server; push via Apple/Google. An optional cloud voice (Microsoft Edge) receives only the text to be spoken, no personal data.

**Contact**: questions or data-deletion requests — doubledragonele@icloud.com.
