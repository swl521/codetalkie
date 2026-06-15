import SwiftUI
import UserNotifications
import AppIntents
import AVFoundation
import UIKit

struct PendingApproval: Identifiable, Equatable {
    let id: String
    let project: String
    let summary: String
}

struct DaemonStatus: Equatable {
    var reachable = false
    var running: String?
    var queued = 0
    var pending: [PendingApproval] = []
}

// 电脑上扫出来的现成项目(只读;唯一可改的是叫法)
struct RegEntry: Identifiable, Equatable {
    // name 入 id:hermes 多个会话共用同一 cwd(~/.hermes),只用 agent@cwd 会三条同 id,
    // SwiftUI ForEach 把第一条渲染三遍。注册表保证 name 唯一(撞名会 needsRename),用它去重。
    var id: String { "\(agent)@\(cwd)@\(name)" }
    let name: String
    let cwd: String
    let agent: String   // claude | codex | hermes
    let base: String
    let machine: String // 项目所在电脑(Mac / Win …)
    let needsRename: Bool
}

enum API {
    static var base: String { EarpieceConfig.endpoint.replacingOccurrences(of: "/command", with: "") }

    static func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) -> URLRequest {
        var req = URLRequest(url: URL(string: "\(base)\(path)")!)
        req.httpMethod = method
        req.timeoutInterval = 8
        req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return req
    }

    // 读请求轮询多中继:试通哪个就把它钉为 activeIndex,后续 base/endpoint(发指令、批准、
    // 改名、字幕、Siri)全跟着走 —— 主中继挂了(如配额爆),下一拍心跳自动切到备用,用户无感。
    static func json(_ path: String) async -> Any? {
        let hs = EarpieceConfig.hosts
        for (i, h) in hs.enumerated() {
            var req = URLRequest(url: URL(string: "\(h)\(path)")!)
            req.timeoutInterval = 8
            req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
            if let (data, resp) = try? await URLSession.shared.data(for: req),
               (resp as? HTTPURLResponse)?.statusCode == 200 {
                EarpieceConfig.activeIndex = i
                return try? JSONSerialization.jsonObject(with: data)
            }
        }
        return nil
    }
}

// 全局刷新总线:Tab 栏右侧的刷新按钮拨一下 tick,各页面监听后自己拉数据。
// activeChat 记录当前打开的对话页:在对话页里只刷那个会话,在主页才全量刷新。
final class RefreshBus: ObservableObject {
    @Published var tick = 0
    @Published var spinning = false
    @Published var activeChat: String? = nil
}

// 订阅:opt-in,默认空(和 Android 一致)。只有选中的项目才自动同步预览 + 通知;
// 没选的不打扰,点进去才拉。持久化到 UserDefaults。
final class SubsStore: ObservableObject {
    @Published private(set) var subscribed: Set<String>
    private let key = "iosSubscribedProjects"

    init() {
        subscribed = Set(UserDefaults.standard.stringArray(forKey: "iosSubscribedProjects") ?? [])
    }
    func contains(_ name: String) -> Bool { subscribed.contains(name) }
    func toggle(_ name: String) {
        if subscribed.contains(name) { subscribed.remove(name) } else { subscribed.insert(name) }
        UserDefaults.standard.set(Array(subscribed), forKey: key)
    }
}

struct ContentView: View {
    @StateObject private var bus = RefreshBus()
    @StateObject private var store = Store()
    @StateObject private var subs = SubsStore()
    @State private var tab = 0

    var body: some View {
        VStack(spacing: 0) {
            // ZStack 保活两个页面(切走不销毁,轮询继续)
            ZStack {
                HomeView().opacity(tab == 0 ? 1 : 0).allowsHitTesting(tab == 0)
                SettingsView().opacity(tab == 1 ? 1 : 0).allowsHitTesting(tab == 1)
            }
            navigationBar
        }
        .environmentObject(bus)
        .environmentObject(store)
        .environmentObject(subs)
        .onAppear { BroadcastService.shared.startForeground() }  // 启动播报轮询(前台;耳机模式开则后台也念)
        .sheet(isPresented: $store.showPaywall) {
            PaywallView().environmentObject(store)
        }
    }

