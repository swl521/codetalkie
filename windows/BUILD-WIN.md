# 答鸭 Ducky — Windows 桌面托盘应用 (BUILD-WIN)

可安装的 Windows 托盘应用(.NET 8 WPF)。客户机零依赖:自带 .NET 运行时 + node.exe
+ agent,装完后台常驻,托盘右键出配对码二维码,手机「答鸭」扫码绑定本机。

AppId `com.example.codetalkie.desktop` · 应用名 **答鸭 Ducky** · 监听 daemon 7780。

---

## 1. 环境勘察(远程 Windows 机 you@<your-windows-ip>)

| 项目 | 结果 |
|------|------|
| OS | Windows 10 19045.6093 (x64) |
| .NET SDK | **9.0.300 已装**(可编 net8.0;无需 winget install) |
| Node(系统) | v22.14.0(仅勘察用;应用**不依赖**系统 node,自带一份) |
| Inno Setup (ISCC) | 未勘察安装与否 → 见「打包现状」 |
| 仓库 | `C:\Users\you\codetalkie`(git archive 部署,含 agent/) |

**实测**:在该机已成功 `dotnet build`(0 警告 0 错误)、`dotnet publish` 自包含、
并验证自带 node.exe 能 `--check` 通过 daemon.js。

---

## 2. 工程结构

```
windows/
├─ Ducky/                      WPF 工程 (net8.0-windows, UseWPF + UseWindowsForms)
│  ├─ Ducky.csproj             单一 NuGet 依赖 QRCoder;ApplicationIcon=ducky.ico
│  ├─ App.xaml / App.xaml.cs    无主窗口入口 (ShutdownMode=OnExplicitShutdown)
│  │                            单实例锁 → 写默认配置 → 注册自启 → spawn node → 托盘
│  ├─ TrayController.cs         NotifyIcon + 右键菜单(状态/配对码/刷新/自启/重启/退出)
│  ├─ PairWindow.xaml(.cs)      6 位码 + 二维码窗口 (QRCoder 渲染)
│  ├─ RelayClient.cs            POST {relay}/pair/offer (Bearer=accountKey) → {code,expiresInSec}
│  ├─ NodeRunner.cs             spawn runtime\node\node.exe runtime\agent\src\daemon.js
│  ├─ Config.cs                 ~/.earpiece 的 relay.json / account.json(C# 端口 account.js)
│  ├─ AutoStart.cs              HKCU\...\Run 开机自启(每用户,无需 UAC)
│  ├─ Assets/                   ducky.ico(6 尺寸 16-256,源自 spike icon-1024)+ logo.png
│  └─ runtime/                  [生成物,gitignore] node.exe + agent/src + agent/lang
└─ packaging/
   ├─ stage-runtime.ps1         下载官方 node-win-x64,拷 agent → Ducky/runtime/
   ├─ build.ps1                 stage + dotnet publish 自包含 +(可选)Inno 编译
   ├─ ducky.iss                 Inno Setup 脚本(每用户装到 %LOCALAPPDATA%\Ducky)
   └─ install.bat               无 Inno 兜底:robocopy 到 %LOCALAPPDATA%\Ducky 并启动
```

约束遵守:只新建 `windows/`,只读引用 `agent/`;未碰 spike/android/menubar/relay/relay-node。

---

## 3. 内嵌 Node 方案(零系统依赖)

- **agent 无 npm 依赖**:`agent/src/*.js` 只用 `node:` 内建模块(已核实),
  所以 `stage-runtime.ps1` 仅需:① 下载官方 `node-v22.14.0-win-x64.zip` 取 `node.exe`;
  ② 拷 `agent/src` + `agent/lang`。**不跑 `npm install`**。
- 运行期布局(发布后,紧挨 `Ducky.exe`):
  ```
  Ducky.exe
  runtime\node\node.exe
  runtime\agent\src\daemon.js
  runtime\agent\lang\*.json
  ```
- `NodeRunner` 用**绝对路径**起 `node.exe daemon.js`,工作目录 `runtime\agent`,
  stdout/stderr 追加到 `~/.earpiece\daemon.log`。系统装没装 node 都不影响。

