import SwiftUI
import UserNotifications
import AppIntents

struct DaemonStatus {
    var reachable = false
    var running: String?
    var queued = 0
    var pendingApprovals = 0
}

// 电脑上扫出来的现成项目(只读;唯一可改的是叫法)
struct RegEntry: Identifiable, Equatable {
    var id: String { "\(agent)@\(cwd)" }
    let name: String
    let cwd: String
    let agent: String   // claude | codex
    let base: String
    let needsRename: Bool
}

struct ContentView: View {
    @AppStorage("assistantName") private var assistantName = ""
    @State private var nameDraft = ""
    @State private var naming = false

    @State private var status = DaemonStatus()
    @State private var command = ""
    @State private var sendResult = ""

    @State private var token = AppDelegate.deviceTokenString
    @State private var scheduled = ""

    @StateObject private var speech = SpeechInput()
    @State private var chatProjects: [(name: String, last: String)] = []
    @State private var registry: [RegEntry] = []
    @State private var renameTarget: RegEntry?
    @State private var renameDraft = ""

    private let pollTimer = Timer.publish(every: 5, on: .main, in: .common).autoconnect()

    private var displayName: String { assistantName.isEmpty ? "小易" : assistantName }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    header
                    statusCard
                    voiceButton
                    chatsCard
                    commandCard
                    siriCard
                    devTools
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
        }
        .task {
            EarpieceShortcuts.updateAppShortcutParameters()
            if assistantName.isEmpty { naming = true }
            await refreshStatus()
            await refreshProjects()
            await refreshRegistry()
        }
        .onReceive(pollTimer) { _ in Task { await refreshStatus(); await refreshProjects(); await refreshRegistry() } }
        .onReceive(NotificationCenter.default.publisher(for: AppDelegate.tokenUpdated)) { note in
            if let value = note.object as? String { token = value }
        }
        .alert("给你的助手起个名字", isPresented: $naming) {
            TextField("比如:小易", text: $nameDraft)
            Button("就叫这个") {
                let n = nameDraft.trimmingCharacters(in: .whitespaces)
                if !n.isEmpty { assistantName = n }
            }
        } message: {
            Text("名字用在 App 里。Siri 召唤语是\"告诉小易\"(正式版会提供可选别名)。")
        }
    }

    // ── 顶部:头像 + 名字 + 改名 ──
    private var header: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [Color(red: 0.07, green: 0.32, blue: 0.92), Color(red: 0.02, green: 0.78, blue: 0.72)],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 84, height: 84)
                Image(systemName: "headphones")
                    .font(.system(size: 40, weight: .medium))
                    .foregroundStyle(.white)
            }
            HStack(spacing: 6) {
                Text(displayName).font(.title2).bold()
                Button {
                    nameDraft = assistantName
                    naming = true
                } label: { Image(systemName: "pencil").font(.footnote) }
            }
            Text("耳机里的 AI 副驾").font(.caption).foregroundStyle(.secondary)
        }
        .padding(.top, 8)
    }

    // ── 电脑连接状态 ──
    private var statusCard: some View {
        HStack(spacing: 10) {
            Circle().fill(status.reachable ? .green : .red).frame(width: 10, height: 10)
            if status.reachable {
                VStack(alignment: .leading, spacing: 2) {
                    Text(status.running == nil ? "电脑已连接 · 空闲" : "正在干:\(status.running!)")
                        .font(.subheadline).bold()
                    if status.queued > 0 || status.pendingApprovals > 0 {
                        Text("排队 \(status.queued) · 等批准 \(status.pendingApprovals)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            } else {
                Text("联不上电脑(同一 WiFi?daemon 开着?)")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 14))
    }

    // ── 主按钮:按一下说话,再按一下结束并自动发送 ──
    private var voiceButton: some View {
        VStack(spacing: 10) {
            Button {
                speech.toggle()
            } label: {
                ZStack {
                    Circle()
                        .fill(speech.recording
                              ? AnyShapeStyle(Color.red)
                              : AnyShapeStyle(LinearGradient(colors: [Color(red: 0.07, green: 0.32, blue: 0.92), Color(red: 0.02, green: 0.78, blue: 0.72)],
                                                             startPoint: .topLeading, endPoint: .bottomTrailing)))
                        .frame(width: 108, height: 108)
                        .shadow(color: (speech.recording ? Color.red : Color.blue).opacity(0.35), radius: 14, y: 6)
                    Image(systemName: speech.recording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 44, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
            .scaleEffect(speech.recording ? 1.08 : 1.0)
            .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: speech.recording)

            Text(speech.recording
                 ? (speech.transcript.isEmpty ? "在听…说吧" : speech.transcript)
                 : "点一下,直接说")
                .font(.subheadline)
                .foregroundStyle(speech.recording ? .primary : .secondary)
                .multilineTextAlignment(.center)

            if speech.denied {
                Text("麦克风/语音识别权限被拒,去 设置→小易 打开").font(.caption).foregroundStyle(.red)
            }
        }
        .onChange(of: speech.recording) { nowRecording in
            // 录音结束:转写结果进输入框并自动发送
            if !nowRecording {
                let said = speech.transcript.trimmingCharacters(in: .whitespaces)
                if !said.isEmpty {
                    command = said
                    sendToMac()
                }
            }
        }
    }

    // ── 项目(电脑上扫出来的现成项目,按引擎分组;长按改叫法) ──
    private var chatsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("项目 · 说\"名字 + 要做的事\"").font(.headline)
            if registry.isEmpty {
                Text("正在从电脑读取项目…").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(["claude", "codex"], id: \.self) { agent in
                let group = registry.filter { $0.agent == agent }
                if !group.isEmpty {
                    Text(agent == "claude" ? "Claude · \(group.count) 个" : "Codex · \(group.count) 个")
                        .font(.caption2).bold()
                        .padding(.horizontal, 10).padding(.vertical, 3)
                        .background(agent == "claude" ? Color.orange.opacity(0.15) : Color.green.opacity(0.15), in: Capsule())
                        .foregroundStyle(agent == "claude" ? .orange : .green)
                        .padding(.top, 4)
                    ForEach(group) { e in
                        NavigationLink(destination: ChatView(project: e.name)) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(e.name).font(.subheadline).bold()
                                        .foregroundStyle(e.needsRename ? .orange : .primary)
                                    Text(e.needsRename ? "重名了,长按改个名" : (lastLine(e.name) ?? e.base))
                                        .font(.caption)
                                        .foregroundStyle(e.needsRename ? .orange : .secondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button { renameTarget = e; renameDraft = e.name } label: {
                                Label("改叫法", systemImage: "pencil")
                            }
                            Text(e.cwd)
                        }
                    }
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 14))
        .alert("给它起个顺口的名字", isPresented: Binding(get: { renameTarget != nil }, set: { if !$0 { renameTarget = nil } })) {
            TextField("比如:维基", text: $renameDraft)
            Button("保存") { if let t = renameTarget { submitRename(t, to: renameDraft) } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("名字要全局唯一,以后说\"新名字 + 要做的事\"")
        }
    }

    private func lastLine(_ name: String) -> String? {
        chatProjects.first(where: { $0.name == name })?.last
    }

    // ── 发指令 ──
    private var commandCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("发指令").font(.headline)
            HStack {
                TextField("项目名 + 要做的事,如:wiki 跑测试", text: $command)
                    .textFieldStyle(.roundedBorder)
                Button {
                    sendToMac()
                } label: {
                    Image(systemName: "paperplane.fill")
                }
                .buttonStyle(.borderedProminent)
                .disabled(command.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if !sendResult.isEmpty {
                Text(sendResult).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 14))
    }

    // ── Siri 用法 ──
    private var siriCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("用 Siri(锁屏也行)").font(.headline)
            Label("\"嘿 Siri,告诉\(displayName)\" → 再说指令", systemImage: "mic.fill")
                .font(.subheadline)
            Label("\"告诉\(displayName)让 wiki 跑测试\" 一句直达", systemImage: "bolt.fill")
                .font(.subheadline)
            Label("听到\"批准吗?\" → \"告诉\(displayName)批准\"", systemImage: "checkmark.circle.fill")
                .font(.subheadline)
            SiriTipView(intent: SendCommandIntent())
            ShortcutsLink()
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 14))
    }

    // ── 开发者工具(折叠) ──
    private var devTools: some View {
        DisclosureGroup("开发者工具") {
            VStack(spacing: 10) {
                Button {
                    UIPasteboard.general.string = token
                } label: {
                    Label("复制 APNs token", systemImage: "doc.on.doc").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                Button {
                    scheduleTest("wiki", "测试跑完了，三个全部通过", after: 10)
                    scheduled = "已排 1 条,10 秒后到 → 锁屏听"
                } label: {
                    Label("10 秒后发本地测试通知", systemImage: "bell.badge").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                Button {
                    let lines = ["开始干活了", "正在改文件", "改文件完成", "正在跑命令", "任务完成。修好了"]
                    for (i, line) in lines.enumerated() {
                        scheduleTest("wiki", line, after: TimeInterval(10 + i * 4))
                    }
                    scheduled = "已排 5 条(每 4 秒)→ 锁屏听"
                } label: {
                    Label("连发 5 条(测节流)", systemImage: "bell.and.waves.left.and.right").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                if !scheduled.isEmpty {
                    Text(scheduled).font(.caption).foregroundStyle(.orange)
                }
                Text(token).font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary).textSelection(.enabled)
            }
            .padding(.top, 8)
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 14))
    }

    // ── 动作 ──
    private func sendToMac() {
        sendResult = "发送中…"
        let text = command
        Task {
            var req = URLRequest(url: URL(string: EarpieceConfig.endpoint)!)
            req.httpMethod = "POST"
            req.timeoutInterval = 8
            req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONEncoder().encode(["text": text])
            do {
                let (_, resp) = try await URLSession.shared.data(for: req)
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                sendResult = code == 202 ? "✅ 电脑已接单,听播报吧" : "❌ 电脑回了 \(code)"
                if code == 202 { command = "" }
            } catch {
                sendResult = "❌ 联不上:\(error.localizedDescription)"
            }
            await refreshStatus()
        }
    }

    private func refreshStatus() async {
        let url = EarpieceConfig.endpoint.replacingOccurrences(of: "/command", with: "/status")
        var req = URLRequest(url: URL(string: url)!)
        req.timeoutInterval = 4
        req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            status = DaemonStatus()
            return
        }
        if json["relay"] != nil {
            // 公网 relay 格式:macAgeSec = 电脑上次取信距今秒数,<35 算在线
            let age = json["macAgeSec"] as? Int
            status = DaemonStatus(reachable: age != nil && age! < 35, running: nil, queued: 0, pendingApprovals: 0)
        } else {
            status = DaemonStatus(
                reachable: true,
                running: json["running"] as? String,
                queued: json["queued"] as? Int ?? 0,
                pendingApprovals: json["pendingApprovals"] as? Int ?? 0
            )
        }
    }

    private func submitRename(_ target: RegEntry, to alias: String) {
        let name = alias.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        if registry.contains(where: { $0.name == name && $0.id != target.id }) {
            sendResult = "❌「\(name)」已被占用,换一个"
            return
        }
        Task {
            let base = EarpieceConfig.endpoint.replacingOccurrences(of: "/command", with: "")
            var req = URLRequest(url: URL(string: "\(base)/alias")!)
            req.httpMethod = "POST"
            req.timeoutInterval = 8
            req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["alias": name, "cwd": target.cwd, "agent": target.agent])
            _ = try? await URLSession.shared.data(for: req)
            try? await Task.sleep(nanoseconds: 2_000_000_000) // 等电脑改完重报注册表
            await refreshRegistry()
        }
    }

    private func refreshRegistry() async {
        let base = EarpieceConfig.endpoint.replacingOccurrences(of: "/command", with: "")
        guard let url = URL(string: "\(base)/registry") else { return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 6
        req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
        registry = arr.compactMap { o in
            guard let name = o["name"] as? String, let cwd = o["cwd"] as? String,
                  let agent = o["agent"] as? String else { return nil }
            return RegEntry(name: name, cwd: cwd, agent: agent,
                            base: o["base"] as? String ?? "",
                            needsRename: o["needsRename"] as? Bool ?? false)
        }
    }

    private func refreshProjects() async {
        let base = EarpieceConfig.endpoint.replacingOccurrences(of: "/command", with: "")
        guard let url = URL(string: "\(base)/projects") else { return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 6
        req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
        chatProjects = arr.compactMap { o in
            guard let name = o["name"] as? String else { return nil }
            return (name: name, last: o["last"] as? String ?? "")
        }
    }

    private func scheduleTest(_ title: String, _ body: String, after seconds: TimeInterval) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: trigger))
    }
}
