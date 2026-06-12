package com.example.codetalkie.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.settingsStore by preferencesDataStore(name = "earpiece_settings")

data class EarpieceSettings(
    val relayUrl: String,
    val token: String,
    val announceEnabled: Boolean,
    val ttsRate: Float,
    val ttsVoice: String,   // 系统 TTS 音色 Voice.name,空 = 引擎默认
    val ttsMode: String,    // "system" 系统 TTS | "edge" 微软云端神经语音(免费)
    val edgeVoice: String,  // 云端音色,如 zh-CN-XiaoxiaoNeural
    val subscribedProjects: Set<String>,
)

/** 应用设置,DataStore Preferences 持久化。 */
class SettingsRepository(private val context: Context) {

    private object Keys {
        val RELAY_URL = stringPreferencesKey("relay_url")
        val TOKEN = stringPreferencesKey("token")
        val ANNOUNCE_ENABLED = booleanPreferencesKey("announce_enabled")
        val TTS_RATE = floatPreferencesKey("tts_rate")
        val TTS_VOICE = stringPreferencesKey("tts_voice")
        val TTS_MODE = stringPreferencesKey("tts_mode")
        val EDGE_VOICE = stringPreferencesKey("edge_voice")
        val SUBSCRIBED_PROJECTS = stringSetPreferencesKey("subscribed_projects")
    }

    companion object {
        /** 占位地址,真实 relay 域名由用户在设置页填写。 */
        const val DEFAULT_RELAY_URL = "https://your-relay.example.com"
        const val DEFAULT_TTS_RATE = 1.0f
        const val MODE_SYSTEM = "system"
        const val MODE_EDGE = "edge"
        const val DEFAULT_EDGE_VOICE = "zh-CN-XiaoxiaoNeural" // 晓晓
    }

    val settings: Flow<EarpieceSettings> = context.settingsStore.data.map { p ->
        EarpieceSettings(
            relayUrl = p[Keys.RELAY_URL] ?: DEFAULT_RELAY_URL,
            token = p[Keys.TOKEN] ?: "",
            announceEnabled = p[Keys.ANNOUNCE_ENABLED] ?: true,
            ttsRate = p[Keys.TTS_RATE] ?: DEFAULT_TTS_RATE,
            ttsVoice = p[Keys.TTS_VOICE] ?: "",
            ttsMode = p[Keys.TTS_MODE] ?: MODE_SYSTEM,
            edgeVoice = p[Keys.EDGE_VOICE] ?: DEFAULT_EDGE_VOICE,
            subscribedProjects = p[Keys.SUBSCRIBED_PROJECTS] ?: emptySet(),
        )
    }

    suspend fun current(): EarpieceSettings = settings.first()

    suspend fun setRelayUrl(value: String) {
        context.settingsStore.edit { it[Keys.RELAY_URL] = value }
    }

    suspend fun setToken(value: String) {
        context.settingsStore.edit { it[Keys.TOKEN] = value }
    }

    suspend fun setAnnounceEnabled(value: Boolean) {
        context.settingsStore.edit { it[Keys.ANNOUNCE_ENABLED] = value }
    }

    suspend fun setTtsRate(value: Float) {
        context.settingsStore.edit { it[Keys.TTS_RATE] = value }
    }

    suspend fun setTtsVoice(value: String) {
        context.settingsStore.edit { it[Keys.TTS_VOICE] = value }
    }

    suspend fun setTtsMode(value: String) {
        context.settingsStore.edit { it[Keys.TTS_MODE] = value }
    }

    suspend fun setEdgeVoice(value: String) {
        context.settingsStore.edit { it[Keys.EDGE_VOICE] = value }
    }

    suspend fun toggleSubscription(project: String) {
        context.settingsStore.edit { p ->
            val cur = p[Keys.SUBSCRIBED_PROJECTS] ?: emptySet()
            p[Keys.SUBSCRIBED_PROJECTS] =
                if (project in cur) cur - project else cur + project
        }
    }
}
