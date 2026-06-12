package com.example.codetalkie.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import androidx.compose.foundation.clickable
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.example.codetalkie.data.SettingsRepository
import com.example.codetalkie.service.EarpieceService
import com.example.codetalkie.tts.EdgePlayer
import com.example.codetalkie.tts.EdgeTts
import kotlinx.coroutines.launch
import java.util.Locale

@Composable
fun SettingsScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val repo = remember { SettingsRepository(context.applicationContext) }
    val scope = rememberCoroutineScope()
    val settings by repo.settings.collectAsState(initial = null)

    var url by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var rate by remember { mutableFloatStateOf(SettingsRepository.DEFAULT_TTS_RATE) }
    var loaded by remember { mutableStateOf(false) }

    // 音色列表:临时 TTS 实例枚举中文音色(选中即试听);随组合体生命周期释放
    var voices by remember { mutableStateOf<List<Voice>>(emptyList()) }
    var previewTts by remember { mutableStateOf<TextToSpeech?>(null) }
    DisposableEffect(Unit) {
        var t: TextToSpeech? = null
        t = TextToSpeech(context) { st ->
            if (st == TextToSpeech.SUCCESS) {
                t?.language = Locale.SIMPLIFIED_CHINESE
                voices = t?.voices.orEmpty()
                    .filter { v -> v.locale.language in setOf("zh", "cmn") && !v.isNetworkConnectionRequired }
                    .sortedBy { it.name }
                previewTts = t
            }
        }
        onDispose { t?.shutdown() }
    }
    fun preview(voice: Voice?) {
        previewTts?.let { p ->
            if (voice != null) p.voice = voice
            p.setSpeechRate(rate)
            p.speak("你好,我是小易,这是这个声音的效果。", TextToSpeech.QUEUE_FLUSH, null, "preview")
        }
    }
    // 云端试听(微软 Edge 神经语音)
    val edgePlayer = remember { EdgePlayer(context.applicationContext) }
    fun previewEdge(voice: String) {
        edgePlayer.enqueue("你好,我是小易,这是云端声音的效果。", voice, rate)
    }

    // 首次进入用持久化值填充本地编辑态,之后不再覆盖(避免打字被冲掉)
    LaunchedEffect(settings) {
        val s = settings ?: return@LaunchedEffect
        if (!loaded) {
            url = s.relayUrl
            token = s.token
            rate = s.ttsRate
            loaded = true
        }
    }

    val s = settings ?: return

    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("连接", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("Relay 地址") },
            placeholder = { Text(SettingsRepository.DEFAULT_RELAY_URL) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            label = { Text("Token") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        Button(onClick = {
            scope.launch {
                repo.setRelayUrl(url.trim())
                repo.setToken(token.trim())
            }
        }) {
            Text("保存连接设置")
        }

        HorizontalDivider()

        Text("耳机播报", style = MaterialTheme.typography.titleMedium)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("播报开关", modifier = Modifier.weight(1f))
            Switch(
                checked = s.announceEnabled,
                onCheckedChange = { v -> scope.launch { repo.setAnnounceEnabled(v) } },
            )
        }
        Text("TTS 语速 ${"%.1f".format(rate)}x", style = MaterialTheme.typography.bodyMedium)
        Slider(
            value = rate,
            onValueChange = { rate = it },
            onValueChangeFinished = { scope.launch { repo.setTtsRate(rate) } },
            valueRange = 0.5f..2.0f,
            steps = 14,
        )
        Text("语音引擎", style = MaterialTheme.typography.bodyMedium)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth()
                .clickable { scope.launch { repo.setTtsMode(SettingsRepository.MODE_EDGE) } },
        ) {
            RadioButton(selected = s.ttsMode == SettingsRepository.MODE_EDGE, onClick = {
                scope.launch { repo.setTtsMode(SettingsRepository.MODE_EDGE) }
            })
            Column {
                Text("微软云端神经语音(推荐)", style = MaterialTheme.typography.bodyMedium)
                Text("真人级音质 · 免费无需账号 · 需联网", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth()
                .clickable { scope.launch { repo.setTtsMode(SettingsRepository.MODE_SYSTEM) } },
        ) {
            RadioButton(selected = s.ttsMode == SettingsRepository.MODE_SYSTEM, onClick = {
                scope.launch { repo.setTtsMode(SettingsRepository.MODE_SYSTEM) }
            })
            Column {
                Text("系统 TTS", style = MaterialTheme.typography.bodyMedium)
                Text("离线可用,音质一般", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        Text("朗读声音(点选即试听)", style = MaterialTheme.typography.bodyMedium)
        if (s.ttsMode == SettingsRepository.MODE_EDGE) {
            EdgeTts.VOICES.forEach { (name, label) ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                        .clickable { scope.launch { repo.setEdgeVoice(name) }; previewEdge(name) },
                ) {
                    RadioButton(selected = s.edgeVoice == name, onClick = {
                        scope.launch { repo.setEdgeVoice(name) }; previewEdge(name)
                    })
                    Text(label, style = MaterialTheme.typography.bodyMedium)
                }
            }
        } else {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { scope.launch { repo.setTtsVoice("") }; preview(null) },
            ) {
                RadioButton(selected = s.ttsVoice.isBlank(), onClick = {
                    scope.launch { repo.setTtsVoice("") }; preview(null)
                })
                Text("系统默认", style = MaterialTheme.typography.bodyMedium)
            }
            voices.forEach { v ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { scope.launch { repo.setTtsVoice(v.name) }; preview(v) },
                ) {
                    RadioButton(selected = s.ttsVoice == v.name, onClick = {
                        scope.launch { repo.setTtsVoice(v.name) }; preview(v)
                    })
                    Text(
                        text = "${v.name}(${v.locale.displayName})",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            if (voices.isEmpty()) {
                Text(
                    "没有找到本地中文音色,可在系统设置里给 TTS 引擎下载中文语音包",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { EarpieceService.start(context) }) {
                Text("启动播报服务")
            }
            OutlinedButton(onClick = { EarpieceService.stop(context) }) {
                Text("停止")
            }
        }
        Text(
            text = "已订阅项目: " +
                s.subscribedProjects.sorted().joinToString("、").ifEmpty { "无(在主页点铃铛订阅)" },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = "v1 为前台服务轮询 + 本机 TTS;FCM 推送通道二期接入。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
