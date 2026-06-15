import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    static let tokenUpdated = Notification.Name("tokenUpdated")
    static var deviceTokenString = "（正在请求权限…）"

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self

        // 批准类通知:长按出「批准/拒绝」两个按钮
        let approve = UNNotificationAction(identifier: "APPROVE", title: "批准", options: [.authenticationRequired])
        let deny = UNNotificationAction(identifier: "DENY", title: "拒绝", options: [.destructive])
        let approvalCategory = UNNotificationCategory(identifier: "APPROVAL", actions: [approve, deny],
                                                      intentIdentifiers: [], options: [])

        // 选择题类通知:长按出 ①②③④(对应正文里 1./2./3./4. 选项)。多于 4 个的在对话里打数字。
        let choiceActions = (1...4).map { i in
            UNNotificationAction(identifier: "CHOICE_\(i - 1)", title: "\(i)", options: [])
        }
        let choiceCategory = UNNotificationCategory(identifier: "CHOICE", actions: choiceActions,
                                                    intentIdentifiers: [], options: [])
        UNUserNotificationCenter.current().setNotificationCategories([approvalCategory, choiceCategory])

        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            guard granted else {
                Self.publish("通知权限被拒绝：\(error?.localizedDescription ?? "用户未授权")")
                return
            }
            DispatchQueue.main.async { application.registerForRemoteNotifications() }
        }
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        print("DEVICE TOKEN: \(token)")
        Self.publish(token)
        Self.registerToken()   // 上报中继(已配对才会成功;配对成功后会再报一次)
    }

    // 把 APNs token 上报到中继,daemon 取来发推送(重装/换机后自动跟上,通知不再发去死 token)。
    // 未配对(无账户密钥)或 token 还没拿到时跳过;配对成功后由 ContentView 再调一次。
    static func registerToken() {
        let tok = deviceTokenString
        guard tok.count >= 32, tok.allSatisfy({ $0.isHexDigit }),
              !EarpieceConfig.token.isEmpty,
              let url = URL(string: EarpieceConfig.endpoint.replacingOccurrences(of: "/command", with: "/apns-token")) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 8
        req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["token": tok])
        URLSession.shared.dataTask(with: req).resume()
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Self.publish("注册推送失败：\(error.localizedDescription)")
    }

    // 前台也弹出来，方便开发时确认收到
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    // 用户点了「批准/拒绝」→ 回传给 Mac daemon
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let content = response.notification.request.content
        // 选择题:点了 ①②③④ → 把选中的 index 回传给 daemon
        if content.categoryIdentifier == "CHOICE",
           let choiceId = content.userInfo["choiceId"] as? String,
           response.actionIdentifier.hasPrefix("CHOICE_"),
           let idx = Int(response.actionIdentifier.dropFirst("CHOICE_".count)) {
            let curl = EarpieceConfig.endpoint.replacingOccurrences(of: "/command", with: "/choice/respond")
            var creq = URLRequest(url: URL(string: curl)!)
            creq.httpMethod = "POST"
            creq.timeoutInterval = 8
            creq.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
            creq.setValue("application/json", forHTTPHeaderField: "Content-Type")
            creq.httpBody = try? JSONSerialization.data(withJSONObject: ["id": choiceId, "index": idx])
            URLSession.shared.dataTask(with: creq) { _, _, _ in completionHandler() }.resume()
            return
        }
        guard content.categoryIdentifier == "APPROVAL",
              let approvalId = content.userInfo["approvalId"] as? String,
              response.actionIdentifier == "APPROVE" || response.actionIdentifier == "DENY" else {
            completionHandler(); return
        }
        let approve = response.actionIdentifier == "APPROVE"
        let url = EarpieceConfig.endpoint.replacingOccurrences(of: "/command", with: "/approval/respond")
        var req = URLRequest(url: URL(string: url)!)
        req.httpMethod = "POST"
        req.timeoutInterval = 8
        req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["id": approvalId, "approve": approve])
        URLSession.shared.dataTask(with: req) { _, _, _ in completionHandler() }.resume()
    }

    private static func publish(_ value: String) {
        deviceTokenString = value
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: tokenUpdated, object: value)
        }
    }
}
