package com.example.codetalkie.tts

import android.content.Context
import android.media.MediaPlayer
import com.example.codetalkie.R
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.UUID

/**
 * 微软 Edge "大声朗读"云端神经语音(免费、无需 key)。
 * 协议与开源 edge-tts 一致:wss 发 speech.config + SSML,收 mp3 二进制帧,
 * Path:turn.end 结束。比系统 TTS 自然得多,作为可选引擎;失败由调用方回落系统 TTS。
 */
object EdgeTts {

    /** 常用音色全集(中英都列;name 进 SSML,label 是 strings.xml 资源键,随语言包翻译)。 */
    val VOICES: List<Pair<String, Int>> = listOf(
        "zh-CN-XiaoxiaoNeural" to R.string.voice_zh_xiaoxiao,
        "zh-CN-XiaoyiNeural" to R.string.voice_zh_xiaoyi,
        "zh-CN-YunxiNeural" to R.string.voice_zh_yunxi,
        "zh-CN-YunyangNeural" to R.string.voice_zh_yunyang,
        "zh-CN-YunjianNeural" to R.string.voice_zh_yunjian,
        "zh-CN-liaoning-XiaobeiNeural" to R.string.voice_zh_xiaobei,
        "en-US-AriaNeural" to R.string.voice_en_aria,
        "en-US-JennyNeural" to R.string.voice_en_jenny,
        "en-US-GuyNeural" to R.string.voice_en_guy,
    )

    // 开源 edge-tts 通用公开常量(Edge 浏览器朗读通道)
    private const val TRUSTED_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
    private const val WSS =
        "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1"

    private val http = OkHttpClient()

    /** Sec-MS-GEC:SHA-256(5 分钟对齐的 Windows ticks + token),微软 2024 起要求。 */
    private fun gecToken(): String {
        val winFileEpoch = System.currentTimeMillis() / 1000 + 11_644_473_600L
        val ticks = winFileEpoch * 10_000_000L
        val rounded = ticks - (ticks % 3_000_000_000L)
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$rounded$TRUSTED_TOKEN".toByteArray())
        return digest.joinToString("") { "%02X".format(it) }
    }

    /** 合成一段文本为 mp3 字节;失败抛异常(调用方决定回落)。 */
    suspend fun synth(text: String, voice: String, rate: Float): ByteArray {
        val ratePct = ((rate - 1f) * 100).toInt().coerceIn(-50, 100)
        val url = "$WSS?TrustedClientToken=$TRUSTED_TOKEN" +
            "&Sec-MS-GEC=${gecToken()}&Sec-MS-GEC-Version=1-130.0.2849.68" +
            "&ConnectionId=${UUID.randomUUID().toString().replace("-", "")}"
        val req = Request.Builder()
            .url(url)
            .header("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
            )
            .build()

        val audio = ByteArrayOutputStream()
        val done = CompletableDeferred<ByteArray>()
        val ws = http.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(
                    "X-Timestamp:${java.util.Date()}\r\n" +
                        "Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
                        """{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}""",
                )
                // xml:lang 跟随音色名前缀(如 zh-CN-XiaoxiaoNeural → zh-CN,en-US-AriaNeural → en-US)
                val ssmlLang = voice.split("-").take(2).joinToString("-")
                val ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='$ssmlLang'>" +
                    "<voice name='$voice'><prosody pitch='+0Hz' rate='${if (ratePct >= 0) "+" else ""}$ratePct%' volume='+0%'>" +
                    escapeXml(text) + "</prosody></voice></speak>"
                webSocket.send(
                    "X-RequestId:${UUID.randomUUID().toString().replace("-", "")}\r\n" +
                        "Content-Type:application/ssml+xml\r\n" +
                        "X-Timestamp:${java.util.Date()}\r\nPath:ssml\r\n\r\n" + ssml,
                )
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text.contains("Path:turn.end")) {
                    webSocket.close(1000, null)
                    done.complete(audio.toByteArray())
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                // 二进制帧:前 2 字节 = 头长度(大端),头后是 mp3 数据
                val arr = bytes.toByteArray()
                if (arr.size < 2) return
                val headerLen = ((arr[0].toInt() and 0xFF) shl 8) or (arr[1].toInt() and 0xFF)
                val start = 2 + headerLen
                val header = String(arr, 2, minOf(headerLen, arr.size - 2))
                if (header.contains("Path:audio") && arr.size > start) {
                    audio.write(arr, start, arr.size - start)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                done.completeExceptionally(t)
            }
        })
        return try {
            withTimeout(15_000) { done.await() }.also {
                if (it.isEmpty()) throw IllegalStateException("EdgeTts 没收到音频")
            }
        } finally {
            ws.cancel()
        }
    }

    private fun escapeXml(s: String) = s
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        .replace("\"", "&quot;").replace("'", "&apos;")
}

/** 串行播放队列:合成 → 缓存文件 → MediaPlayer 依次播,服务和设置页试听共用。 */
class EdgePlayer(private val context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutex = Mutex()

    fun enqueue(text: String, voice: String, rate: Float, onError: (Throwable) -> Unit = {}) {
        scope.launch {
            mutex.withLock {
                try {
                    val mp3 = EdgeTts.synth(text, voice, rate)
                    val f = File.createTempFile("edge-tts", ".mp3", context.cacheDir)
                    f.writeBytes(mp3)
                    playBlocking(f)
                    f.delete()
                } catch (t: Throwable) {
                    onError(t)
                }
            }
        }
    }

    private suspend fun playBlocking(file: File) {
        val finished = CompletableDeferred<Unit>()
        val mp = MediaPlayer()
        try {
            mp.setDataSource(file.absolutePath)
            mp.setOnCompletionListener { finished.complete(Unit) }
            mp.setOnErrorListener { _, _, _ -> finished.complete(Unit); true }
            mp.prepare()
            mp.start()
            finished.await()
        } finally {
            mp.release()
        }
    }
}
