import SwiftUI

// 字幕回放:一个项目的时间线(你的指令/答鸭播报/批准事件)+ 底部继续发指令。
// 完整对话在电脑上(claude --resume),这里是"通话记录",不是聊天软件。

struct ChatLine: Identifiable, Equatable {
    let id: Int
    let role: String // user | assistant | event
    let text: String
    let ts: Double
    var src: String? = nil // "seed"=电脑回填(不念);nil/其他=实时播报
}

struct ChatView: View {
    let project: String

    @State private var lines: [ChatLine] = []
    @State private var draft = ""
    @State private var sendResult = ""
    @StateObject private var speech = SpeechInput()
    @EnvironmentObject private var bus: RefreshBus  // Tab 栏刷新按钮

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 10) {
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
                    Text(project).font(.headline)
                    Text("🎙 \"嘿 Siri,告诉答鸭\" → \"\(project) + 要做的事\"")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
        }
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

    @ViewBuilder
    private func bubble(_ line: ChatLine) -> some View {
        switch line.role {
        case "user":
            HStack {
                Spacer(minLength: 48)
                Text(line.text)
                    .padding(10)
                    .background(Color.accentColor.opacity(0.9), in: RoundedRectangle(cornerRadius: 14))
                    .foregroundStyle(.white)
            }.id(line.id)
        case "event":
            Text(line.text)
                .font(.caption)
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(Color(.tertiarySystemFill), in: Capsule())
                .id(line.id)
        default:
            HStack {
                Text(line.text)
                    .padding(10)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
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
            ChatLine(id: 0, role: o["role"] as? String ?? "assistant",
                     text: o["text"] as? String ?? "", ts: o["ts"] as? Double ?? 0,
                     src: o["src"] as? String)
        }
        .sorted { $0.ts < $1.ts }
        .enumerated().map { i, l in ChatLine(id: i, role: l.role, text: l.text, ts: l.ts, src: l.src) }
        lines = sorted
        // 播报由 BroadcastService 统一轮询订阅项目来念(前台+后台),这里不再单独念。
    }
}
