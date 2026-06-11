import AppIntents
import Foundation

struct SendCommandIntent: AppIntent {
    static var title: LocalizedStringResource = "发指令"
    static var description = IntentDescription("把语音指令发给电脑上的 Agent")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "指令", requestValueDialog: "要让电脑做什么?")
    var command: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        var req = URLRequest(url: URL(string: EarpieceConfig.endpoint)!)
        req.httpMethod = "POST"
        req.timeoutInterval = 8
        req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["text": command])
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            return .result(dialog: code == 202
                ? .init("已发给电脑:\(command)")
                : .init("电脑拒绝了,状态 \(code)"))
        } catch {
            return .result(dialog: .init("联不上电脑,确认在同一个 WiFi 并且 daemon 开着"))
        }
    }
}

// ── 一句话快捷指令:苹果限制一个短语只能嵌一个菜单,所以"项目+动作"合成一个 ──

enum QuickCommand: String, AppEnum {
    case earpieceProgress = "earpiece 汇报一下当前进展"
    case earpieceTest = "earpiece 跑一下测试"
    case earpieceResume = "earpiece 继续刚才没做完的事"
    case wikiProgress = "wiki 汇报一下当前进展"
    case wikiTest = "wiki 跑一下测试"
    case wikiResume = "wiki 继续刚才没做完的事"
    case joke = "demo 讲个程序员笑话"

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "指令"
    static var caseDisplayRepresentations: [QuickCommand: DisplayRepresentation] = [
        .earpieceProgress: "让earpiece汇报进展",
        .earpieceTest: "让earpiece跑测试",
        .earpieceResume: "让earpiece继续",
        .wikiProgress: "让wiki汇报进展",
        .wikiTest: "让wiki跑测试",
        .wikiResume: "让wiki继续",
        .joke: "讲个笑话",
    ]
}

struct QuickCommandIntent: AppIntent {
    static var title: LocalizedStringResource = "快捷指令"
    static var openAppWhenRun: Bool = false

    @Parameter(title: "指令") var command: QuickCommand

    func perform() async throws -> some IntentResult & ProvidesDialog {
        var req = URLRequest(url: URL(string: EarpieceConfig.endpoint)!)
        req.httpMethod = "POST"
        req.timeoutInterval = 8
        req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["text": command.rawValue])
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            return .result(dialog: code == 202
                ? .init("好,马上办")
                : .init("电脑拒绝了,状态 \(code)"))
        } catch {
            return .result(dialog: .init("联不上电脑"))
        }
    }
}

// ── 语音批准:听到"批准吗?"后直接说"嘿 Siri,告诉小易批准/拒绝" ──

enum ApprovalClient {
    static func respond(approve: Bool) async -> Bool {
        let url = EarpieceConfig.endpoint.replacingOccurrences(of: "/command", with: "/approval/respond")
        var req = URLRequest(url: URL(string: url)!)
        req.httpMethod = "POST"
        req.timeoutInterval = 8
        req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["approve": approve])
        guard let (_, resp) = try? await URLSession.shared.data(for: req) else { return false }
        return (resp as? HTTPURLResponse)?.statusCode == 200
    }
}

struct ApproveIntent: AppIntent {
    static var title: LocalizedStringResource = "批准"
    static var openAppWhenRun: Bool = false
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ok = await ApprovalClient.respond(approve: true)
        return .result(dialog: .init(ok ? "已批准,电脑继续干了" : "现在没有等批准的事"))
    }
}

struct DenyIntent: AppIntent {
    static var title: LocalizedStringResource = "拒绝"
    static var openAppWhenRun: Bool = false
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ok = await ApprovalClient.respond(approve: false)
        return .result(dialog: .init(ok ? "已拒绝" : "现在没有等批准的事"))
    }
}

struct EarpieceShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: SendCommandIntent(),
            phrases: [
                "告诉 \(.applicationName)",
                "Tell \(.applicationName)",
            ],
            shortTitle: "发指令",
            systemImageName: "mic.fill"
        )
        AppShortcut(
            intent: QuickCommandIntent(),
            phrases: [
                "告诉 \(.applicationName) \(\.$command)",
                "\(.applicationName) \(\.$command)",
            ],
            shortTitle: "一句话指令",
            systemImageName: "bolt.fill"
        )
        AppShortcut(
            intent: ApproveIntent(),
            phrases: ["告诉 \(.applicationName) 批准", "\(.applicationName) 批准"],
            shortTitle: "批准",
            systemImageName: "checkmark.circle.fill"
        )
        AppShortcut(
            intent: DenyIntent(),
            phrases: ["告诉 \(.applicationName) 拒绝", "\(.applicationName) 拒绝"],
            shortTitle: "拒绝",
            systemImageName: "xmark.circle.fill"
        )
    }
}
