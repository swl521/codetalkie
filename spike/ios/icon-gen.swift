// 生成小易 App 图标:蓝绿渐变底 + 白色耳机符号。用法: swift icon-gen.swift <输出.png>
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png"
let S: CGFloat = 1024

let img = NSImage(size: NSSize(width: S, height: S))
img.lockFocus()
let ctx = NSGraphicsContext.current!.cgContext

// 渐变背景(深蓝 → 青绿,对角)
let colors = [
  NSColor(calibratedRed: 0.07, green: 0.32, blue: 0.92, alpha: 1).cgColor,
  NSColor(calibratedRed: 0.02, green: 0.78, blue: 0.72, alpha: 1).cgColor,
] as CFArray
let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: 0, y: S), end: CGPoint(x: S, y: 0), options: [])

// 白色耳机符号居中
let cfg = NSImage.SymbolConfiguration(pointSize: 520, weight: .medium)
if let symbol = NSImage(systemSymbolName: "headphones", accessibilityDescription: nil)?
    .withSymbolConfiguration(cfg) {
  let white = NSImage(size: symbol.size, flipped: false) { rect in
    symbol.draw(in: rect)
    NSColor.white.set()
    rect.fill(using: .sourceAtop)
    return true
  }
  let w = symbol.size.width, h = symbol.size.height
  let scale = 620 / max(w, h)
  let dw = w * scale, dh = h * scale
  white.draw(in: NSRect(x: (S - dw) / 2, y: (S - dh) / 2 + 30, width: dw, height: dh))
}

// 底部一圈声波点缀(三段弧)
ctx.setStrokeColor(NSColor.white.withAlphaComponent(0.85).cgColor)
ctx.setLineCap(.round)
for (i, r) in [CGFloat(70), 110, 150].enumerated() {
  ctx.setLineWidth(22 - CGFloat(i) * 4)
  ctx.addArc(center: CGPoint(x: S / 2, y: 175), radius: r,
             startAngle: .pi * 0.25, endAngle: .pi * 0.75, clockwise: false)
  ctx.strokePath()
}

img.unlockFocus()

let tiff = img.tiffRepresentation!
let rep = NSBitmapImageRep(data: tiff)!
let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: out))
print("written: \(out)")
