import SwiftUI

// 字幕回放:一个项目的时间线(你的指令/小易播报/批准事件)+ 底部继续发指令。
// 完整对话在电脑上(claude --resume),这里是"通话记录",不是聊天软件。

struct ChatLine: Identifiable, Equatable {
    let id: Int
    let role: String // user | assistant | event
    let text: String
    let ts: Double
}

struct ChatView: View {
    let project: String

    @State private var lines: [ChatLine] = []
    @State private var draft = ""
    @State private var sendResult = ""
    @StateObject private var speech = SpeechInput()
    @EnvironmentObject private var bus: RefreshBus  // Tab 栏刷新按钮
    private let pollTimer = Timer.publish(every: 4, on: .main, in: .common).autoconnect()

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
                    Text("🎙 \"嘿 Siri,告诉小易\" → \"\(project) + 要做的事\"")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
        }
        .task { await refresh() }
        .onReceive(pollTimer) { _ in Task { await refresh() } }
        .onAppear { bus.activeChat = project }
        .onDisappear { if bus.activeChat == project { bus.activeChat = nil } }
        .onChange(of: bus.tick) { _ in
            guard bus.activeChat == project else { return }  // 只有自己在前台才响应
            Task { bus.spinning = true; await refresh(); bus.spinning = false }
        }
        .onChange(of: speech.recording) { rec in
            if !rec {
                let said = speech.transcript.trimmingCharacters(in: .whitespaces)
                if !said.isEmpty { draft = said; send() }
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

    private func refresh() async {
        let base = EarpieceConfig.endpoint.replacingOccurrences(of: "/command", with: "")
        guard let url = URL(string: "\(base)/history?project=\(project.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? project)") else { return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 6
        req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
        lines = arr.enumerated().map { i, o in
            ChatLine(id: i, role: o["role"] as? String ?? "assistant",
                     text: o["text"] as? String ?? "", ts: o["ts"] as? Double ?? 0)
        }
    }
}
