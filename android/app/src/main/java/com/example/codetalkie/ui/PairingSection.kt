package com.example.codetalkie.ui

import android.Manifest
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.example.codetalkie.R
import com.example.codetalkie.data.EarpieceSettings
import com.example.codetalkie.data.PairError
import com.example.codetalkie.data.PairException
import com.example.codetalkie.data.RelayClient
import com.example.codetalkie.data.SettingsRepository
import kotlinx.coroutines.launch

/**
 * 「绑定电脑」配对区。调用方:SettingsScreen 顶部。
 * 未绑定:6 位数字输入框 + 绑定按钮 + 扫码按钮 → claim → 存 accountKey。
 * 已绑定:显示「已绑定 ✓」+ 解绑按钮(清 accountKey)。
 * relayUrl 取自传入的当前设置;为占位/空时提示先填地址。
 *
 * @param prefillCode 深链带来的配对码(MainActivity 解析后传入),非空时自动尝试 claim。
 */
@Composable
fun PairingSection(
    settings: EarpieceSettings,
    repo: SettingsRepository,
    modifier: Modifier = Modifier,
    prefillCode: String? = null,
    onPrefillConsumed: () -> Unit = {},
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var showScanner by remember { mutableStateOf(false) }

    val needRelayMsg = stringResource(R.string.pairing_need_relay)
    val successMsg = stringResource(R.string.pairing_success)
    val cameraDeniedMsg = stringResource(R.string.pairing_camera_denied)

    fun relayReady(): Boolean =
        settings.relayUrl.isNotBlank() && settings.relayUrl != SettingsRepository.DEFAULT_RELAY_URL

    fun errorText(e: PairException): String = when (e.kind) {
        PairError.INVALID -> context.getString(R.string.pairing_error_invalid)
        PairError.RATE_LIMITED -> context.getString(R.string.pairing_error_rate)
        PairError.NETWORK -> context.getString(R.string.pairing_error_network)
    }

    fun doClaim(raw: String) {
        if (busy) return
        if (!relayReady()) {
            Toast.makeText(context, needRelayMsg, Toast.LENGTH_SHORT).show()
            return
        }
        scope.launch {
            busy = true
            try {
                val key = RelayClient.claim(settings.relayUrl, raw)
                repo.setAccountKey(key)
                code = ""
                Toast.makeText(context, successMsg, Toast.LENGTH_SHORT).show()
            } catch (e: PairException) {
                Toast.makeText(context, errorText(e), Toast.LENGTH_LONG).show()
            } finally {
                busy = false
            }
        }
    }

    // 深链/扫码带来的配对码:自动 claim 一次
    LaunchedEffect(prefillCode) {
        val c = prefillCode
        if (!c.isNullOrBlank()) {
            doClaim(c)
            onPrefillConsumed()
        }
    }

    val cameraLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) showScanner = true
        else Toast.makeText(context, cameraDeniedMsg, Toast.LENGTH_SHORT).show()
    }

    fun launchScanner() {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) showScanner = true
        else cameraLauncher.launch(Manifest.permission.CAMERA)
    }

    if (showScanner) {
        Box(modifier = Modifier.fillMaxSize()) {
            QrScannerScreen(
                onCode = { scanned ->
                    showScanner = false
                    doClaim(scanned)
                },
                modifier = Modifier.fillMaxSize(),
            )
            TextButton(
                onClick = { showScanner = false },
                modifier = Modifier.align(Alignment.TopStart).padding(8.dp),
            ) { Text(stringResource(R.string.chat_back)) }
        }
        return
    }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(stringResource(R.string.pairing_section), style = MaterialTheme.typography.titleMedium)

        if (settings.isPaired) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.pairing_bound),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.weight(1f),
                )
                OutlinedButton(onClick = { scope.launch { repo.clearAccountKey() } }) {
                    Text(stringResource(R.string.pairing_unbind))
                }
            }
        } else {
            Text(
                stringResource(R.string.pairing_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = code,
                onValueChange = { v -> code = v.filter { it.isDigit() }.take(6) },
                label = { Text(stringResource(R.string.pairing_code_label)) },
                placeholder = { Text(stringResource(R.string.pairing_code_placeholder)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.fillMaxWidth(),
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(
                    onClick = { doClaim(code) },
                    enabled = !busy && code.length == 6,
                ) {
                    if (busy) {
                        CircularProgressIndicator(
                            modifier = Modifier.padding(end = 8.dp),
                            strokeWidth = 2.dp,
                        )
                    }
                    Text(stringResource(R.string.pairing_bind))
                }
                OutlinedButton(onClick = { launchScanner() }, enabled = !busy) {
                    Text(stringResource(R.string.pairing_scan))
                }
            }
        }
    }
}