    // Material 3 Navigation Bar(design.google):三项均分、选中项胶囊高亮、图标上文字下
    private var navigationBar: some View {
        HStack(spacing: 0) {
            navItem(icon: "house.fill", label: String(localized: "主页"), selected: tab == 0) { tab = 0 }
            navItem(icon: "gearshape.fill", label: String(localized: "设置"), selected: tab == 1) { tab = 1 }
            navItem(icon: "arrow.clockwise", label: String(localized: "刷新"), selected: false, spinning: bus.spinning) { bus.tick += 1 }
        }
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    private func navItem(icon: String, label: String, selected: Bool,
                         spinning: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                ZStack {
                    // M3 active indicator:选中项图标垫一个胶囊
                    Capsule()
                        .fill(selected ? Color.accentColor.opacity(0.16) : .clear)
                        .frame(width: 56, height: 30)
                    Image(systemName: icon)
                        .font(.system(size: 17, weight: .medium))
                        .rotationEffect(.degrees(spinning ? 360 : 0))
                        .animation(spinning ? .linear(duration: 0.8).repeatForever(autoreverses: false) : .default, value: spinning)
                }
                Text(label)
                    .font(.system(size: 11, weight: selected ? .semibold : .regular))
            }
            .foregroundStyle(selected || spinning ? Color.accentColor : Color(.secondaryLabel))
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// ── 主页:状态行 + 待批准横幅 + 大麦克风 + 项目列表 ──

struct HomeView: View {
    @AppStorage("assistantName") private var assistantName = ""
    @AppStorage("didAskName") private var didAskName = false  // 只在装好后第一次运行问名字
    @State private var nameDraft = ""
    @State private var naming = false

    @State private var status = DaemonStatus()
    @State private var registry: [RegEntry] = []
    @State private var lastLines: [String: String] = [:]
    @State private var renameTarget: RegEntry?
    @State private var renameDraft = ""
    @State private var toast = ""
    @State private var collapsed: Set<String> = []  // 折叠起来的引擎分组(claude/codex/hermes)
    @EnvironmentObject private var bus: RefreshBus  // Tab 栏刷新按钮
    @EnvironmentObject private var subs: SubsStore  // 项目订阅(选择框)

    @StateObject private var speech = SpeechInput()
    @State private var micTarget: String? = nil  // 正在按住录音的目标项目;nil=主页大麦克风(需自己报项目名)
    private let pollTimer = Timer.publish(every: 5, on: .main, in: .common).autoconnect()

    private var displayName: String { assistantName.isEmpty ? String(localized: "答鸭") : assistantName }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    statusLine
                    ForEach(status.pending) { approvalBanner($0) }
                    micButton
                    if speech.recording, let t = micTarget {
                        Text("🎙️ 对「\(t)」说:\(speech.transcript.isEmpty ? "在听…松手即发" : speech.transcript)")
                            .font(.caption).foregroundStyle(.primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 4)
                    }
                    if !toast.isEmpty { Text(toast).font(.caption).foregroundStyle(.secondary) }
                    projectsCard
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(displayName)
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            EarpieceShortcuts.updateAppShortcutParameters()
            if !didAskName { naming = true; didAskName = true }  // 仅装好后第一次运行问名字
            await refreshAll()
        }
        .onReceive(pollTimer) { _ in Task { await refreshAll() } }
        .onChange(of: bus.tick) { _ in
            guard bus.activeChat == nil else { return }  // 对话页开着时由对话页自己刷
            Task { bus.spinning = true; await refreshAll(); bus.spinning = false }
        }
        .onChange(of: speech.recording) { rec in
            if !rec {
                let said = speech.transcript.trimmingCharacters(in: .whitespaces)
                let target = micTarget
                micTarget = nil
                if !said.isEmpty {
                    if let target { send("\(target) \(said)") }  // 行内麦克风:带项目名前缀,直落该线程
                    else { send(said) }                          // 大麦克风:用户自己报项目名
                }
            }
        }
        .alert("给你的助手起个名字", isPresented: $naming) {
            TextField("比如:答鸭", text: $nameDraft)
            Button("就叫这个") {
                let n = nameDraft.trimmingCharacters(in: .whitespaces)
                if !n.isEmpty { assistantName = n }
            }
        } message: {
            Text("名字用在 App 里。Siri 召唤语见设置页。")
        }
        .alert("给它起个顺口的名字", isPresented: Binding(get: { renameTarget != nil }, set: { if !$0 { renameTarget = nil } })) {
            TextField("比如:维基", text: $renameDraft)
            Button("保存") { if let t = renameTarget { submitRename(t, to: renameDraft) } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("名字要全局唯一,以后说\"新名字 + 要做的事\"")
        }
    }

    private var statusLine: some View {
        HStack(spacing: 8) {
            Circle().fill(status.reachable ? .green : .red).frame(width: 9, height: 9)
            Text(status.reachable
                 ? (status.running == nil ? String(localized: "电脑在线 · 空闲") : String(localized: "正在干:\(status.running!)") + (status.queued > 0 ? String(localized: " · 排队 \(status.queued)") : ""))
                 : String(localized: "联不上电脑"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, 4)
    }

    private func approvalBanner(_ p: PendingApproval) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("\(p.project):\(p.summary),等你批准", systemImage: "bell.fill")
                .font(.footnote).bold()
                .foregroundStyle(.orange)
            HStack(spacing: 10) {
                Button {
                    respond(p, approve: true)
                } label: { Text("批准").font(.footnote).frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent)
                Button(role: .destructive) {
                    respond(p, approve: false)
                } label: { Text("拒绝").font(.footnote).frame(maxWidth: .infinity) }
                .buttonStyle(.bordered)
            }
        }
        .padding(12)
        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }

    private var micButton: some View {
        VStack(spacing: 8) {
            Button {
                if !speech.recording { micTarget = nil }  // 大麦克风走全局路径(无项目前缀)
                speech.toggle()
            } label: {
                ZStack {
                    Circle()
                        .fill(speech.recording
                              ? AnyShapeStyle(Color.red)
                              : AnyShapeStyle(LinearGradient(colors: [Color(red: 0.07, green: 0.32, blue: 0.92), Color(red: 0.02, green: 0.78, blue: 0.72)],
                                                             startPoint: .topLeading, endPoint: .bottomTrailing)))
                        .frame(width: 96, height: 96)
                        .shadow(color: (speech.recording ? Color.red : Color.blue).opacity(0.3), radius: 12, y: 5)
                    Image(systemName: speech.recording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 38, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
            .scaleEffect(speech.recording ? 1.07 : 1.0)
            .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: speech.recording)

            Text(speech.recording
                 ? (speech.transcript.isEmpty ? String(localized: "在听…说吧") : speech.transcript)
                 : String(localized: "点一下,说\"项目名 + 要做的事\""))
                .font(.caption)
                .foregroundStyle(speech.recording ? .primary : .secondary)
                .multilineTextAlignment(.center)
            if speech.denied {
                Text("麦克风/语音识别权限被拒,去 设置 打开").font(.caption2).foregroundStyle(.red)
            }
        }
        .padding(.vertical, 6)
    }

    // 两级分组:引擎(Claude/Codex)→ 机器(Mac/Win…)
    private var projectsCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            if registry.isEmpty {
                Text("正在从电脑读取项目…").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(["claude", "codex", "hermes"], id: \.self) { agent in
                let group = registry.filter { $0.agent == agent }
                if !group.isEmpty {
                    let accent: Color = agent == "claude" ? .orange : agent == "codex" ? .green : .purple
                    let label = agent == "claude" ? "Claude" : agent == "codex" ? "Codex" : "Hermes"
                    let isCollapsed = collapsed.contains(agent)
                    // 引擎标题:整行可点,折叠/展开这一组
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            if isCollapsed { collapsed.remove(agent) } else { collapsed.insert(agent) }
                        }
                    } label: {
                        HStack {
                            Text("\(label) · \(group.count)").font(.subheadline).bold()
                                .padding(.horizontal, 10).padding(.vertical, 3)
                                .background(accent.opacity(0.15), in: Capsule())
                                .foregroundStyle(accent)
                            Spacer()
                            Image(systemName: "chevron.down")
                                .font(.caption).bold()
                                .foregroundStyle(.secondary)
                                .rotationEffect(.degrees(isCollapsed ? -90 : 0))
                        }
                        .contentShape(Rectangle())   // 整行都能点
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 8)
                    if !isCollapsed {
                        // 机器子分组(单机时省掉子标题,免得多余)
                        let machines = Array(Set(group.map { $0.machine })).sorted()
                        ForEach(machines, id: \.self) { m in
                            if machines.count > 1 {
                                Label(m, systemImage: "desktopcomputer")
                                    .font(.caption).foregroundStyle(.secondary)
                                    .padding(.leading, 4).padding(.top, 2)
                            }
                            ForEach(group.filter { $0.machine == m }) { e in
                                projectRow(e)
                            }
                        }
                    }
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 14))
    }

    private func projectRow(_ e: RegEntry) -> some View {
        HStack(spacing: 4) {
            // 选择框:勾上才自动同步预览 + 通知;不勾的点进去才拉
            Button { subs.toggle(e.name) } label: {
                Image(systemName: subs.contains(e.name) ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(subs.contains(e.name) ? Color.accentColor : Color(.tertiaryLabel))
            }
            .buttonStyle(.plain)
            NavigationLink(destination: ChatView(project: e.name)) {
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(e.name).font(.subheadline).bold()
                            .foregroundStyle(e.needsRename ? .orange : .primary)
                        Text(e.needsRename ? "重名了,长按改个名" : (lastLines[e.name] ?? e.base))
                            .font(.caption)
                            .foregroundStyle(e.needsRename ? .orange : .secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                }
                .padding(.vertical, 5)
                .padding(.leading, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .contextMenu {
                Button { renameTarget = e; renameDraft = e.name } label: {
                    Label("改叫法", systemImage: "pencil")
                }
                Text("\(e.machine) · \(e.cwd)")
            }
            rowMic(e)
        }
    }

    // 行内小麦克风:按住说话,松手直接发到这个项目(不用进线程页)
    private func rowMic(_ e: RegEntry) -> some View {
        let active = speech.recording && micTarget == e.name
        return Image(systemName: active ? "stop.circle.fill" : "mic.circle.fill")
            .font(.title2)
            .foregroundStyle(active ? .red : .accentColor)
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .contentShape(Circle())
            .scaleEffect(active ? 1.18 : 1)
            .animation(.easeInOut(duration: 0.15), value: active)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !speech.recording else { return }
                        micTarget = e.name
                        speech.start()
                    }
                    .onEnded { _ in
                        guard micTarget == e.name else { return }
                        speech.stop()
                    }
            )
    }

    // ── 动作 ──

    private func send(_ text: String) {
        toast = String(localized: "发送中…")
        Task {
            let req = API.request("/command", method: "POST", body: ["text": text])
            let ok = (try? await URLSession.shared.data(for: req)) != nil
            toast = ok ? String(localized: "✅ 电脑已接单") : String(localized: "❌ 发送失败")
            await refreshAll()
        }
    }

    private func respond(_ p: PendingApproval, approve: Bool) {
        status.pending.removeAll { $0.id == p.id } // 乐观移除
        Task {
            _ = try? await URLSession.shared.data(for: API.request("/approval/respond", method: "POST", body: ["id": p.id, "approve": approve]))
        }
    }

    private func submitRename(_ target: RegEntry, to alias: String) {
        let name = alias.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        if registry.contains(where: { $0.name == name && $0.id != target.id }) {
            toast = String(localized: "❌「\(name)」已被占用,换一个")
            return
        }
        Task {
            _ = try? await URLSession.shared.data(for: API.request("/alias", method: "POST", body: ["alias": name, "cwd": target.cwd, "agent": target.agent]))
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            await refreshAll()
        }
    }

    private func refreshAll() async {
        if let json = await API.json("/status") as? [String: Any] {
            let age = json["macAgeSec"] as? Int
            var s = DaemonStatus(reachable: age != nil && age! < 35)
            s.running = json["running"] as? String
            s.queued = json["queued"] as? Int ?? 0
            s.pending = (json["pending"] as? [[String: Any]] ?? []).compactMap { o in
                guard let id = o["id"] as? String else { return nil }
                return PendingApproval(id: id, project: o["project"] as? String ?? "", summary: o["summary"] as? String ?? "")
            }
            status = s
        } else {
            status = DaemonStatus()
        }
        if let arr = await API.json("/registry") as? [[String: Any]] {
            registry = arr.compactMap { o in
                guard let name = o["name"] as? String, let cwd = o["cwd"] as? String,
                      let agent = o["agent"] as? String else { return nil }
                return RegEntry(name: name, cwd: cwd, agent: agent,
                                base: o["base"] as? String ?? "",
                                machine: o["machine"] as? String ?? "?",
                                needsRename: o["needsRename"] as? Bool ?? false)
            }
        }
        if let arr = await API.json("/projects") as? [[String: Any]] {
            for o in arr {
                // 只自动更新订阅项目的预览;没订阅的不打扰(点进去由对话页自己拉)
                if let n = o["name"] as? String, subs.contains(n) { lastLines[n] = o["last"] as? String ?? "" }
            }
        }
    }
}

// ── 设置页:播报级别 + 名字 + 连接 + Siri + 开发者 ──

struct SettingsView: View {
    @AppStorage("assistantName") private var assistantName = ""
    @AppStorage("announceLevel") private var announceLevel = 3.0
    @AppStorage("earpieceBackground") private var earpieceBackground = false  // 耳机模式:锁屏/后台也念
    @AppStorage("connMode") private var connMode = "relay"   // relay 公网 | lan 局域网
    @AppStorage("lanIP") private var lanIP = ""
    @AppStorage("speechLocale") private var speechLocale = ""  // 语音识别语言,空=系统语言
    @AppStorage("accountKey") private var accountKey = ""       // 绑定电脑后的账户密钥
    @State private var pairCode = ""
    @State private var showScanner = false
    @FocusState private var codeFocused: Bool

    // 二维码内容 codetalkie://pair?code=XXXXXX → 取 6 位码;也兼容直接是 6 位数字。
    static func codeFromQR(_ s: String) -> String? {
        if let r = s.range(of: "code=") {
            let c = String(s[r.upperBound...]).prefix(while: { $0.isNumber })
            if c.count == 6 { return String(c) }
        }
        let digits = s.filter(\.isNumber)
        return digits.count == 6 ? digits : nil
    }
    @State private var pairMsg = ""
    @State private var nameDraft = ""
    @State private var naming = false
    @State private var token = AppDelegate.deviceTokenString
    @State private var scheduled = ""
    @State private var connTest = ""
    @State private var discovering = false
    @EnvironmentObject private var store: Store

    private let levelNames = ["", "1 · 只报结果和批准", "2 · 加开工", "3 · 阶段汇报", "4 · 每步都报", "5 · 话痨"]

    // App 版本号(便于确认装的是第几版、更新到没)
    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "v\(v) (build \(b))"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("绑定电脑") {
                    if accountKey.isEmpty {
                        Text("在电脑上运行 答鸭,会显示一个 6 位配对码,输到这里绑定。")
                            .font(.caption).foregroundStyle(.secondary)
                        HStack {
                            TextField("6 位配对码", text: $pairCode)
                                .keyboardType(.numberPad)
                                .textFieldStyle(.roundedBorder)
                                .focused($codeFocused)
                            Button("绑定") { Task { await claim() } }
                                .buttonStyle(.borderedProminent)
                                .disabled(pairCode.trimmingCharacters(in: .whitespaces).count != 6)
                        }
                        Button { showScanner = true } label: {
                            Label("扫码绑定", systemImage: "qrcode.viewfinder")
                        }
                        .fullScreenCover(isPresented: $showScanner) {
                            ZStack(alignment: .top) {
                                QRScanner { scanned in
                                    showScanner = false
                                    if let code = Self.codeFromQR(scanned) {
                                        pairCode = code
                                        Task { await claim() }
                                    } else {
                                        pairMsg = String(localized: "二维码不对,换成手输 6 位码")
                                    }
                                }
                                .ignoresSafeArea()
                                HStack {
                                    Spacer()
                                    Button("取消") { showScanner = false }
                                        .padding(12).background(.ultraThinMaterial, in: Capsule()).padding()
                                }
                            }
                        }
                    } else {
                        HStack {
                            Label("已绑定", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                            Spacer()
                            Button("解绑", role: .destructive) { accountKey = ""; pairMsg = "" }
                        }
                    }
                    if !pairMsg.isEmpty { Text(pairMsg).font(.caption).foregroundStyle(pairMsg.hasPrefix("✅") ? .green : .red) }
                }
                Section("播报") {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("播报级别")
                            Spacer()
                            Text(levelNames[Int(announceLevel)]).font(.footnote).foregroundStyle(.blue)
                        }
                        Slider(value: $announceLevel, in: 1...5, step: 1) { editing in
                            if !editing { pushLevel() }
                        }
                        Text("「要批准」和「任务结束」任何级别都会播")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    Toggle("耳机模式(锁屏 / 后台也念)", isOn: $earpieceBackground)
                        .onChange(of: earpieceBackground) { on in BroadcastService.shared.setBackground(on) }
                    Text("开了揣兜里、锁屏也能把新播报念进耳机(更费电)。关了只在 App 打开时念。")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Section("助手") {
                    Button {
                        nameDraft = assistantName
                        naming = true
                    } label: {
                        HStack { Text("名字").foregroundStyle(.primary); Spacer(); Text(assistantName.isEmpty ? "答鸭" : assistantName).foregroundStyle(.secondary) }
                    }
                }
                Section("语音识别语言") {
                    TextField("如 zh-CN / en-US,留空=系统语言", text: $speechLocale)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                    Text("说话转文字用这个语言;电脑播报语言在电脑端 ~/.earpiece/settings.json 配 lang")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Section("会员") {
                    if store.isPro {
                        Label("Pro 已订阅 · 随时随地远程", systemImage: "crown.fill")
                            .foregroundStyle(.orange)
                    } else {
                        Button { store.showPaywall = true } label: {
                            HStack {
                                Label("升级 Pro", systemImage: "crown")
                                Spacer()
                                Text("\(store.priceText)/月").foregroundStyle(.secondary)
                            }
                        }
                        Text("免费版:和电脑同一 WiFi 时局域网直连。Pro:公网中继,出门用流量也能连。")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    Button("恢复购买") { Task { await store.restore() } }.font(.footnote)
                }
                Section("连接方式") {
                    Picker("连到电脑", selection: $connMode) {
                        Text(store.isPro ? "公网中继(任何网络)" : "公网中继 🔒 Pro").tag("relay")
                        Text("局域网(同 WiFi)").tag("lan")
                    }
                    .onChange(of: connMode) { mode in
                        if mode == "relay" && !store.isPro {
                            connMode = "lan"            // 免费版不能用公网中继:弹回局域网
                            store.showPaywall = true    // 顺手弹付费墙
                        } else if mode == "lan" && lanIP.isEmpty {
                            autoFindLAN()               // 切到局域网就自动找
                        }
                    }
                    if connMode == "lan" {
                        HStack {
                            Text(discovering ? "正在扫描同一 WiFi…" : (lanIP.isEmpty ? "还没找到电脑" : "电脑 \(lanIP)"))
                                .foregroundStyle(lanIP.isEmpty ? .secondary : .primary)
                            Spacer()
                            if discovering {
                                ProgressView()
                            } else {
                                Button("自动查找") { autoFindLAN() }
                            }
                        }
                    }
                    HStack {
                        Text("当前地址").foregroundStyle(.secondary)
                        Spacer()
                        Text(EarpieceConfig.base).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Button("测试连接") { testConn() }
                    if !connTest.isEmpty { Text(connTest).font(.caption).foregroundStyle(.secondary) }
                }
                Section("Siri 召唤语(锁屏可用)") {
                    Label("\"嘿 Siri,告诉\(assistantName.isEmpty ? "答鸭" : assistantName)\" → 再说指令", systemImage: "mic.fill").font(.footnote)
                    Label("\"告诉答鸭让 wiki 跑测试\" 一句直达", systemImage: "bolt.fill").font(.footnote)
                    Label("听到\"批准吗?\" → \"告诉答鸭批准\"", systemImage: "checkmark.circle.fill").font(.footnote)
                    SiriTipView(intent: SendCommandIntent())
                    ShortcutsLink()
                }
                Section("开发者") {
                    Button("复制 APNs token") { UIPasteboard.general.string = token }
                    Button("10 秒后发本地测试通知") {
                        scheduleTest("wiki", String(localized: "测试跑完了,三个全部通过"), after: 10)
                        scheduled = String(localized: "已排,锁屏听")
                    }
                    if !scheduled.isEmpty { Text(scheduled).font(.caption).foregroundStyle(.orange) }
                }
                Section {
                    HStack {
                        Text("版本").foregroundStyle(.secondary)
                        Spacer()
                        Text("答鸭 \(appVersion)").foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成") { codeFocused = false }
                }
            }
        }
        .alert("改个名字", isPresented: $naming) {
            TextField("比如:答鸭", text: $nameDraft)
            Button("保存") {
                let n = nameDraft.trimmingCharacters(in: .whitespaces)
                if !n.isEmpty { assistantName = n }
            }
            Button("取消", role: .cancel) {}
        }
        .onReceive(NotificationCenter.default.publisher(for: AppDelegate.tokenUpdated)) { note in
            if let value = note.object as? String { token = value }
        }
    }

    private func pushLevel() {
        Task {
            _ = try? await URLSession.shared.data(for: API.request("/settings", method: "POST", body: ["level": Int(announceLevel)]))
        }
    }

    // 配对认领:凭 6 位码向中继换账户密钥(免鉴权)。配对码只在电脑发码的那个中继上,逐个试。
    private func claim() async {
        let code = pairCode.trimmingCharacters(in: .whitespaces)
        pairMsg = String(localized: "绑定中…")
        for host in EarpieceConfig.hosts {
            guard let url = URL(string: "\(host)/pair/claim") else { continue }
            var req = URLRequest(url: url); req.httpMethod = "POST"; req.timeoutInterval = 8
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            // 带稳定设备 id(去重「已绑 N 台」计数)+ 机型名
            let devId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["code": code, "device": "\(UIDevice.current.name)·\(devId.prefix(8))"])
            guard let (data, resp) = try? await URLSession.shared.data(for: req),
                  (resp as? HTTPURLResponse)?.statusCode == 200,
                  let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let key = j["accountKey"] as? String else { continue }
            accountKey = key; pairCode = ""; pairMsg = String(localized: "✅ 绑定成功,这台电脑现在归你了")
            AppDelegate.registerToken()  // 配对后上报 APNs token,推送/批准才到得了这台手机
            return
        }
        pairMsg = String(localized: "配对码无效或已过期,在电脑上重新出码")
    }

    private func autoFindLAN() {
        discovering = true
        connTest = ""
        Task {
            // 先问中继:电脑自己上报的局域网 IP(可靠,不靠扫描)。失败再扫网段兜底。
            if let ip = await lanIPFromRelay() {
                lanIP = ip; connTest = String(localized: "✅ 找到电脑 \(ip)")
            } else if let ip = await LANDiscovery.find() {
                lanIP = ip; connTest = String(localized: "✅ 找到电脑 \(ip)")
            } else {
                connTest = String(localized: "❌ 同一 WiFi 下没找到电脑(daemon 开着吗?)")
            }
            discovering = false
        }
    }

    // 通过中继读各电脑上报的局域网 IP,挑和手机同网段、且能直连的那台
    private func lanIPFromRelay() async -> String? {
        guard let prefix = LANDiscovery.myPrefix(),
              let url = URL(string: "\(EarpieceConfig.hosts.first ?? EarpieceConfig.base)/status") else { return nil }
        var req = URLRequest(url: url); req.timeoutInterval = 6
        req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let machines = j["machines"] as? [String: [String: Any]] else { return nil }
        for (_, st) in machines {
            let ips = (st["lanIPs"] as? [String]) ?? (st["lanIP"] as? String).map { [$0] } ?? []
            for ip in ips where ip.hasPrefix(prefix + ".") {
                if await LANDiscovery.reachable(ip) { return ip }
            }
        }
        return nil
    }

    private func testConn() {
        connTest = String(localized: "连接中…")
        Task {
            do {
                let (_, resp) = try await URLSession.shared.data(for: API.request("/status"))
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                connTest = code == 200 ? String(localized: "✅ 连上了 \(EarpieceConfig.base)") : String(localized: "❌ 电脑回了 \(code)")
            } catch {
                connTest = String(localized: "❌ 连不上:\(error.localizedDescription)")
            }
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

// 扫码:相机扫二维码,扫到一个就回调字符串(配对页用)。AVFoundation 原生,无第三方依赖。
struct QRScanner: UIViewControllerRepresentable {
    var onScan: (String) -> Void
    func makeUIViewController(context: Context) -> ScannerVC {
        let vc = ScannerVC(); vc.onScan = onScan; return vc
    }
    func updateUIViewController(_ vc: ScannerVC, context: Context) {}

    final class ScannerVC: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
        var onScan: ((String) -> Void)?
        private let session = AVCaptureSession()
        private var handled = false

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = .black
            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else { return }
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { return }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            let preview = AVCaptureVideoPreviewLayer(session: session)
            preview.videoGravity = .resizeAspectFill
            preview.frame = view.layer.bounds
            view.layer.addSublayer(preview)
            DispatchQueue.global(qos: .userInitiated).async { self.session.startRunning() }
        }
        override func viewDidDisappear(_ animated: Bool) {
            super.viewDidDisappear(animated)
            if session.isRunning { session.stopRunning() }
        }
        func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objs: [AVMetadataObject],
                            from connection: AVCaptureConnection) {
            guard !handled,
                  let obj = objs.first as? AVMetadataMachineReadableCodeObject,
                  let s = obj.stringValue else { return }
            handled = true
            session.stopRunning()
            onScan?(s)
        }
    }
}
