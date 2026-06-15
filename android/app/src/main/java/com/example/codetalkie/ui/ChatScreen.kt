package com.example.codetalkie.ui

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.codetalkie.R
import com.example.codetalkie.data.HistoryLine
import com.example.codetalkie.data.RelayClient
import com.example.codetalkie.data.SettingsRepository
import com.example.codetalkie.ui.theme.UserBubbleBlue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ChatViewModel(app: Application) : AndroidViewModel(app) {

    private val settingsRepo = SettingsRepository(app)

    private val _lines = MutableStateFlow<List<HistoryLine>>(emptyList())
    val lines: StateFlow<List<HistoryLine>> = _lines.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _sending = MutableStateFlow(false)
    val sending: StateFlow<Boolean> = _sending.asStateFlow()

    suspend fun refresh(project: String) {
        try {
            val s = settingsRepo.current()
            _lines.value = RelayClient(s.relayUrl, s.bearer).fetchHistory(project)
            _error.value = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _error.value = e.message
        }
    }

    /** 强制同步:戳电脑重扫重推该项目,稍等再拉——治「连中继都落后」。 */
    fun forceSync(project: String) {
        viewModelScope.launch {
            try {
                val s = settingsRepo.current()
                RelayClient(s.relayUrl, s.bearer).resync(project)
                delay(700L)            // 给电脑重扫+重推一点时间
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _error.value = e.message
            }
            refresh(project)
        }
    }

    /** 发指令:自动加项目名前缀,POST /command {"text":"项目名 指令"}。 */
    fun send(project: String, text: String) {
        if (text.isBlank()) return
        viewModelScope.launch {
            _sending.value = true
            try {
                val s = settingsRepo.current()
                RelayClient(s.relayUrl, s.bearer).sendCommand("$project $text")
                refresh(project)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _error.value = e.message
            } finally {
                _sending.value = false
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    projectName: String,
    onBack: () -> Unit,
    viewModel: ChatViewModel = viewModel(),
) {
    val lines by viewModel.lines.collectAsState()
    val error by viewModel.error.collectAsState()
    val sending by viewModel.sending.collectAsState()
    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    // 4 秒轮询字幕
    LaunchedEffect(projectName) {
        while (true) {
            viewModel.refresh(projectName)
            delay(4_000L)
        }
    }

    // 新行自动滚到底
    LaunchedEffect(lines.size) {
        if (lines.isNotEmpty()) listState.animateScrollToItem(lines.size - 1)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(projectName) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.chat_back),
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.forceSync(projectName) }) {  // 强制同步:戳电脑重推
                        Icon(Icons.Filled.Refresh, contentDescription = "强制同步")
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            error?.let { err ->
                Text(
                    text = err,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }

            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(lines) { line -> SubtitleBubble(line) }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text(stringResource(R.string.chat_input_placeholder, projectName)) },
                    maxLines = 3,
                )
                Spacer(Modifier.width(8.dp))
                IconButton(
                    onClick = {
                        viewModel.send(projectName, input.trim())
                        input = ""
                    },
                    enabled = !sending && input.isNotBlank(),
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = stringResource(R.string.chat_send),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}

private val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault())

@Composable
private fun SubtitleBubble(line: HistoryLine) {
    when (line.role) {
        "event" -> {
            // 居中胶囊
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text(
                    text = line.text,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                )
            }
        }

        "user" -> {
            // 右侧蓝色
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                BubbleBody(
                    line = line,
                    background = UserBubbleBlue,
                    textColor = Color.White,
                )
            }
        }

        else -> {
            // assistant:左侧灰色
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
                BubbleBody(
                    line = line,
                    background = MaterialTheme.colorScheme.surfaceVariant,
                    textColor = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun BubbleBody(line: HistoryLine, background: Color, textColor: Color) {
    Column(
        modifier = Modifier
            .widthIn(max = 300.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(background)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(
            text = line.text,
            style = MaterialTheme.typography.bodyMedium,
            color = textColor,
        )
        if (line.ts > 0) {
            Text(
                text = timeFormat.format(Date(line.ts)) + (line.src?.let { " · $it" } ?: ""),
                style = MaterialTheme.typography.labelSmall,
                color = textColor.copy(alpha = 0.7f),
            )
        }
    }
}
