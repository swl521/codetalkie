# 小易 Android(Agent Earpiece)

iOS 版(`spike/ios/`)的 Android 对等实现。手机驱动多台电脑上的编码 CLI(claude / codex / hermes),进展字幕化,并通过前台服务 + TTS 把新进展朗读到(蓝牙)耳机。

> **状态:华为真机实测通过(2026-06-12)** —— 编译/安装/三机项目列表/订阅播报/双引擎音色试听全链路 OK。

- 源码:`android/`(Kotlin + Jetpack Compose,单模块,包名 `com.example.codetalkie`)
- 后端:既有 Cloudflare relay,App 内可配地址与 token(占位 `https://your-relay.example.com`,不硬编码真实域名)

## v1 功能

| 模块 | 说明 |
|---|---|
| 主页 | `/registry` 项目列表,按引擎分组(Claude 橙 / Codex 绿 / Hermes 紫),分组可折叠;副标题取 `/projects` 的最后一句;顶部显示 `/status` 在线机器;每行铃铛 = 订阅耳机播报 |
| 对话页 | `/history` 气泡字幕(user 右蓝 / assistant 左灰 / event 居中胶囊),4 秒轮询,自动滚底;底部输入框发指令,自动加项目名前缀后 `POST /command` |
| 耳机播报 | 前台服务 `EarpieceService` 每 5 秒轮询订阅项目的 `/history`,新增 assistant 行按所选引擎朗读;通知栏常驻,带"停止"按钮 |
| **语音引擎** | 双引擎:**微软 Edge 云端神经语音**(免费无 key,晓晓/晓伊/云希/云扬/云健/晓北 6 个中文音色,失败自动回落系统)/ **系统 TTS**(离线,本地中文音色可选);设置页点选即试听 |
| 设置页 | relay 地址、token、播报开关、TTS 语速(0.5x–2.0x)、引擎与音色;DataStore Preferences 持久化 |

依赖极简(无 Firebase/FCM):HTTP 用 `HttpURLConnection`,JSON 用内置 `org.json`;唯一外部库 `okhttp`(EdgeTts 的 WebSocket)。

## 构建

### 方式一:Android Studio(推荐)

1. Android Studio(Koala 或更新)→ Open → 选 `android/` 目录
2. 首次 sync 会自动下载 Gradle 8.9 与依赖(需联网)
3. Run 'app' 或 Build → Build APK

### 方式二:命令行

前置:JDK 17、Android SDK(API 35)、`ANDROID_HOME` 已设或 `android/local.properties` 写了 `sdk.dir=...`。

```bash
cd android
# 仓库不含 gradle-wrapper.jar(二进制不入库),先用本机 gradle 生成 wrapper:
gradle wrapper --gradle-version 8.9
./gradlew assembleDebug
# 产物: app/build/outputs/apk/debug/app-debug.apk
adb install app/build/outputs/apk/debug/app-debug.apk
```

> 注:`gradle/wrapper/gradle-wrapper.properties` 已写好(Gradle 8.9),只缺 jar。没装 gradle 的话直接用 Android Studio,IDE 会自己补。

## 首次使用

1. 设置页填 relay 地址(如 `https://your-relay.example.com`)和 token → 保存
2. 主页点项目行的铃铛订阅播报(会自动拉起前台服务),戴上蓝牙耳机即可
3. 点项目进对话页看字幕、发指令

## 多语言

所有用户可见文案都在资源文件里,代码零硬编码。默认语言为中文(`res/values/strings.xml`),已内置英文包(`res/values-en/strings.xml`)。

**加一门语言 = 放一个文件:**

1. 复制 `android/app/src/main/res/values/strings.xml` 到 `values-<语言码>/strings.xml`(如日语 `values-ja/`、法语 `values-fr/`)
2. 翻译所有 `<string>` 值(键名不动;`%1$s` 占位符保留)
3. 两个**行为键**必须一并改,语音输出才会跟着语言走:
   - `tts_locale` — TTS 朗读语言(BCP-47,如 `ja-JP`):`EarpieceService` 的系统 TTS 语言和设置页的本地音色枚举都读它
   - `edge_default_voice` — 微软 Edge 云端神经语音的默认音色(如 `ja-JP-NanamiNeural`),需与 `tts_locale` 语言一致
4. (可选)在 `tts/EdgeTts.kt` 的 `VOICES` 列表加该语言的云端音色,并在各语言包里加对应 `voice_*` 标签键

系统按设备语言自动选包,没有对应包时回落到默认(中文)。试听句子(`tts_preview_system` / `tts_preview_edge`)请用目标语言自然改写,不要直译。

## 权限说明

| 权限 | 用途 |
|---|---|
| `INTERNET` | 访问 relay API |
| `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | 耳机播报前台服务(轮询 + TTS,按媒体播放类型申报,Android 14+ 必须) |
| `POST_NOTIFICATIONS` | Android 13+ 显示前台服务常驻通知(拒绝不影响功能,只是通知不可见) |

## 代码结构

```
android/app/src/main/java/com/example/codetalkie/
├── MainActivity.kt              # 入口,底部导航(主页/设置/刷新),对话页覆盖导航
├── data/
│   ├── Models.kt                # ProjectEntry/HistoryLine/ProjectLast/MachineStatus + RelayJson 解析
│   ├── RelayClient.kt           # relay HTTP 客户端(HttpURLConnection,Bearer 认证)
│   └── SettingsRepository.kt    # DataStore:url/token/播报开关/语速/订阅项目集合
├── service/
│   └── EarpieceService.kt       # 前台服务:5s 轮询订阅项目 → 新 assistant 行按引擎朗读
├── tts/
│   └── EdgeTts.kt               # 微软 Edge 云端神经语音(wss+SSML+Sec-MS-GEC)+ EdgePlayer 串行播放
└── ui/
    ├── HomeScreen.kt            # 引擎分组项目列表 + HomeViewModel
    ├── ChatScreen.kt            # 气泡字幕(4s 轮询)+ 发指令 + ChatViewModel
    ├── SettingsScreen.kt        # 设置页
    └── theme/Theme.kt           # M3 主题 + 引擎品牌色
```

## 二期规划:FCM 推送通道

v1 的轮询在 App 被杀/省电模式下会停。二期换推送:

1. 用户自建 Firebase 项目,`google-services.json` 放 `android/app/`(不入库)
2. relay 增加 FCM server key 配置,在现有 APNs 推送处(参照 `spike/push.mjs`)同时向 FCM 发送
3. App 加 `FirebaseMessagingService`:data message 携带 `{project, text}`,收到后直接 TTS 朗读(与 iOS 的 APNs 锁屏朗读对等)
4. 届时 `EarpieceService` 退化为可选的"实时模式",默认关闭以省电

## 已知限制

- 厂商 ROM(EMUI/MIUI 等)可能杀前台服务,需在系统设置里给"小易"加白名单
- 云端语音需联网;断网自动回落系统 TTS(音色取决于系统已装中文引擎)
- 重名项目(如 claude 与 codex 同名)列表 key 已按 agent+machine+cwd 区分(踩过的坑)

> Mac 命令行编译实录(已验证):brew 装 `openjdk@21` + `gradle@8` + `android-commandlinetools`,`sdkmanager` 装 platform-35/build-tools,`gradle :app:assembleDebug` 出包 `adb install`。
