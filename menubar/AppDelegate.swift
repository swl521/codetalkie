// Earpiece 菜单栏应用
// 功能:显示 daemon 运行状态、在 Terminal 里恢复 CLI 会话、启动/停止 daemon
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {

    // ── 常量 ──
    /// daemon 脚本路径(指向原仓库,不是 worktree)
    private let daemonJS = "$HOME/codetalkie/agent/src/daemon.js"
    /// LaunchAgent 标签(与 scripts/install-daemon.sh 一致)
    private let launchAgentLabel = "com.earpiece.daemon"
    /// claude CLI 原始路径(用户的 claude 是 shell alias,Terminal 脚本里必须用原始路径)
    private let claudeBin = "/opt/homebrew/bin/claude"
    private var earpieceDir: String { NSHomeDirectory() + "/.earpiece" }

    // ── UI 元素 ──
    private var statusItem: NSStatusItem!
    private let menu = NSMenu()
    private let statusMenuItem = NSMenuItem(title: "状态:检查中…", action: nil, keyEquivalent: "")
    private let resumeMenuItem = NSMenuItem(title: "在终端继续", action: nil, keyEquivalent: "")
    private let startMenuItem = NSMenuItem(title: "启动 daemon", action: #selector(startDaemon), keyEquivalent: "")
    private let stopMenuItem = NSMenuItem(title: "停止 daemon", action: #selector(stopDaemon), keyEquivalent: "")

    private var pollTimer: Timer?
    private var daemonRunning = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "🎧"

        menu.autoenablesItems = false   // 手动控制启用/置灰
        menu.delegate = self            // 打开菜单时刷新会话列表和状态

        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)
        menu.addItem(.separator())
        menu.addItem(resumeMenuItem)
        menu.addItem(.separator())
        startMenuItem.target = self
        stopMenuItem.target = self
        stopMenuItem.isEnabled = false  // 默认置灰,确认 daemon 在跑才启用
        menu.addItem(startMenuItem)
        menu.addItem(stopMenuItem)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        statusItem.menu = menu

        rebuildSessionsSubmenu()
        pollStatus()
        // 每 5 秒查一次 /status
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.pollStatus()
        }
    }

    // 打开菜单时即时刷新(不等定时器)
    func menuWillOpen(_ menu: NSMenu) {
        guard menu === self.menu else { return }
        rebuildSessionsSubmenu()
        pollStatus()
    }

    // ── daemon 状态轮询 ──

    private func pollStatus() {
        guard let url = URL(string: "http://127.0.0.1:7780/status") else { return }
        var request = URLRequest(url: url, timeoutInterval: 3)
        // Bearer token 从 ~/.earpiece/lan-token 读(每次读,token 重新生成也能跟上)
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
        statusMenuItem.title = running ? "状态:运行中" : "状态:未运行"
        startMenuItem.isEnabled = !running
        stopMenuItem.isEnabled = running   // /status 拿不到就置灰
    }

    // ── 「在终端继续」子菜单 ──

    private func rebuildSessionsSubmenu() {
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        let path = earpieceDir + "/sessions.json"
        // 格式:{"项目@目录": "sessionId"}
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
            let empty = NSMenuItem(title: "(暂无会话)", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            submenu.addItem(empty)
        }
        resumeMenuItem.submenu = submenu
    }

    /// 点击会话项:AppleScript 打开 Terminal,cd 到项目目录后 resume 该会话
    @objc private func resumeSession(_ sender: NSMenuItem) {
        guard let info = sender.representedObject as? [String: String],
              let dir = info["dir"], let sessionId = info["sessionId"] else { return }
        // 必须用 claude 原始路径(用户的 claude 是 alias,Terminal 非交互环境下不可用)
        let shellCommand = "cd \(shellQuote(dir)) && \(claudeBin) --resume \(shellQuote(sessionId))"
        // AppleScript 字符串转义:反斜杠和双引号
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

    /// 单引号 shell 转义
    private func shellQuote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    // ── 启动 / 停止 daemon ──

    @objc private func startDaemon() {
        // GUI 应用没有 shell PATH,按常见安装位置探测 node
        let candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        guard let node = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            statusMenuItem.title = "状态:找不到 node"
            return
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [daemonJS]
        // 输出追加到 ~/.earpiece/daemon.log
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
        // 稍等再查状态,让菜单尽快反映结果
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.pollStatus() }
    }

    @objc private func stopDaemon() {
        DispatchQueue.global().async { [weak self] in
            guard let self else { return }
            // 优先走 launchctl(LaunchAgent 管理的实例,KeepAlive 下 kill 会被拉起)
            let bootout = self.runSync("/bin/launchctl",
                                       ["bootout", "gui/\(getuid())/\(self.launchAgentLabel)"])
            if bootout != 0 {
                // 不是 LaunchAgent 跑的(比如手动 spawn),退而 pkill
                _ = self.runSync("/usr/bin/pkill", ["-f", "agent/src/daemon.js"])
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.pollStatus() }
        }
    }

    // ── 进程工具 ──

    /// 同步执行,返回退出码
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

    /// 异步执行,不等结果(osascript 等)
    private func runDetached(_ path: String, _ args: [String]) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = args
        try? process.run()
    }
}
