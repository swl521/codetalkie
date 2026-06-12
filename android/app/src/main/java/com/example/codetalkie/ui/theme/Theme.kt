package com.example.codetalkie.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// 引擎品牌色:Claude 橙 / Codex 绿 / Hermes 紫
val ClaudeOrange = Color(0xFFD97757)
val CodexGreen = Color(0xFF10A37F)
val HermesPurple = Color(0xFF8B5CF6)
val UnknownGray = Color(0xFF6B7280)

// 对话气泡
val UserBubbleBlue = Color(0xFF2962FF)

fun engineColor(agent: String): Color = when (agent.lowercase()) {
    "claude" -> ClaudeOrange
    "codex" -> CodexGreen
    "hermes" -> HermesPurple
    else -> UnknownGray
}

private val DarkColors = darkColorScheme(primary = ClaudeOrange)
private val LightColors = lightColorScheme(primary = ClaudeOrange)

@Composable
fun CodeTalkieTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        content = content,
    )
}
