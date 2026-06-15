# Spike：iOS 锁屏 + AirPods 自动朗读

**验证目标**：手机锁屏装口袋、戴 AirPods、人没看屏幕时，发一条推送 →
Siri 自动用 AirPods 念出来。跑通 = 整个产品最大的技术风险被排除。

测试机：**iPhone 14**（iPhone X 只到 iOS 16，留作老机型对照）。
AirPods：**Pro / 4 都行**（Pro 2 / 4 还能验点头回复，给将来的"批准/拒绝"铺路）。

---

## 第 0 步（零代码预检，先做这个）

不用写任何代码，先证明 iOS 行为本身：

1. 戴上 AirPods，设置 → 通知 → **宣布通知（Announce Notifications）** 打开。
2. 确认某个第三方 App（微信/Telegram/Slack）在那个列表里是开的。
3. 锁屏、装口袋、别看手机。
4. 让别人给你发条消息 → 如果 Siri 念出来了，**iOS 这条路就是通的**，继续往下。

---

## 第 1 步：建 Xcode 工程

1. Xcode → New Project → **App**，Interface 选 **SwiftUI**，语言 Swift。
2. Bundle Identifier 设成你在 Apple Developer 注册的那个 App ID
   （比如 `com.swl521.earpiecespike`）。**这个值后面 push.mjs 要一字不差地用。**
3. 把工程里自动生成的 `ContentView.swift` 和 `xxxApp.swift` 删掉，
   把本目录 `ios/` 下三个文件拖进去：
   - `EarpieceSpikeApp.swift`
   - `AppDelegate.swift`
   - `ContentView.swift`
4. **Signing & Capabilities** 标签里加两个 capability：
   - **Push Notifications**
   - **Time Sensitive Notifications** ← 不加这个，time-sensitive 会被降级，朗读就不自动了
5. 选 iPhone 14 真机，Run。

App 起来后会弹通知授权 → 允许 → 屏幕上出现一长串 **device token**，点"复制 token"。

> ⚠️ Xcode 直接装真机是 **development build**，它的 token 只能走 **sandbox** APNs。
> push.mjs 里 HOST 已默认 `api.sandbox.push.apple.com`，别改。

---

## 第 2 步：配 push.mjs

打开 `push.mjs`，把顶部 CONFIG 五个值填好：

| 字段 | 哪来的 |
|------|--------|
| `P8_PATH` | 你的 `.p8` 文件路径（放本目录最省事） |
| `KEY_ID` | .p8 的 Key ID（Apple Developer → Keys 里那 10 位） |
| `TEAM_ID` | 账号 Team ID（Membership 页，10 位） |
| `BUNDLE_ID` | 和 Xcode 里 Bundle Identifier **完全一致** |
| `DEVICE_TOKEN` | 从 App 屏幕复制的那串 |

---

## 第 3 步：发推送，验证

```bash
# 普通进度播报（time-sensitive，会自动朗读）
node push.mjs "wiki: 测试跑完了，3 个通过"

# 模拟"要审批"那种
node push.mjs "claude-app: config.json 要删，批准吗？"
```

锁屏、装口袋、戴 AirPods、别看屏幕 → 应该听到 Siri 念出来。

看到 `APNs 状态: 200 ✅ 已投递` 就是发成功了。

---

## 验证清单（这次要确认的边界）

- [ ] **基本朗读**：锁屏 + 口袋 + AirPods，能听到念出来
- [ ] **title 朗读**：Siri 会不会把项目名（title）也念出来 → 决定"每句带项目名"靠不靠谱
- [ ] **频率节流**：连发 5~6 条（模拟话痨档），看 iOS 会不会压掉一部分
- [ ] **延迟**：从 `node push.mjs` 到耳朵里听到，几秒？
- [ ] **声音可接受度**：Siri 的声音、它自己压低音乐的方式，能不能忍

## 常见报错

| APNs 返回 | 意思 |
|-----------|------|
| `BadDeviceToken` | token 配错，或把 sandbox token 发去了生产服务器（确认 HOST 是 sandbox） |
| `TopicDisallowed` / `403` | `BUNDLE_ID` 和 App ID 对不上，或 App ID 没开 Push |
| `ExpiredProviderToken` | 系统时间不对导致 JWT 过期，校准时间重试 |
| 没声但状态 200 | 检查"宣布通知"开没开、AirPods 戴没戴、是不是真锁屏了 |
