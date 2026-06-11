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
        UNUserNotificationCenter.current().setNotificationCategories([approvalCategory])

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
