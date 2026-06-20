import SwiftUI
import UIKit

// 字幕回放:一个项目的时间线(你的指令/答鸭播报/批准事件)+ 底部继续发指令。
// 完整对话在电脑上(claude --resume),这里是"通话记录",不是聊天软件。

struct ChatLine: Identifiable, Equatable {
    let id: Int
    let role: String // user | assistant | event
    let text: String
    let ts: Double
    var src: String? = nil // "seed"=电脑回填(不念);nil/其他=实时播报
    var statsTokens: Int? = nil
    var statsDurationMs: Int? = nil
}

// 时间戳格式化:今天只显示 HH:mm;不是今天显示 月/日 HH:mm —— 让你一眼看出是不是昨天的。
enum TS {
    static func label(_ ms: Double) -> String {
        guard ms > 0 else { return "" }
        let date = Date(timeIntervalSince1970: ms / 1000)
        let hm = DateFormatter()
        hm.locale = .current
        hm.dateFormat = "HH:mm"
        if Calendar.current.isDateInToday(date) {
            return hm.string(from: date)
        }
        if Calendar.current.isDateInYesterday(date) {
            return NSLocalizedString("昨天", comment: "") + " " + hm.string(from: date)
        }
        let f = DateFormatter()
        f.locale = .current
        f.setLocalizedDateFormatFromTemplate("MdHm")
        return f.string(from: date)
    }
}

struct ChatView: View {
    let entry: RegEntry
    private var project: String { entry.name }

