package com.example.codetalkie.ui

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.codetalkie.R
import com.example.codetalkie.data.ProjectEntry
import com.example.codetalkie.data.RelayClient
import com.example.codetalkie.data.SettingsRepository
import com.example.codetalkie.service.EarpieceService
import com.example.codetalkie.ui.theme.engineColor
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HomeUiState(
    val loading: Boolean = false,
    val error: String? = null,
    /** agent -> 该引擎下的项目列表 */
    val groups: Map<String, List<ProjectEntry>> = emptyMap(),
    /** 项目名 -> 最后一句(副标题) */
    val lastLines: Map<String, String> = emptyMap(),
    val onlineMachines: List<String> = emptyList(),
    val subscribed: Set<String> = emptySet(),
)

class HomeViewModel(app: Application) : AndroidViewModel(app) {

    private val settingsRepo = SettingsRepository(app)
    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            settingsRepo.settings.collect { s ->
                _state.value = _state.value.copy(subscribed = s.subscribedProjects)
            }
        }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            try {
                val s = settingsRepo.current()
                val client = RelayClient(s.relayUrl, s.bearer)
                coroutineScope {
                    val registry = async { client.fetchRegistry() }
                    val lasts = async { runCatching { client.fetchProjects() }.getOrDefault(emptyList()) }
                    val machines = async { runCatching { client.fetchStatus() }.getOrDefault(emptyList()) }
                    _state.value = _state.value.copy(
                        loading = false,
                        groups = registry.await().groupBy { it.agent.ifBlank { "unknown" } },
                        lastLines = lasts.await().associate { it.name to it.last },
                        onlineMachines = machines.await().map { it.name },
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    loading = false,
                    error = e.message ?: getApplication<Application>().getString(R.string.error_network),
                )
            }
        }
    }

    /** 订阅 = 耳机播报跟踪该项目;有订阅时确保前台服务在跑。 */
    fun toggleSubscription(project: String) {
        viewModelScope.launch {
            settingsRepo.toggleSubscription(project)
            val s = settingsRepo.current()
            if (s.subscribedProjects.isNotEmpty()) {
                EarpieceService.start(getApplication())
            }
        }
    }
}

@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onOpenProject: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsState()
    val collapsed = remember { mutableStateMapOf<String, Boolean>() }

    Column(modifier = modifier.fillMaxSize()) {
        // 标题 + 在线机器
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.app_name),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.width(12.dp))
            Text(
                text = if (state.onlineMachines.isEmpty()) stringResource(R.string.home_no_online_machines)
                else stringResource(
                    R.string.home_online_machines,
                    state.onlineMachines.joinToString(stringResource(R.string.list_separator)),
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        state.error?.let { err ->
            Text(
                text = err,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }

        if (state.loading && state.groups.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Column
        }

        LazyColumn(modifier = Modifier.fillMaxSize()) {
            state.groups.forEach { (agent, projects) ->
                item(key = "header-$agent") {
                    EngineGroupHeader(
                        agent = agent,
                        count = projects.size,
                        collapsed = collapsed[agent] == true,
                        onToggle = { collapsed[agent] = collapsed[agent] != true },
                    )
                }
                if (collapsed[agent] != true) {
                    // name 可重名(claude/codex 同名项目,needsRename 机制),key 必须带 agent+machine+cwd
                    items(projects, key = { "project-${it.agent}-${it.machine}-${it.cwd}-${it.name}" }) { project ->
                        ProjectRow(
                            project = project,
                            lastLine = state.lastLines[project.name],
                            subscribed = project.name in state.subscribed,
                            onClick = { onOpenProject(project.name) },
                            onToggleSubscribe = { viewModel.toggleSubscription(project.name) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun EngineGroupHeader(
    agent: String,
    count: Int,
    collapsed: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(engineColor(agent))
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = agent.replaceFirstChar { it.uppercase() },
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = engineColor(agent),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = "$count",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.weight(1f))
        Icon(
            imageVector = if (collapsed) Icons.Filled.KeyboardArrowDown else Icons.Filled.KeyboardArrowUp,
            contentDescription = if (collapsed) stringResource(R.string.action_expand)
            else stringResource(R.string.action_collapse),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ProjectRow(
    project: ProjectEntry,
    lastLine: String?,
    subscribed: Boolean,
    onClick: () -> Unit,
    onToggleSubscribe: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(start = 28.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = project.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = project.machine,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                text = lastLine ?: project.cwd,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(onClick = onToggleSubscribe) {
            Icon(
                imageVector = Icons.Filled.Notifications,
                contentDescription = if (subscribed) stringResource(R.string.action_unsubscribe)
                else stringResource(R.string.action_subscribe),
                tint = if (subscribed) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.outline,
            )
        }
    }
}
