import Speech
import AVFoundation

// 主页大按钮的语音输入:按下开录,实时转写,再按结束。苹果原生 Speech 框架,中文。
@MainActor
final class SpeechInput: ObservableObject {
    @Published var transcript = ""
    @Published var recording = false
    @Published var denied = false

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
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
