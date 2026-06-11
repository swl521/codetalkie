// 复制本文件为 EarpieceConfig.swift 并填入你自己的值(EarpieceConfig.swift 已被 gitignore)
// endpoint:局域网模式填你 Mac 的 IP;token:~/.earpiece/lan-token 的内容(daemon 首次启动自动生成)
enum EarpieceConfig {
    static let endpoint = "http://192.168.1.100:7780/command"
    static let token = "把 ~/.earpiece/lan-token 的内容粘到这里"
}
