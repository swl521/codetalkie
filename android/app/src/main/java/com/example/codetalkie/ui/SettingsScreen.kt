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
import android.content.Intent
import android.net.Uri
import com.example.codetalkie.data.RelayClient
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.example.codetalkie.R
import com.example.codetalkie.data.SettingsRepository
import com.example.codetalkie.service.EarpieceService
import com.example.codetalkie.tts.EdgePlayer
import com.example.codetalkie.tts.EdgeTts
import kotlinx.coroutines.launch
import java.util.Locale

@Composable
fun SettingsScreen(
    modifier: Modifier = Modifier,
    pairCode: String? = null,
    onPairCodeConsumed: () -> Unit = {},
) {
    val context = LocalContext.current
    val repo = remember { SettingsRepository(context.applicationContext) }
    val scope = rememberCoroutineScope()
    val settings by repo.settings.collectAsState(initial = null)

    var url by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var rate by remember { mutableFloatStateOf(SettingsRepository.DEFAULT_TTS_RATE) }
    var loaded by remember { mutableStateOf(false) }
    var proMsg by remember { mutableStateOf("") }

    // 朗读语言跟随语言包:tts_locale 资源(如 zh-CN / en-US)
    val ttsLocale = remember { Locale.forLanguageTag(context.getString(R.string.tts_locale)) }
    // 部分引擎用 ISO 639-3 报中文为 "cmn"
    val ttsLanguages = remember(ttsLocale) {
        if (ttsLocale.language == "zh") setOf("zh", "cmn") else setOf(ttsLocale.language)
    }

    // 音色列表:临时 TTS 实例枚举当前语言的音色(选中即试听);随组合体生命周期释放
    var voices by remember { mutableStateOf<List<Voice>>(emptyList()) }
    var previewTts by remember { mutableStateOf<TextToSpeech?>(null) }
    DisposableEffect(Unit) {
        var t: TextToSpeech? = null
        t = TextToSpeech(context) { st ->
            if (st == TextToSpeech.SUCCESS) {
                t?.language = ttsLocale
                voices = t?.voices.orEmpty()
                    .filter { v -> v.locale.language in ttsLanguages && !v.isNetworkConnectionRequired }
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
            p.speak(context.getString(R.string.tts_preview_system), TextToSpeech.QUEUE_FLUSH, null, "preview")
        }
    }
    // 云端试听(微软 Edge 神经语音)
    val edgePlayer = remember { EdgePlayer(context.applicationContext) }
    fun previewEdge(voice: String) {
        edgePlayer.enqueue(context.getString(R.string.tts_preview_edge), voice, rate)
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
        PairingSection(
            settings = s,
            repo = repo,
            prefillCode = pairCode,
            onPrefillConsumed = onPairCodeConsumed,
        )

        HorizontalDivider()

        // 会员:免费=局域网;Pro=公网中继(随时随地远程)。Android 走 Stripe 网页结账。
        Text("会员", style = MaterialTheme.typography.titleMedium)
        Text(
            "免费版:和电脑同一 WiFi 时局域网直连。Pro:公网中继,出门用流量也能连。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Button(
            onClick = {
                scope.launch {
                    proMsg = "正在打开结账页…"
                    val u = RelayClient(s.relayUrl, s.bearer).proCheckout()
                    if (u != null) {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u)))
                        proMsg = "已在浏览器打开,付完回来即生效"
                    } else {
                        proMsg = "暂不可用(中继还没配置 Stripe?稍后再试)"
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("升级 Pro · \$4.99/月") }
        if (proMsg.isNotBlank()) {
            Text(proMsg, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        }

        HorizontalDivider()

        Text(stringResource(R.string.settings_section_connection), style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text(stringResource(R.string.settings_relay_url)) },
            placeholder = { Text(SettingsRepository.DEFAULT_RELAY_URL) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            label = { Text(stringResource(R.string.settings_token)) },
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
            Text(stringResource(R.string.settings_save_connection))
        }

        HorizontalDivider()

        Text(stringResource(R.string.settings_section_earpiece), style = MaterialTheme.typography.titleMedium)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.settings_announce_enabled), modifier = Modifier.weight(1f))
            Switch(
                checked = s.announceEnabled,
                onCheckedChange = { v -> scope.launch { repo.setAnnounceEnabled(v) } },
            )
        }
        Text(
            stringResource(R.string.settings_tts_rate, "%.1f".format(rate)),
            style = MaterialTheme.typography.bodyMedium,
        )
        Slider(
            value = rate,
            onValueChange = { rate = it },
            onValueChangeFinished = { scope.launch { repo.setTtsRate(rate) } },
            valueRange = 0.5f..2.0f,
            steps = 14,
        )
        Text(stringResource(R.string.settings_voice_engine), style = MaterialTheme.typography.bodyMedium)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth()
                .clickable { scope.launch { repo.setTtsMode(SettingsRepository.MODE_EDGE) } },
        ) {
            RadioButton(selected = s.ttsMode == SettingsRepository.MODE_EDGE, onClick = {
                scope.launch { repo.setTtsMode(SettingsRepository.MODE_EDGE) }
            })
            Column {
                Text(stringResource(R.string.settings_engine_edge), style = MaterialTheme.typography.bodyMedium)
                Text(stringResource(R.string.settings_engine_edge_desc), style = MaterialTheme.typography.bodySmall,
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
                Text(stringResource(R.string.settings_engine_system), style = MaterialTheme.typography.bodyMedium)
                Text(stringResource(R.string.settings_engine_system_desc), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        Text(stringResource(R.string.settings_voice_section), style = MaterialTheme.typography.bodyMedium)
        if (s.ttsMode == SettingsRepository.MODE_EDGE) {
            EdgeTts.VOICES.forEach { (name, labelRes) ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                        .clickable { scope.launch { repo.setEdgeVoice(name) }; previewEdge(name) },
                ) {
                    RadioButton(selected = s.edgeVoice == name, onClick = {
                        scope.launch { repo.setEdgeVoice(name) }; previewEdge(name)
                    })
                    Text(stringResource(labelRes), style = MaterialTheme.typography.bodyMedium)
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
                Text(stringResource(R.string.settings_voice_system_default), style = MaterialTheme.typography.bodyMedium)
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
                    stringResource(R.string.settings_no_local_voices),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { EarpieceService.start(context) }) {
                Text(stringResource(R.string.settings_start_service))
            }
            OutlinedButton(onClick = { EarpieceService.stop(context) }) {
                Text(stringResource(R.string.settings_stop_service))
            }
        }
        val listSeparator = stringResource(R.string.list_separator)
        val subscribedNone = stringResource(R.string.settings_subscribed_none)
        Text(
            text = stringResource(
                R.string.settings_subscribed_projects,
                s.subscribedProjects.sorted().joinToString(listSeparator).ifEmpty { subscribedNone },
            ),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = stringResource(R.string.settings_v1_note),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        // 版本号:便于确认装的是第几版、更新到没
        val appVer = remember {
            runCatching {
                val pi = context.packageManager.getPackageInfo(context.packageName, 0)
                @Suppress("DEPRECATION")
                "答鸭 v${pi.versionName} (build ${pi.versionCode})"
            }.getOrDefault("答鸭 v?")
        }
        Text(
            text = appVer,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