---

## 4. 配对 + 二维码

1. `RelayClient.RequestPairCodeAsync()` 读 `~/.earpiece/relay.json` 主中继 +
   `~/.earpiece/account.json` 的 accountKey(没有就生成 64-hex,逻辑同 `account.js`)。
2. `POST {relay}/pair/offer`,`Authorization: Bearer <accountKey>`,body `{}` →
   `{ "code":"123456", "expiresInSec":600 }`。
3. `PairWindow` 显示 `123 456` 大字 + 二维码(QRCoder,内容
   `codetalkie://pair?code=123456`),并提示有效分钟数。
4. 默认中继随包写入(若 `relay.json` 不存在):
   `{"urls":["https://your-relay.example.com","https://your-relay.example.com"]}` — 不含真实 token。

---

## 5. 构建 / 打包命令

在 Windows 机仓库根 `C:\Users\you\codetalkie` 执行:

```powershell
# 一步到位(stage 运行时 → 自包含 publish →(有 ISCC 则)Inno 安装包)
pwsh windows\packaging\build.ps1

# 或分步:
pwsh windows\packaging\stage-runtime.ps1 -NodeVersion 22.14.0
dotnet publish windows\Ducky\Ducky.csproj -c Release -r win-x64 --self-contained true
```

产物:
```
windows\Ducky\bin\Release\net8.0-windows\win-x64\publish\   ← 自包含应用文件夹(含 install.bat)
windows\dist\DuckySetup-0.1.0.exe                            ← 若有 Inno Setup
```

调试运行(本机有 .NET SDK 即可,需先 stage-runtime 才会起 daemon):
```powershell
dotnet run --project windows\Ducky\Ducky.csproj
```

---

## 6. 打包现状

- ✅ **自包含 publish 已跑通**:`win-x64 --self-contained`,产物 ~225 MB / 270 文件,
  含 `Ducky.exe` + `coreclr.dll`(.NET 运行时)+ `PresentationFramework.dll`(WPF)
  + `QRCoder.dll` + `runtime\node\node.exe`(v22.14.0)+ `runtime\agent\`。
  自带 node 实测 `--check daemon.js` 通过。
- ✅ **install.bat 兜底**:随 publish 一起落地(csproj 拷贝)。双击即装到
  `%LOCALAPPDATA%\Ducky` 并启动,无需管理员。
- ⚠️ **Inno Setup**:`ducky.iss` 已写好,`build.ps1` 会自动探测 ISCC;
  目标机**是否装了 Inno Setup 6 未确认**。装了则出 `DuckySetup-0.1.0.exe`,
  没装则 self-contained 文件夹 + install.bat 即交付物。
- ⚠️ 体积可优化:可加 `/p:PublishTrimmed=true`(WPF 对裁剪支持有限,需回归测试)
  或改 framework-dependent(但那样客户机需先装 .NET 8 Desktop Runtime,违背零依赖)。

---

## 7. 待办 (TODO)

- [ ] **真机端到端**:在干净 Windows 上跑 install.bat → 托盘出现 → 右键「配对码」
      → 二维码弹出 → 手机「答鸭」扫码绑定 → 发指令验证 daemon 接管。
      (本轮已验证编译 + 自带 node 加载 daemon;**UI/托盘/配对 RUN 时行为尚未真机点验**。)
- [ ] 确认目标机 Inno Setup 是否安装;没有则装 `winget install JRSoftware.InnoSetup`
      以产出单文件 .exe 安装包。
- [ ] 托盘图标在浅色/深色任务栏的可见度(ducky.ico 已含 16/32 小尺寸,需肉眼确认)。
- [ ] daemon 崩溃自愈:目前 NodeRunner 不自动重启(菜单有「重启后台服务」手动项);
      可加进程退出监听 + 退避重启。
- [ ] 代码签名:未签名 exe 会触发 SmartScreen。客户分发前考虑签名证书。
- [ ] `relay.json` 默认中继 turn/apple 的可达性需在客户网络确认。