    @State private var lines: [ChatLine] = []
    @State private var pending: [PendingApproval] = []   // 本项目的待批准(详情/横幅都看得到)
    @State private var showDetail = false                 // 右上角详情面板
    @State private var draft = ""
    @State private var sendResult = ""
    @StateObject private var speech = SpeechInput()
    @EnvironmentObject private var bus: RefreshBus  // Tab 栏刷新按钮

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 10) {
                        // 待批准横幅已上移到 ContentView 全局悬浮层(任何页面都弹);详情面板里仍列本项目待批准
                        ForEach(lines) { line in
                            bubble(line)
                        }
                    }
                    .padding()
                }
                .onChange(of: lines) { _ in
                    if let last = lines.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            inputBar
        }
        .navigationBarTitleDisplayMode(.inline)
        // 标题下带 Siri 召唤语提示(总忘记怎么说):照着念就能锁屏驱动这个项目
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    HStack(spacing: 5) {
                        if entry.live { Circle().fill(.green).frame(width: 7, height: 7) }
                        Text(project).font(.headline)
                    }
                    Text("🎙 \"嘿 Siri,告诉答鸭\" → \"\(project) + 要做的事\"")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            // 右上角:详情按钮 —— 路径 / 进程 / 引擎 / 会话 / 最后活跃
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showDetail = true } label: { Image(systemName: "info.circle") }
            }
        }
        .sheet(isPresented: $showDetail) { DetailSheet(entry: entry, pending: pending) }
        // 绑定视图生命周期的轮询循环:每 2 秒拉一次,停在页面里也实时更新(不用退出重进)。
        // 旧的 Timer.publish 会因视图重建被反复重置、计时到不了,所以之前不自动刷新。
        .task {
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
        .onAppear { bus.activeChat = project }
        .onDisappear { if bus.activeChat == project { bus.activeChat = nil } }
        .onChange(of: bus.tick) { _ in
            guard bus.activeChat == project else { return }  // 只有自己在前台才响应
            Task { bus.spinning = true; await forceSync(); bus.spinning = false }  // 手动刷新=强制同步
        }
        .onChange(of: speech.recording) { rec in
            if !rec {
                let said = speech.transcript.trimmingCharacters(in: .whitespaces)
                // App 里语音:只把文字填进输入框,等你点发送确认(不自动发)。
                // 眼睛不在屏幕的 Siri / 耳机模式走 SendCommandIntent,那条本就直接发。
                if !said.isEmpty { draft = said }
            }
        }
    }

    // 待批准横幅:橙色,可批/拒;点进会话也能处理(不必退回主页)
    private func approvalBanner(_ p: PendingApproval) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("\(p.summary),等你批准", systemImage: "bell.fill")
                    .font(.footnote).bold().foregroundStyle(.orange)
                Spacer()
                if !TS.label(p.ts).isEmpty {
                    Text(TS.label(p.ts)).font(.caption2).foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 10) {
                Button { respond(p, approve: true) } label: {
                    Text("批准").font(.footnote).frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent)
                Button(role: .destructive) { respond(p, approve: false) } label: {
                    Text("拒绝").font(.footnote).frame(maxWidth: .infinity)
                }.buttonStyle(.bordered)
            }
        }
        .padding(12)
        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private func bubble(_ line: ChatLine) -> some View {
        let stamp = TS.label(line.ts)
        switch line.role {
        case "user":
            HStack {
                Spacer(minLength: 48)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(line.text)
                        .padding(10)
                        .background(Color.accentColor.opacity(0.9), in: RoundedRectangle(cornerRadius: 14))
                        .foregroundStyle(.white)
                    if !stamp.isEmpty { Text(stamp).font(.caption2).foregroundStyle(.tertiary) }
                }
            }.id(line.id)
        case "event":
            VStack(spacing: 2) {
                Text(line.text)
                    .font(.caption)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(Color(.tertiarySystemFill), in: Capsule())
                if !stamp.isEmpty { Text(stamp).font(.caption2).foregroundStyle(.tertiary) }
            }
            .frame(maxWidth: .infinity)
            .id(line.id)
        default:
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(line.text)
                        .padding(10)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
                    if !stamp.isEmpty { Text(stamp).font(.caption2).foregroundStyle(.tertiary) }
                    if let ms = line.statsDurationMs {
                        let secs = max(1, ms / 1000)
                        let tok = line.statsTokens.map { " · \($0) tokens" } ?? ""
                        Text("\(secs) 秒\(tok)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 48)
            }.id(line.id)
        }
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField("继续吩咐 \(project)…", text: $draft)
                .textFieldStyle(.roundedBorder)
            Button {
                speech.toggle()
            } label: {
                Image(systemName: speech.recording ? "stop.fill" : "mic.fill")
                    .foregroundStyle(speech.recording ? .red : .accentColor)
            }
            Button { send() } label: { Image(systemName: "paperplane.fill") }
                .buttonStyle(.borderedProminent)
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(10)
        .background(.bar)
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        draft = ""
        Task {
            var req = URLRequest(url: URL(string: EarpieceConfig.endpoint)!)
            req.httpMethod = "POST"
            req.timeoutInterval = 8
            req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            // 指令永远带项目名前缀,落到这个项目的会话链
            req.httpBody = try? JSONEncoder().encode(["text": "\(project) \(text)"])
            _ = try? await URLSession.shared.data(for: req)
            await refresh()
        }
    }

    private func respond(_ p: PendingApproval, approve: Bool) {
        pending.removeAll { $0.id == p.id }   // 乐观移除
        Task {
            _ = try? await URLSession.shared.data(for: API.request("/approval/respond", method: "POST", body: ["id": p.id, "approve": approve]))
            await refresh()
        }
    }

    // 强制同步:先发 /resync 戳电脑重扫重推这个项目,稍等一下再拉——治「连中继都落后」。
    private func forceSync() async {
        let base = EarpieceConfig.endpoint.replacingOccurrences(of: "/command", with: "")
        if let url = URL(string: "\(base)/resync") {
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.timeoutInterval = 6
            req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["project": project])
            _ = try? await URLSession.shared.data(for: req)
        }
        try? await Task.sleep(nanoseconds: 700_000_000)  // 给电脑重扫+重推一点时间
        await refresh()
    }

    private func refresh() async {
        // 顺带拉本项目的待批准(从聚合 /status 里筛出 project == 自己的)
        if let json = await API.json("/status") as? [String: Any] {
            pending = (json["pending"] as? [[String: Any]] ?? []).compactMap { o in
                guard let id = o["id"] as? String, (o["project"] as? String) == project else { return nil }
                return PendingApproval(id: id, project: project, summary: o["summary"] as? String ?? "",
                                       ts: o["ts"] as? Double ?? 0)
            }
        }
        let base = EarpieceConfig.endpoint.replacingOccurrences(of: "/command", with: "")
        guard let url = URL(string: "\(base)/history?project=\(project.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? project)") else { return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 6
        req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
        // relay 按"插入顺序"返回(seed 段在前、live 行在后),不是时间序。
        // 必须按 ts 排,否则最新的回填内容会被压在旧 live 行上面,看着像"卡住没更新"。
        let sorted = arr.map { o in
            let stats = o["stats"] as? [String: Any]
            return ChatLine(id: 0, role: o["role"] as? String ?? "assistant",
                     text: o["text"] as? String ?? "", ts: o["ts"] as? Double ?? 0,
                     src: o["src"] as? String,
                     statsTokens: stats?["tokens"] as? Int,
                     statsDurationMs: stats?["durationMs"] as? Int)
        }
        .sorted { $0.ts < $1.ts }
        .enumerated().map { i, l in ChatLine(id: i, role: l.role, text: l.text, ts: l.ts, src: l.src, statsTokens: l.statsTokens, statsDurationMs: l.statsDurationMs) }
        lines = sorted
        // 播报由 BroadcastService 统一轮询订阅项目来念(前台+后台),这里不再单独念。
    }
}

