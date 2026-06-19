// 答鸭 / Ducky 桌面应用 —— 菜单栏 + 配对窗口
//
// 与旧菜单栏骨架的区别:
//   • 内嵌 Node 运行时与 agent 代码,绝不依赖系统 node。
//     daemon 路径来自 app bundle 内 Resources/agent/src/daemon.js,
//     node 来自 Resources/node/bin/node。
//   • 首启自动:生成账户密钥(~/.earpiece/account.json)、写默认中继
//     (~/.earpiece/relay.json)、启动 daemon、登录项自启(SMAppService)。
//   • 菜单含「连接状态 / 配对码 XXX XXX / 刷新码 / 配对窗口 / 退出」。
//   • 配对窗口显示 6 位配对码 + 二维码(CoreImage CIQRCodeGenerator,
//     内容 codetalkie://pair?code=XXXXXX)。
import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import ServiceManagement

// 简易中英:系统语言是英文就给英文,否则中文。AppKit 不自动本地化,这里内联手搓。
private let earpieceIsEN = (Locale.preferredLanguages.first ?? "zh").hasPrefix("en")
func L(_ zh: String, _ en: String) -> String { earpieceIsEN ? en : zh }

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {

    // ── 常量 ──
    /// LaunchAgent 标签(停 daemon 时若由登录项托管会用到;此处沿用旧标签兼容)
    private let launchAgentLabel = "com.earpiece.daemon"
    /// 产品默认中继(随包提供;首启写入 ~/.earpiece/relay.json,用户可改)
    private let defaultRelays = ["https://your-relay.example.com", "https://your-relay.example.com"]
    /// claude CLI 原始路径(用户的 claude 是 alias,Terminal 非交互环境必须用原始路径)
    private let claudeBin = "/opt/homebrew/bin/claude"
    /// 版本号:每次更新菜单栏都改这里,显示在状态行,方便确认软件真的更新了。
    private let appVersion = "0.1.6 · 0619d(配对合并+设备区分)"

    private var earpieceDir: String { NSHomeDirectory() + "/.earpiece" }

    /// bundle 内嵌的 node 二进制
    private var bundledNode: String? {
        Bundle.main.path(forResource: "node/bin/node", ofType: nil)
            ?? Bundle.main.path(forResource: "node", ofType: nil, inDirectory: "node/bin")
    }
    /// bundle 内嵌的 daemon 脚本
    private var bundledDaemonJS: String? {
        Bundle.main.path(forResource: "daemon", ofType: "js", inDirectory: "agent/src")
    }

    // ── UI 元素 ──
    private var statusItem: NSStatusItem!
    private let menu = NSMenu()
    private let statusMenuItem = NSMenuItem(title: L("连接:检查中…", "Status: checking…"), action: nil, keyEquivalent: "")
    private let codeMenuItem = NSMenuItem(title: L("配对码:— — —", "Pair code: — — —"), action: nil, keyEquivalent: "")
    private let devicesMenuItem = NSMenuItem(title: L("已绑定:— 台手机", "Paired phones: —"), action: nil, keyEquivalent: "")
    private let pairMenuItem = NSMenuItem(title: L("绑定新手机…", "Pair a new phone…"), action: #selector(showPairWindow), keyEquivalent: "")
    private let resumeMenuItem = NSMenuItem(title: L("在终端继续", "Continue in Terminal"), action: nil, keyEquivalent: "")
    private let startMenuItem = NSMenuItem(title: L("启动后台 daemon", "Start daemon"), action: #selector(startDaemon), keyEquivalent: "")
    private let stopMenuItem = NSMenuItem(title: L("停止后台 daemon", "Stop daemon"), action: #selector(stopDaemon), keyEquivalent: "")
    private let loginItem = NSMenuItem(title: L("开机自启", "Launch at login"), action: #selector(toggleLoginItem), keyEquivalent: "")

    private var pollTimer: Timer?
    private var daemonRunning = false
    private var currentCode: String?
    private var pairWindow: NSWindow?

    // ── 生命周期 ──

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        // 菜单栏图标 = 手机上同款答鸭(彩色,非模板)。取不到才退回 emoji。
        if let icon = NSImage(named: "MenuBarIcon") {
            icon.size = NSSize(width: 18, height: 18)
            icon.isTemplate = false
            statusItem.button?.image = icon
            statusItem.button?.title = ""
        } else {
            statusItem.button?.title = "🦆"
        }

        menu.autoenablesItems = false
        menu.delegate = self

        statusMenuItem.isEnabled = false
        codeMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)
        devicesMenuItem.isEnabled = false
        menu.addItem(devicesMenuItem)
        menu.addItem(.separator())
        pairMenuItem.target = self
        menu.addItem(pairMenuItem)
        menu.addItem(.separator())
        menu.addItem(resumeMenuItem)
        menu.addItem(.separator())
        startMenuItem.target = self
        stopMenuItem.target = self
        stopMenuItem.isEnabled = false
        loginItem.target = self
        menu.addItem(startMenuItem)
        menu.addItem(stopMenuItem)
        menu.addItem(loginItem)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: L("退出答鸭", "Quit Ducky"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        statusItem.menu = menu

        // 首启准备:账户密钥 + 默认中继落盘,然后启动 daemon
        bootstrapFirstRun()
        startDaemonIfBundled()
        syncLoginItemState()

        rebuildSessionsSubmenu()
        pollStatus()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.pollStatus()
        }
        // daemon 起来后取一次配对码
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.refreshPairCode() }
    }

    func menuWillOpen(_ menu: NSMenu) {
        guard menu === self.menu else { return }
        rebuildSessionsSubmenu()
        pollStatus()
    }

    // ── 首启准备 ──

    /// 写 ~/.earpiece/account.json(账户密钥)与 ~/.earpiece/relay.json(默认中继)。
    /// account.json 已存在则不动(保留老用户/已配对状态)。
    private func bootstrapFirstRun() {
        try? FileManager.default.createDirectory(atPath: earpieceDir, withIntermediateDirectories: true)

        let acctPath = earpieceDir + "/account.json"
        if !FileManager.default.fileExists(atPath: acctPath) {
            let key = randomHex(32) // 32 字节 → 64 hex,与 account.js 一致
            let json = "{\n  \"accountKey\": \"\(key)\"\n}\n"
            try? json.write(toFile: acctPath, atomically: true, encoding: .utf8)
        }

        let relayPath = earpieceDir + "/relay.json"
        if !FileManager.default.fileExists(atPath: relayPath) {
            let urls = defaultRelays.map { "\"\($0)\"" }.joined(separator: ", ")
            let json = "{\n  \"urls\": [\(urls)]\n}\n"
            try? json.write(toFile: relayPath, atomically: true, encoding: .utf8)
        }
    }

    /// 32 字节加密随机数 → hex
    private func randomHex(_ bytes: Int) -> String {
        var data = Data(count: bytes)
        _ = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!) }
        return data.map { String(format: "%02x", $0) }.joined()
    }

    private func readAccountKey() -> String? {
        let path = earpieceDir + "/account.json"
        guard let data = FileManager.default.contents(atPath: path),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let key = obj["accountKey"] as? String, !key.isEmpty else { return nil }
        return key
    }

    private func primaryRelay() -> String? {
        let path = earpieceDir + "/relay.json"
        if let data = FileManager.default.contents(atPath: path),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let urls = obj["urls"] as? [String], let first = urls.first { return first }
            if let url = obj["url"] as? String { return url }
        }
        return defaultRelays.first
    }

    // ── daemon 启动(内嵌 node + 内嵌 daemon.js)──

    /// 启动前置:bundle 里有 node 和 daemon.js 才自动起;缺则留给菜单手动诊断。
    private func startDaemonIfBundled() {
        guard let node = bundledNode, let js = bundledDaemonJS else {
            statusMenuItem.title = L("连接:缺内嵌组件(开发构建?)", "Status: missing embedded components (dev build?)")
            return
        }
        // 已在跑就不重复 spawn(靠 /status 探测,失败才起)
        pollStatus()
        spawnDaemon(node: node, js: js)
    }

    @objc private func startDaemon() {
        guard let node = bundledNode, let js = bundledDaemonJS else {
            statusMenuItem.title = L("连接:找不到内嵌 node/daemon", "Status: embedded node/daemon not found")
            return
        }
        spawnDaemon(node: node, js: js)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.pollStatus() }
    }

    private func spawnDaemon(node: String, js: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [js]
        // GUI 应用 PATH 很窄,补上 CLI 常见安装位置 + 内嵌 node 自身目录
        var env = ProcessInfo.processInfo.environment
        let nodeDir = (node as NSString).deletingLastPathComponent
        let extra = [nodeDir, NSHomeDirectory() + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
        env["PATH"] = (extra + [env["PATH"] ?? ""]).joined(separator: ":")
        process.environment = env

        let logPath = earpieceDir + "/daemon.log"
        try? FileManager.default.createDirectory(atPath: earpieceDir, withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil)
        }
        if let log = FileHandle(forWritingAtPath: logPath) {
            log.seekToEndOfFile()
            process.standardOutput = log
            process.standardError = log
        }
        try? process.run()
    }

    @objc private func stopDaemon() {
        DispatchQueue.global().async { [weak self] in
            guard let self else { return }
            let bootout = self.runSync("/bin/launchctl",
                                       ["bootout", "gui/\(getuid())/\(self.launchAgentLabel)"])
            if bootout != 0 {
                _ = self.runSync("/usr/bin/pkill", ["-f", "agent/src/daemon.js"])
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.pollStatus() }
        }
    }

    // ── daemon 状态轮询 ──

    private func pollStatus() {
        guard let url = URL(string: "http://127.0.0.1:7780/status") else { return }
        var request = URLRequest(url: url, timeoutInterval: 3)
        if let token = try? String(contentsOfFile: earpieceDir + "/lan-token", encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { self?.applyStatus(running: ok) }
        }.resume()
    }

    private func applyStatus(running: Bool) {
        daemonRunning = running
        statusMenuItem.title = running ? L("连接:运行中 ✓ · v\(appVersion)", "Status: running ✓ · v\(appVersion)") : L("连接:未运行 · v\(appVersion)", "Status: not running · v\(appVersion)")
        startMenuItem.isEnabled = !running
        stopMenuItem.isEnabled = running
        pollDevices()
    }

    // 向中继查这个账户绑了哪些手机(/status 的 deviceList:[{name,lastSeen}];旧中继只有 devices 计数)
    private func pollDevices() {
        guard let relay = primaryRelay(), let key = readAccountKey(),
              let url = URL(string: relay + "/status") else { return }
        var req = URLRequest(url: url, timeoutInterval: 6)
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let self, let data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            let list = (obj["deviceList"] as? [[String: Any]]) ?? []
            let n = list.isEmpty ? (obj["devices"] as? Int ?? 0) : list.count
            DispatchQueue.main.async {
                if n == 0 {
                    self.devicesMenuItem.title = L("还没绑定手机 — 让手机扫下面的码", "No phones paired — scan the code below")
                    self.devicesMenuItem.submenu = nil
                    self.devicesMenuItem.isEnabled = false
                    return
                }
                self.devicesMenuItem.title = L("已绑定:\(n) 台手机 ▸", "Paired phones: \(n) ▸")
                // 旧中继只给数量、没名字 → 无可解绑子菜单,保持禁用纯文字
                guard !list.isEmpty else {
                    self.devicesMenuItem.submenu = nil
                    self.devicesMenuItem.isEnabled = false
                    return
                }
                let sub = NSMenu()
                sub.autoenablesItems = false
                for d in list {
                    let full = (d["name"] as? String) ?? "?"
                    let ts = (d["lastSeen"] as? Double) ?? 0
                    let suffix = self.deviceSuffix(full)
                    let idPart = suffix.isEmpty ? "" : " (\(suffix))"
                    let item = NSMenuItem(title: "📱 \(self.shortDeviceName(full))\(idPart)  ·  \(self.relTime(ts))   ✕",
                                          action: #selector(self.unbindTapped(_:)), keyEquivalent: "")
                    item.target = self
                    item.representedObject = full
                    item.toolTip = L("点击解绑这台手机", "Click to unbind this phone")
                    sub.addItem(item)
                }
                self.devicesMenuItem.submenu = sub
                self.devicesMenuItem.isEnabled = true   // 必须可用,鼠标才能移进去打开解绑子菜单
            }
        }.resume()
    }

    // 设备名形如 "Miles 的 iPhone·1a2b3c4d",显示时去掉 ·后缀
    private func shortDeviceName(_ s: String) -> String {
        s.split(separator: "·").first.map(String.init) ?? s
    }
    // ·后缀(vendorID 前8位)——两台同名手机靠它区分
    private func deviceSuffix(_ s: String) -> String {
        let parts = s.split(separator: "·", maxSplits: 1)
        return parts.count > 1 ? String(parts[1]) : ""
    }
    // 毫秒时间戳 → "刚刚 / N 分钟前 / N 小时前 / N 天前"
    private func relTime(_ ms: Double) -> String {
        guard ms > 0 else { return L("未知", "unknown") }
        let sec = Int(Date().timeIntervalSince1970 - ms / 1000)
        if sec < 60 { return L("刚刚", "just now") }
        if sec < 3600 { return L("\(sec/60) 分钟前", "\(sec/60)m ago") }
        if sec < 86400 { return L("\(sec/3600) 小时前", "\(sec/3600)h ago") }
        return L("\(sec/86400) 天前", "\(sec/86400)d ago")
    }

    // 点设备项 → 确认 → 解绑
    @objc private func unbindTapped(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        let alert = NSAlert()
        alert.messageText = L("解绑「\(shortDeviceName(name))」?", "Unbind “\(shortDeviceName(name))”?")
        alert.informativeText = L("它将不再收到播报和批准。", "It will stop receiving broadcasts and approvals.")
        alert.addButton(withTitle: L("解绑", "Unbind"))
        alert.addButton(withTitle: L("取消", "Cancel"))
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        unbindDevice(name)
    }

    private func unbindDevice(_ name: String) {
        guard let relay = primaryRelay(), let key = readAccountKey(),
              let url = URL(string: relay + "/device/unbind") else { return }
        var req = URLRequest(url: url, timeoutInterval: 8)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["device": name])
        URLSession.shared.dataTask(with: req) { [weak self] _, _, _ in
            DispatchQueue.main.async { self?.pollDevices() }
        }.resume()
    }

    // ── 配对码(向中继 POST /pair/offer,bearer = 账户密钥)──

    @objc private func refreshPairCode() {
        guard let relay = primaryRelay(), let key = readAccountKey(),
              let url = URL(string: relay + "/pair/offer") else {
            codeMenuItem.title = L("配对码:缺账户/中继", "Pair code: missing account/relay")
            return
        }
        var req = URLRequest(url: url, timeoutInterval: 10)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        req.httpBody = "{}".data(using: .utf8)

        URLSession.shared.dataTask(with: req) { [weak self] data, response, _ in
            guard let self else { return }
            var code: String?
            if let data = data,
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                code = obj["code"] as? String
            }
            DispatchQueue.main.async {
                if let code = code {
                    self.currentCode = code
                    self.codeMenuItem.title = L("配对码:\(self.prettyCode(code))", "Pair code: \(self.prettyCode(code))")
                    self.updatePairWindowIfOpen()
                } else {
                    self.codeMenuItem.title = L("配对码:获取失败(daemon 在跑吗?)", "Pair code: fetch failed (is the daemon running?)")
                }
            }
        }.resume()
    }

    private func prettyCode(_ code: String) -> String {
        guard code.count == 6 else { return code }
        let i = code.index(code.startIndex, offsetBy: 3)
        return "\(code[..<i]) \(code[i...])"
    }

    // ── 配对窗口(6 位码 + 二维码)──

    @objc private func showPairWindow() {
        if pairWindow == nil {
            let win = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 360, height: 460),
                styleMask: [.titled, .closable],
                backing: .buffered, defer: false)
            win.title = L("答鸭 · 配对", "Ducky · Pairing")
            win.isReleasedWhenClosed = false
            win.center()
            pairWindow = win
        }
        rebuildPairWindowContent()
        NSApp.activate(ignoringOtherApps: true)
        pairWindow?.makeKeyAndOrderFront(nil)
        if currentCode == nil { refreshPairCode() }
    }

    private func updatePairWindowIfOpen() {
        if let win = pairWindow, win.isVisible { rebuildPairWindowContent() }
    }

    private func rebuildPairWindowContent() {
        guard let win = pairWindow else { return }
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 460))

        let title = NSTextField(labelWithString: L("手机「答鸭」→ 绑定电脑", "Phone “Ducky” → Pair a computer"))
        title.font = .systemFont(ofSize: 15, weight: .semibold)
        title.alignment = .center
        title.frame = NSRect(x: 0, y: 410, width: 360, height: 24)
        content.addSubview(title)

        let code = currentCode ?? ""
        let qrContent = "codetalkie://pair?code=\(code)"
        if !code.isEmpty, let qr = makeQR(qrContent) {
            let img = NSImageView(frame: NSRect(x: 60, y: 150, width: 240, height: 240))
            img.image = qr
            img.imageScaling = .scaleProportionallyUpOrDown
            content.addSubview(img)
        } else {
            let waiting = NSTextField(labelWithString: L("正在获取配对码…", "Fetching pair code…"))
            waiting.alignment = .center
            waiting.frame = NSRect(x: 0, y: 260, width: 360, height: 24)
            content.addSubview(waiting)
        }

        let codeLabel = NSTextField(labelWithString: code.isEmpty ? "— — —" : prettyCode(code))
        codeLabel.font = .monospacedSystemFont(ofSize: 34, weight: .bold)
        codeLabel.alignment = .center
        codeLabel.frame = NSRect(x: 0, y: 95, width: 360, height: 46)
        content.addSubview(codeLabel)

        let hint = NSTextField(labelWithString: L("扫码或手输这 6 位 · 10 分钟内有效", "Scan or type these 6 digits · valid for 10 min"))
        hint.font = .systemFont(ofSize: 12)
        hint.textColor = .secondaryLabelColor
        hint.alignment = .center
        hint.frame = NSRect(x: 0, y: 60, width: 360, height: 20)
        content.addSubview(hint)

        let multi = NSTextField(labelWithString: L("想绑多台手机?每台扫一次即可,绑完点「再来一个」出新码", "Pairing several phones? Scan once each, then click “New code” for the next."))
        multi.font = .systemFont(ofSize: 11)
        multi.textColor = .tertiaryLabelColor
        multi.alignment = .center
        multi.frame = NSRect(x: 0, y: 42, width: 360, height: 18)
        content.addSubview(multi)

        let refresh = NSButton(title: L("再来一个(给下一台手机)", "New code (for the next phone)"), target: self, action: #selector(refreshPairCode))
        refresh.bezelStyle = .rounded
        refresh.frame = NSRect(x: 120, y: 18, width: 120, height: 30)
        content.addSubview(refresh)

        win.contentView = content
    }

    /// CoreImage 生成二维码 NSImage
    private func makeQR(_ string: String) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scale: CGFloat = 12
        let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let rep = NSCIImageRep(ciImage: scaled)
        let image = NSImage(size: rep.size)
        image.addRepresentation(rep)
        return image
    }

    // ── 开机自启(SMAppService,macOS 13+)──

    private func syncLoginItemState() {
        if #available(macOS 13.0, *) {
            loginItem.state = (SMAppService.mainApp.status == .enabled) ? .on : .off
        } else {
            loginItem.isHidden = true
        }
    }

    @objc private func toggleLoginItem() {
        guard #available(macOS 13.0, *) else { return }
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            NSLog("登录项切换失败: \(error)")
        }
        syncLoginItemState()
    }

    // ── 「在终端继续」子菜单(沿用旧逻辑)──

    private func rebuildSessionsSubmenu() {
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        let path = earpieceDir + "/sessions.json"
        if let data = FileManager.default.contents(atPath: path),
           let map = try? JSONSerialization.jsonObject(with: data) as? [String: String],
           !map.isEmpty {
            for (key, sessionId) in map.sorted(by: { $0.key < $1.key }) {
                let parts = key.split(separator: "@", maxSplits: 1).map(String.init)
                let project = parts.first ?? key
                let dir = parts.count > 1 ? parts[1] : NSHomeDirectory()
                let item = NSMenuItem(title: "\(project) — \(dir)",
                                      action: #selector(resumeSession(_:)),
                                      keyEquivalent: "")
                item.target = self
                item.representedObject = ["dir": dir, "sessionId": sessionId]
                submenu.addItem(item)
            }
        } else {
            let empty = NSMenuItem(title: L("(暂无会话)", "(no sessions)"), action: nil, keyEquivalent: "")
            empty.isEnabled = false
            submenu.addItem(empty)
        }
        resumeMenuItem.submenu = submenu
    }

    @objc private func resumeSession(_ sender: NSMenuItem) {
        guard let info = sender.representedObject as? [String: String],
              let dir = info["dir"], let sessionId = info["sessionId"] else { return }
        // 带上 agent-hub 通道:开的终端才会注册成 hub 会话、能直接收手机指令(成为主线程)。
        let shellCommand = "cd \(shellQuote(dir)) && \(claudeBin) --dangerously-load-development-channels server:agent-hub --resume \(shellQuote(sessionId))"
        let escaped = shellCommand
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let script = """
        tell application "Terminal"
            activate
            do script "\(escaped)"
        end tell
        """
        runDetached("/usr/bin/osascript", ["-e", script])
    }

    private func shellQuote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    // ── 进程工具 ──

    private func runSync(_ path: String, _ args: [String]) -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = args
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus
        } catch {
            return -1
        }
    }

    private func runDetached(_ path: String, _ args: [String]) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = args
        try? process.run()
    }
}
