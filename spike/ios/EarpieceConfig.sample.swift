// 复制本文件为 EarpieceConfig.swift 并填入你自己的 token(EarpieceConfig.swift 已被 gitignore)
// 连接方式在 App 设置页切换:公网中继(默认)/ 局域网(填电脑 IP)。
import Foundation

enum EarpieceConfig {
    // 绑定电脑后存的「账户密钥」(设置页配对得到);未绑定时为空,先去绑定。
    static var token: String { UserDefaults.standard.string(forKey: "accountKey") ?? "" }
    // 可填一个或多个公网中继域名(主、备…),互为兜底:读请求挨个试,试通的钉为
    // activeIndex,后续所有请求都走它。电脑端 ~/.earpiece/relay.json 的 urls 要与此一致。
    static let relayHosts = ["your-relay.example.com"]
    static var activeIndex = 0

    static var hosts: [String] {
        let d = UserDefaults.standard
        if d.string(forKey: "connMode") == "lan" {
            let ip = (d.string(forKey: "lanIP") ?? "").trimmingCharacters(in: .whitespaces)
            if !ip.isEmpty { return ["http://\(ip):7780"] }
        }
        return relayHosts.map { "https://\($0)" }
    }
    static var base: String { let h = hosts; return h[min(activeIndex, h.count - 1)] }
    static var endpoint: String { base + "/command" }
}