// 详情面板:路径 / 进程 / 引擎 / 机器 / 会话句柄 / 最后活跃 —— 让你分清是哪个线程。
private struct DetailSheet: View {
    let entry: RegEntry
    let pending: [PendingApproval]
    @Environment(\.dismiss) private var dismiss

    private var engineName: String {
        entry.agent == "claude" ? "Claude Code" : entry.agent == "codex" ? "Codex" : "Hermes"
    }
    private func lastActiveLabel() -> String {
        entry.lastActive > 0 ? TS.label(entry.lastActive) : NSLocalizedString("未知", comment: "")
    }

    var body: some View {
        NavigationStack {
            List {
                Section(NSLocalizedString("身份", comment: "")) {
                    row(NSLocalizedString("名字", comment: ""), entry.name)
                    row(NSLocalizedString("引擎", comment: ""), engineName)
                    row(NSLocalizedString("机器", comment: ""), entry.machine)
                    HStack {
                        Text(NSLocalizedString("状态", comment: "")).foregroundStyle(.secondary)
                        Spacer()
                        if entry.live {
                            Label(entry.status ?? "live", systemImage: "circle.fill")
                                .font(.footnote).foregroundStyle(.green).labelStyle(.titleAndIcon)
                        } else {
                            Text(NSLocalizedString("无活动窗口", comment: "")).foregroundStyle(.secondary)
                        }
                    }
                }
                Section(NSLocalizedString("进程", comment: "")) {
                    copyRow(NSLocalizedString("路径", comment: ""), entry.cwd)
                    if let pid = entry.pid { row("PID", String(pid)) }
                    if let sid = entry.sessionId, !sid.isEmpty { copyRow("Session", sid) }
                    row(NSLocalizedString("最后活跃", comment: ""), lastActiveLabel())
                }
                if !pending.isEmpty {
                    Section(NSLocalizedString("待批准", comment: "")) {
                        ForEach(pending) { p in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.summary).font(.footnote)
                                if !TS.label(p.ts).isEmpty {
                                    Text(TS.label(p.ts)).font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle(NSLocalizedString("详情", comment: ""))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(NSLocalizedString("完成", comment: "")) { dismiss() }
                }
            }
        }
    }

    private func row(_ k: String, _ v: String) -> some View {
        HStack { Text(k).foregroundStyle(.secondary); Spacer(); Text(v).multilineTextAlignment(.trailing) }
    }
    // 路径/Session 可选中复制(太长,方便贴到电脑)
    private func copyRow(_ k: String, _ v: String) -> some View {
        HStack(alignment: .top) {
            Text(k).foregroundStyle(.secondary)
            Spacer()
            Text(v).font(.footnote.monospaced()).multilineTextAlignment(.trailing).textSelection(.enabled)
        }
        .contextMenu { Button { UIPasteboard.general.string = v } label: { Label(NSLocalizedString("拷贝", comment: ""), systemImage: "doc.on.doc") } }
    }
}
