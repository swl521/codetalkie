package com.example.codetalkie

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.MutableState
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.codetalkie.data.PairCode
import com.example.codetalkie.ui.ChatScreen
import com.example.codetalkie.ui.HomeScreen
import com.example.codetalkie.ui.HomeViewModel
import com.example.codetalkie.ui.SettingsScreen
import com.example.codetalkie.ui.theme.CodeTalkieTheme

class MainActivity : ComponentActivity() {

    private val notifPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* 拒绝也能用,只是没常驻通知 */ }

    // 配对深链(codetalkie://pair?code=XXXXXX)带来的配对码,供 Settings 页自动 claim
    private val pendingPairCode: MutableState<String?> = androidx.compose.runtime.mutableStateOf(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) {
            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        pendingPairCode.value = PairCode.extract(intent?.dataString)
        setContent {
            CodeTalkieTheme {
                AppRoot(
                    pairCode = pendingPairCode.value,
                    onPairCodeConsumed = { pendingPairCode.value = null },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        PairCode.extract(intent.dataString)?.let { pendingPairCode.value = it }
    }
}

private enum class Tab { Home, Settings }

@Composable
private fun AppRoot(
    homeViewModel: HomeViewModel = viewModel(),
    pairCode: String? = null,
    onPairCodeConsumed: () -> Unit = {},
) {
    var tab by remember { mutableStateOf(Tab.Home) }
    var openProject by remember { mutableStateOf<String?>(null) }

    // 深链带来配对码时,自动切到设置页让用户看到绑定结果
    androidx.compose.runtime.LaunchedEffect(pairCode) {
        if (pairCode != null) {
            openProject = null
            tab = Tab.Settings
        }
    }

    val project = openProject
    if (project != null) {
        // 对话页全屏覆盖,系统返回键回主页
        BackHandler { openProject = null }
        ChatScreen(projectName = project, onBack = { openProject = null })
        return
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = tab == Tab.Home,
                    onClick = { tab = Tab.Home },
                    icon = { Icon(Icons.Filled.Home, contentDescription = stringResource(R.string.tab_home)) },
                    label = { Text(stringResource(R.string.tab_home)) },
                )
                NavigationBarItem(
                    selected = tab == Tab.Settings,
                    onClick = { tab = Tab.Settings },
                    icon = { Icon(Icons.Filled.Settings, contentDescription = stringResource(R.string.tab_settings)) },
                    label = { Text(stringResource(R.string.tab_settings)) },
                )
                NavigationBarItem(
                    selected = false,
                    onClick = { homeViewModel.refresh() },
                    icon = { Icon(Icons.Filled.Refresh, contentDescription = stringResource(R.string.tab_refresh)) },
                    label = { Text(stringResource(R.string.tab_refresh)) },
                )
            }
        },
    ) { padding ->
        when (tab) {
            Tab.Home -> HomeScreen(
                viewModel = homeViewModel,
                onOpenProject = { openProject = it },
                modifier = Modifier.padding(padding),
            )

            Tab.Settings -> SettingsScreen(
                modifier = Modifier.padding(padding),
                pairCode = pairCode,
                onPairCodeConsumed = onPairCodeConsumed,
            )
        }
    }
}
