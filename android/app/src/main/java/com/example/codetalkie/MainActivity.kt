package com.example.codetalkie

import android.Manifest
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
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.codetalkie.ui.ChatScreen
import com.example.codetalkie.ui.HomeScreen
import com.example.codetalkie.ui.HomeViewModel
import com.example.codetalkie.ui.SettingsScreen
import com.example.codetalkie.ui.theme.CodeTalkieTheme

class MainActivity : ComponentActivity() {

    private val notifPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* 拒绝也能用,只是没常驻通知 */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) {
            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent {
            CodeTalkieTheme {
                AppRoot()
            }
        }
    }
}

private enum class Tab { Home, Settings }

@Composable
private fun AppRoot(homeViewModel: HomeViewModel = viewModel()) {
    var tab by remember { mutableStateOf(Tab.Home) }
    var openProject by remember { mutableStateOf<String?>(null) }

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
                    icon = { Icon(Icons.Filled.Home, contentDescription = "主页") },
                    label = { Text("主页") },
                )
                NavigationBarItem(
                    selected = tab == Tab.Settings,
                    onClick = { tab = Tab.Settings },
                    icon = { Icon(Icons.Filled.Settings, contentDescription = "设置") },
                    label = { Text("设置") },
                )
                NavigationBarItem(
                    selected = false,
                    onClick = { homeViewModel.refresh() },
                    icon = { Icon(Icons.Filled.Refresh, contentDescription = "刷新") },
                    label = { Text("刷新") },
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

            Tab.Settings -> SettingsScreen(modifier = Modifier.padding(padding))
        }
    }
}
