import SwiftUI
import StoreKit

// 答鸭 Pro:免费=局域网直连;Pro=公网中继(随时随地远程)。
// StoreKit 2 单订阅。客户端只管「展示 + 解锁 UI」;真正的防白嫖闸在中继服务端
// (阶段2:把 purchase 的签名凭证 jwsRepresentation 发给中继,中继向 Apple 验真后放行)。
@MainActor
final class Store: ObservableObject {
    static let productID = "com.example.codetalkie.pro.monthly"

    @Published private(set) var product: Product?
    @Published private(set) var isPro = false
    @Published private(set) var purchasing = false
    @Published var showPaywall = false
    @Published var lastError = ""

    private var updatesTask: Task<Void, Never>?

    init() {
        // 启动瞬间用上次缓存值,避免闪一下「未订阅」;真值随后由 refreshEntitlement 覆盖。
        isPro = UserDefaults.standard.bool(forKey: "isPro")
        updatesTask = listenForTransactions()
        Task { await load(); await refreshEntitlement() }
    }
    deinit { updatesTask?.cancel() }

    var priceText: String { product?.displayPrice ?? "$4.99" }

    func load() async {
        do {
            product = try await Product.products(for: [Self.productID]).first
        } catch {
            lastError = String(localized: "读取订阅信息失败:\(error.localizedDescription)")
        }
    }

    func purchase() async {
        guard let product else { lastError = String(localized: "订阅暂不可用,稍后再试"); return }
        purchasing = true
        defer { purchasing = false }
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                guard case .verified(let transaction) = verification else {
                    lastError = String(localized: "购买校验未通过"); return
                }
                // 阶段2:await sendReceiptToRelay(verification.jwsRepresentation)
                await setPro(true)
                await transaction.finish()
            case .userCancelled:
                break
            case .pending:
                lastError = String(localized: "购买待批准(如需家长同意)")
            @unknown default:
                break
            }
        } catch {
            lastError = String(localized: "购买失败:\(error.localizedDescription)")
        }
    }

    func restore() async {
        try? await AppStore.sync()
        await refreshEntitlement()
    }

    func refreshEntitlement() async {
        var active = false
        for await result in Transaction.currentEntitlements {
            guard case .verified(let t) = result,
                  t.productID == Self.productID,
                  t.revocationDate == nil else { continue }
            if let exp = t.expirationDate { active = exp > Date() } else { active = true }
        }
        await setPro(active)
    }

    private func setPro(_ v: Bool) async {
        isPro = v
        UserDefaults.standard.set(v, forKey: "isPro")
    }

    private func listenForTransactions() -> Task<Void, Never> {
        Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard case .verified(let t) = result else { continue }
                await self?.refreshEntitlement()
                await t.finish()
            }
        }
    }
}

// 付费墙:解释 Pro 价值(随时随地远程)+ 订阅/恢复 + 条款隐私。
struct PaywallView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss

    private let privacyURL = URL(string: "https://github.com/swl521/codetalkie/blob/main/PRIVACY.md")!
    private let eulaURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    Image(systemName: "headphones.circle.fill")
                        .font(.system(size: 60))
                        .foregroundStyle(LinearGradient(colors: [Color(red: 0.07, green: 0.32, blue: 0.92),
                                                                  Color(red: 0.02, green: 0.78, blue: 0.72)],
                                                        startPoint: .topLeading, endPoint: .bottomTrailing))
                    VStack(spacing: 4) {
                        Text("答鸭 Pro").font(.largeTitle).bold()
                        Text("随时随地远程").font(.title3).foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        feature("globe", "公网中继", "出门、用流量也能连电脑——不必和电脑同一 WiFi")
                        feature("desktopcomputer", "多台电脑", "一个手机管所有电脑,随便切")
                        feature("waveform", "云端高级语音", "更自然的播报嗓音")
                        feature("bolt.fill", "优先送达", "消息更快、更稳")
                    }
                    .padding(.horizontal)

                    Text("免费版始终可用:和电脑在同一 WiFi 时,局域网直连。")
                        .font(.caption).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center).padding(.horizontal)

                    Button {
                        Task { await store.purchase(); if store.isPro { dismiss() } }
                    } label: {
                        VStack(spacing: 2) {
                            Text(store.purchasing ? "处理中…" : "订阅 Pro · \(store.priceText)/月").bold()
                            Text("可随时取消").font(.caption2).opacity(0.85)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(store.purchasing)
                    .padding(.horizontal)

                    Button("恢复购买") { Task { await store.restore(); if store.isPro { dismiss() } } }
                        .font(.footnote)

                    if !store.lastError.isEmpty {
                        Text(store.lastError).font(.caption).foregroundStyle(.red)
                            .multilineTextAlignment(.center).padding(.horizontal)
                    }

                    HStack(spacing: 6) {
                        Link("隐私政策", destination: privacyURL)
                        Text("·").foregroundStyle(.secondary)
                        Link("使用条款(EULA)", destination: eulaURL)
                    }.font(.caption2)

                    Text("订阅自动续订,可在 系统设置 → Apple ID → 订阅 里随时取消;付款在确认时记入你的 Apple 账户。")
                        .font(.caption2).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center).padding(.horizontal)
                }
                .padding(.vertical)
            }
            .navigationTitle("升级").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } } }
        }
    }

    private func feature(_ icon: String, _ title: String, _ desc: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.title3).foregroundStyle(.blue).frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline).bold()
                Text(desc).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
    }
}
