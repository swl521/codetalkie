package com.example.codetalkie.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.speech.tts.TextToSpeech
import androidx.core.app.NotificationCompat
import com.example.codetalkie.data.RelayClient
import com.example.codetalkie.data.SettingsRepository
import com.example.codetalkie.tts.EdgePlayer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * v1 耳机朗读通道:前台服务每 5 秒轮询订阅项目的 /history,
 * 新出现的 assistant 行用系统 TTS(中文)朗读 —— 连上蓝牙耳机即"耳机播报"。
 * FCM 推送通道为二期,本服务零外部依赖。
 */
class EarpieceService : Service(), TextToSpeech.OnInitListener {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var settingsRepo: SettingsRepository
    private var tts: TextToSpeech? = null
    private var edgePlayer: EdgePlayer? = null

    @Volatile
    private var ttsReady = false

    /** 项目名 -> 已朗读的最大 ts(epoch ms)。首次见到的项目只记位置不回放历史。 */
    private val lastSpokenTs = mutableMapOf<String, Long>()
    private var pollJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        settingsRepo = SettingsRepository(applicationContext)
        tts = TextToSpeech(this, this)
        edgePlayer = EdgePlayer(applicationContext)
        startInForeground()
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts?.language = Locale.SIMPLIFIED_CHINESE
            ttsReady = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (pollJob == null) {
            pollJob = scope.launch { pollLoop() }
        }
        return START_STICKY
    }

    private suspend fun pollLoop() {
        while (true) {
            try {
                val s = settingsRepo.current()
                if (s.token.isNotBlank() && s.subscribedProjects.isNotEmpty()) {
                    val client = RelayClient(s.relayUrl, s.token)
                    for (project in s.subscribedProjects) {
                        val history = runCatching { client.fetchHistory(project) }.getOrNull() ?: continue
                        val maxTs = history.maxOfOrNull { it.ts } ?: continue
                        val seenTs = lastSpokenTs[project]
                        lastSpokenTs[project] = maxTs
                        if (seenTs == null) continue // 首见:只定位,不回放旧字幕
                        if (!s.announceEnabled) continue // ttsReady 只关系统引擎,speakSystem 里自查
                        history
                            .filter { it.role == "assistant" && it.ts > seenTs && it.text.isNotBlank() }
                            .forEach { line -> speakLine(line.text, line.ts, s) }
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // 网络抖动 / relay 不可达:静默,下一轮重试
            }
            delay(POLL_INTERVAL_MS)
        }
    }

    /** 按设置选引擎:edge=微软云端(失败回落系统),system=本机 TTS(可选音色)。 */
    private fun speakLine(text: String, ts: Long, s: com.example.codetalkie.data.EarpieceSettings) {
        if (s.ttsMode == SettingsRepository.MODE_EDGE) {
            edgePlayer?.enqueue(text, s.edgeVoice, s.ttsRate, onError = { speakSystem(text, ts, s) })
        } else {
            speakSystem(text, ts, s)
        }
    }

    private fun speakSystem(text: String, ts: Long, s: com.example.codetalkie.data.EarpieceSettings) {
        if (!ttsReady) return
        tts?.setSpeechRate(s.ttsRate)
        // 用户选过音色就切过去(Voice.name 匹配,找不到保持引擎默认)
        if (s.ttsVoice.isNotBlank() && tts?.voice?.name != s.ttsVoice) {
            tts?.voices?.firstOrNull { it.name == s.ttsVoice }?.let { tts?.voice = it }
        }
        tts?.speak(text, TextToSpeech.QUEUE_ADD, null, "earpiece-$ts")
    }

    private fun startInForeground() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "耳机播报", NotificationManager.IMPORTANCE_LOW)
        )
        val stopIntent = PendingIntent.getService(
            this,
            0,
            Intent(this, EarpieceService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("小易耳机播报")
            .setContentText("正在监听订阅项目的进展")
            .setOngoing(true)
            .addAction(0, "停止", stopIntent)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onDestroy() {
        pollJob?.cancel()
        scope.cancel()
        tts?.stop()
        tts?.shutdown()
        tts = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_STOP = "com.example.codetalkie.action.STOP_EARPIECE"
        private const val CHANNEL_ID = "earpiece"
        private const val NOTIFICATION_ID = 1
        private const val POLL_INTERVAL_MS = 5_000L

        fun start(context: Context) {
            context.startForegroundService(Intent(context, EarpieceService::class.java))
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, EarpieceService::class.java).setAction(ACTION_STOP)
            )
        }
    }
}
