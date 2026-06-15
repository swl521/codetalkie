# 答鸭 / Ducky — Mac 桌面应用打包

把菜单栏 App 打成**客户机器零依赖**的独立 `.dmg`:Node 运行时与 agent
全套代码都内嵌进 `.app`,客户不用装 node、不用装任何东西,拖进
「应用程序」双击即用。

---

## 一条命令打包

```bash
scripts/build-mac.sh
```

产出在 `build-mac/dist/`:

| 文件 | 说明 |
| --- | --- |
| `Ducky.app` | 独立 App,约 **106 MB**(内嵌 node ~100MB) |
| `答鸭-Ducky.dmg` | 可下载安装镜像,约 **40 MB**(UDZO 压缩) |

### 可调参数(环境变量)

```bash
NODE_VERSION=v22.14.0 scripts/build-mac.sh   # 换内嵌 node 版本(默认 v22.14.0 LTS)
NODE_ARCH=arm64       scripts/build-mac.sh   # 默认 arm64(Apple Silicon)
SIGN_ID="Developer ID Application: 你的名字 (YOUR_TEAM_ID)" scripts/build-mac.sh
NOTARY_PROFILE=ducky-notary scripts/build-mac.sh   # 配合 SIGN_ID 做公证
```

---

## 打包做了什么

1. **xcodebuild Release** 编出 `Ducky.app`(含 AppIcon,从 spike 的 1024 答鸭图
   生成 macOS 全套尺寸)。bundle id = `com.example.codetalkie.desktop`。
2. **内嵌 Node**:下载 `nodejs.org` 官方 `node-<ver>-darwin-arm64.tar.gz`,
   只取 `bin/node` 塞进 `Ducky.app/Contents/Resources/node/bin/node`。
   **绝不依赖系统 node。**
3. **内嵌 agent**:`agent/{src,lang,tools}` 整套拷进 `Resources/agent/`。
   目录结构保持 `src ↔ lang ↔ tools` 同级,否则 `i18n.js`(读 `../lang`)和
   `daemon.js`(读 `../tools/approval-mcp.mjs`)的相对路径会断。
4. **签名 / 公证**(见下)。
5. **hdiutil** 打 `.dmg`,内含 App + 「应用程序」软链(拖拽安装)。

## App 运行时行为(Swift 侧)

- **首启**:`AppDelegate.bootstrapFirstRun()`
  - 若 `~/.earpiece/account.json` 不存在 → Swift 用 `SecRandomCopyBytes`
    生成 32 字节 → 64 hex 写入 `{"accountKey":"..."}`(与 `account.js` 同格式)。
  - 若 `~/.earpiece/relay.json` 不存在 → 写默认中继
    `{"urls":["https://your-relay.example.com","https://your-relay.example.com"]}`。
  - 已存在则**不覆盖**(保护老用户 / 已配对状态)。
- **启动 daemon**:spawn `Resources/node/bin/node Resources/agent/src/daemon.js`,
  日志追加到 `~/.earpiece/daemon.log`。
- **菜单**:连接状态 / 配对码 `XXX XXX` / 刷新配对码 / 配对窗口 / 在终端继续 /
  启动·停止 daemon / 开机自启 / 退出。
- **配对窗口**:6 位配对码 + **二维码**(CoreImage `CIQRCodeGenerator`,内容
  `codetalkie://pair?code=XXXXXX`)。配对码来自向中继
  `POST /pair/offer`(`Authorization: Bearer <accountKey>`)。
- **开机自启**:`SMAppService.mainApp`(macOS 13+)登录项,菜单里可勾选开关。

---

## 签名与公证

构建机当前 `security find-identity -v -p codesigning` **只有 "Apple Development"
证书,没有 "Developer ID Application"**,所以脚本默认走 **ad-hoc 签名(未公证)**。

### 情形 A:无 Developer ID(当前默认)

产出 ad-hoc 签名、未公证的 `.dmg`。客户首次打开会被 Gatekeeper 拦,绕过方法:

> **右键(或 Control+点击)`Ducky.app` → 打开 → 在弹窗里再点「打开」。**
> 只需做一次,之后正常双击。

或者从命令行去隔离属性:

```bash
xattr -dr com.apple.quarantine /Applications/Ducky.app
```

### 情形 B:有 Developer ID Application(Team YOUR_TEAM_ID)

```bash
# 1) 一次性建公证凭据(App 专用密码 / API key)
xcrun notarytool store-credentials ducky-notary \
  --apple-id you@example.com --team-id YOUR_TEAM_ID

# 2) 带签名 + 公证打包
SIGN_ID="Developer ID Application: 你的名字 (YOUR_TEAM_ID)" \
NOTARY_PROFILE=ducky-notary \
scripts/build-mac.sh
```

脚本会:`codesign --options runtime`(先签内嵌 node,再 `--deep` 签 App)→
`notarytool submit --wait` → `stapler staple`。装完即开,无 Gatekeeper 提示。

---

## 待办 / TODO

- [ ] **取得 Developer ID Application 证书**(Team YOUR_TEAM_ID)以做正式签名+公证。
      目前只有 Apple Development 证书,产出为 ad-hoc 未公证包。
- [ ] **Intel(x86_64)/ universal**:当前只内嵌 arm64 node。如需支持 Intel Mac,
      `NODE_ARCH=x64` 出第二份,或合成 universal node(`lipo`)。
- [ ] **瘦身**:内嵌完整 `node` 二进制 ~100MB。可考虑 `node --build-snapshot` 或
      用 Single Executable Application(SEA)进一步压缩;非阻塞项。
- [ ] **DMG 背景美化**:当前是朴素 hdiutil 镜像 + Applications 软链。若要带背景图
      和图标定位,改用 `create-dmg`(需 `brew install create-dmg`)。
- [ ] **「在终端继续」里的 claudeBin 路径硬编码** `/opt/homebrew/bin/claude`,
      客户机若装在别处需探测;非本次打包阻塞项。
