import Foundation

// 局域网自动发现:不让用户手填 IP。
// 拿手机自己的网段(192.168.0.x),并发探测 1~254 的 7780 端口,
// 命中带正确 token 的 /status 即锁定。daemon 监听 0.0.0.0:7780,同 WiFi 必能扫到。
enum LANDiscovery {

    // 取本机 WiFi 的 IPv4(en0)
    static func localIPv4() -> String? {
        var ptr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ptr) == 0, let first = ptr else { return nil }
        defer { freeifaddrs(ptr) }
        var result: String?
        var cur = first
        while true {
            let ifa = cur.pointee
            let family = ifa.ifa_addr.pointee.sa_family
            if family == UInt8(AF_INET) {
                let name = String(cString: ifa.ifa_name)
                if name == "en0" {
                    var addr = ifa.ifa_addr.pointee
                    var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    getnameinfo(&addr, socklen_t(ifa.ifa_addr.pointee.sa_len),
                                &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
                    result = String(cString: host)
                }
            }
            guard let next = ifa.ifa_next else { break }
            cur = next
        }
        return result
    }

    // 扫网段,返回第一台应答正确的电脑 IP(找不到返回 nil)
    static func find() async -> String? {
        guard let ip = localIPv4() else { return nil }
        let parts = ip.split(separator: ".")
        guard parts.count == 4 else { return nil }
        let prefix = "\(parts[0]).\(parts[1]).\(parts[2])."

        return await withTaskGroup(of: String?.self) { group in
            for host in 1...254 {
                let candidate = "\(prefix)\(host)"
                group.addTask { await probe(candidate) ? candidate : nil }
            }
            for await hit in group where hit != nil {
                group.cancelAll()
                return hit
            }
            return nil
        }
    }

    // 我所在网段的前三段,如 192.168.0
    static func myPrefix() -> String? {
        guard let ip = localIPv4() else { return nil }
        let p = ip.split(separator: ".")
        return p.count == 4 ? "\(p[0]).\(p[1]).\(p[2])" : nil
    }

    static func reachable(_ ip: String) async -> Bool { await probe(ip) }

    private static func probe(_ ip: String) async -> Bool {
        guard let url = URL(string: "http://\(ip):7780/status") else { return false }
        var req = URLRequest(url: url)
        req.timeoutInterval = 2
        req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
        guard let (_, resp) = try? await URLSession.shared.data(for: req) else { return false }
        return (resp as? HTTPURLResponse)?.statusCode == 200
    }
}
