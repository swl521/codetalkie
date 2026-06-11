// 菜单栏应用入口:无 storyboard,手动启动 NSApplication
import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// LSUIElement=YES 时为 accessory,不占 Dock
app.setActivationPolicy(.accessory)
app.run()
