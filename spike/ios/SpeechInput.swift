import Speech
import AVFoundation

// 主页大按钮的语音输入:按下开录,实时转写,再按结束。苹果原生 Speech 框架。
// 识别语言跟设置走(UserDefaults speechLocale,默认系统语言)——换语言不用改代码。
@MainActor
final class SpeechInput: ObservableObject {
    @Published var transcript = ""
    @Published var recording = false
    @Published var denied = false

    private var recognizer: SFSpeechRecognizer?
    private static func currentLocale() -> Locale {
        if let id = UserDefaults.standard.string(forKey: "speechLocale"), !id.isEmpty {
            return Locale(identifier: id)
        }
        // 没显式设置:系统是中文就跟系统,否则兜底 zh-CN(主力用户说中文;英文系统别把中文识别成乱码)
        let sys = Locale.current.identifier
        return Locale(identifier: sys.hasPrefix("zh") ? sys : "zh-CN")
    }
    private var task: SFSpeechRecognitionTask?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private let engine = AVAudioEngine()
    private var stopRequested = false   // 按住说话:若在引擎启动前就松手,引擎一起来立刻收尾

    func toggle() {
        recording ? stop() : start()
    }

    // 按住开录(列表行小麦克风用):权限就绪后开录,松手调 stop()
    func start() {
        transcript = ""
        stopRequested = false
        recognizer = SFSpeechRecognizer(locale: Self.currentLocale()) // 每次开录取当前设置,改语言即生效
        SFSpeechRecognizer.requestAuthorization { auth in
            guard auth == .authorized else {
                Task { @MainActor in self.denied = true }
                return
            }
            AVAudioSession.sharedInstance().requestRecordPermission { ok in
                Task { @MainActor in
                    if ok { self.begin() } else { self.denied = true }
                }
            }
        }
    }

    private func begin() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try? session.setActive(true, options: .notifyOthersOnDeactivation)

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        request = req

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            req.append(buffer)
        }
        engine.prepare()
        guard (try? engine.start()) != nil else { return }
        recording = true
        if stopRequested { stop(); return }   // 引擎启动前就松手了,立即收尾

        task = recognizer?.recognitionTask(with: req) { [weak self] result, error in
            Task { @MainActor in
                guard let self else { return }
                if let r = result { self.transcript = r.bestTranscription.formattedString }
                if error != nil || (result?.isFinal ?? false) { self.teardown() }
            }
        }
    }

    func stop() {
        stopRequested = true   // 若引擎尚未起来,begin() 起来后会据此立即收尾
        request?.endAudio()
        teardown()
    }

    private func teardown() {
        guard recording else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        recording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

// 后台播报(耳机模式):把订阅项目的新播报念进手机/耳机——锁屏、揣兜里也连续念。
// 安卓 EarpieceService 的 iOS 版:playback+spokenAudio 会话走蓝牙耳机;耳机模式开时用
// 静音保活让 App 锁屏后台不被挂起;轮询订阅项目 /history,只念新出现、非回填(seed)的
// assistant 行(我那种长桌面回复=回填,不念)。
@MainActor
final class BroadcastService: ObservableObject {
    static let shared = BroadcastService()
    @Published var backgroundOn = false   // 耳机模式:开了才在锁屏/后台继续念

    private let synth = AVSpeechSynthesizer()
    private let engine = AVAudioEngine()
    private let silence = AVAudioPlayerNode()
    private var pollTask: Task<Void, Never>?
    private var lastTs: [String: Double] = [:]   // 项目 → 上次念到的 ts(只念更新的)
    private var enabled: Bool { UserDefaults.standard.object(forKey: "announceEnabled") as? Bool ?? true }

    // App 启动调:开始前台轮询;若上次开了耳机模式,顺带把后台保活也起上。
    func startForeground() {
        backgroundOn = UserDefaults.standard.bool(forKey: "earpieceBackground")
        activateSession()
        if backgroundOn { startSilence() }
        if pollTask == nil { pollTask = Task { await loop() } }
    }
    // 设置页开关:耳机模式(锁屏也念)
    func setBackground(_ on: Bool) {
        backgroundOn = on
        UserDefaults.standard.set(on, forKey: "earpieceBackground")
        if on { activateSession(); startSilence() } else { silence.stop() }
    }

    private func activateSession() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .spokenAudio,
                           options: [.duckOthers, .allowBluetooth, .allowBluetoothA2DP])
        try? s.setActive(true)
    }
    // 循环播放 1 秒静音,让带 audio 后台模式的 App 锁屏也不被挂起。
    private func startSilence() {
        guard !silence.isPlaying,
              let fmt = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1),
              let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: 44100) else { return }
        buf.frameLength = 44100   // 全零 = 静音
        if !engine.attachedNodes.contains(silence) {
            engine.attach(silence)
            engine.connect(silence, to: engine.mainMixerNode, format: fmt)
        }
        try? engine.start()
        silence.scheduleBuffer(buf, at: nil, options: .loops, completionHandler: nil)
        silence.play()
    }

    private func loop() async {
        while !Task.isCancelled {
            await tick()
            try? await Task.sleep(nanoseconds: 3_000_000_000)
        }
    }
    private func tick() async {
        guard enabled else { return }
        let subs = UserDefaults.standard.stringArray(forKey: "iosSubscribedProjects") ?? []
        guard !subs.isEmpty else { return }
        let base = EarpieceConfig.endpoint.replacingOccurrences(of: "/command", with: "")
        for project in subs {
            guard let enc = project.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
                  let url = URL(string: "\(base)/history?project=\(enc)") else { continue }
            var req = URLRequest(url: url)
            req.timeoutInterval = 8
            req.setValue("Bearer \(EarpieceConfig.token)", forHTTPHeaderField: "Authorization")
            guard let (data, resp) = try? await URLSession.shared.data(for: req),
                  (resp as? HTTPURLResponse)?.statusCode == 200,
                  let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { continue }
            let cutoff = lastTs[project] ?? Date().timeIntervalSince1970 * 1000   // 首轮只念此刻之后的
            let fresh = arr.compactMap { o -> (Double, String)? in
                guard (o["role"] as? String) == "assistant",
                      (o["src"] as? String) != "seed",
                      let ts = o["ts"] as? Double, ts > cutoff,
                      let t = o["text"] as? String, !t.isEmpty else { return nil }
                return (ts, t)
            }.sorted { $0.0 < $1.0 }
            for (ts, t) in fresh {
                say("\(project)：\(t)")
                lastTs[project] = max(lastTs[project] ?? 0, ts)
            }
        }
    }
    func say(_ text: String) {
        activateSession()
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        synth.speak(u)
    }
}
