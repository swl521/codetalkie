// 复制本文件为 EarpieceConfig.swift 并填入你自己的 token(EarpieceConfig.swift 已被 gitignore)
// 连接方式在 App 设置页切换:公网中继(默认)/ 局域网(填电脑 IP)。
import Foundation

enum EarpieceConfig {
    static let token = "把 ~/.earpiece/lan-token 的内容粘到这里"
    static let defaultRelayHost = "your-relay.example.com"   // 自部署的公网中继域名

    static var base: String {
        let d = UserDefaults.standard
        if d.string(forKey: "connMode") == "lan" {
            let ip = (d.string(forKey: "lanIP") ?? "").trimmingCharacters(in: .whitespaces)
            if !ip.isEmpty { return "http://\(ip):7780" }
        }
        return "https://\(defaultRelayHost)"
    }
    static var endpoint: String { base + "/command" }
}
