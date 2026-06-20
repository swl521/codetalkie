using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows.Forms; // NotifyIcon / ContextMenuStrip
using Application = System.Windows.Application;

namespace Ducky;

/// <summary>
/// System-tray presence + right-click menu. There is no main window; this is the
/// entire interactive surface of the app.
///
/// Menu:  连接状态 (disabled status line) | 配对码 / 绑定二维码 | 刷新码 | 开机自启 ✓ | 退出
/// </summary>
public sealed class TrayController : IDisposable
{
    private readonly NodeRunner _node;
    private readonly NotifyIcon _icon;
    private readonly ToolStripMenuItem _statusItem;
    private readonly ToolStripMenuItem _devicesItem;
    private readonly ToolStripMenuItem _autoStartItem;
    private readonly System.Windows.Forms.Timer _statusTimer;

    private PairWindow? _pairWindow;

    public TrayController(NodeRunner node)
    {
        _node = node;

        _icon = new NotifyIcon
        {
            Text = "答鸭 Ducky",
            Icon = LoadTrayIcon(),
            Visible = false,
        };

        var menu = new ContextMenuStrip();

        _statusItem = new ToolStripMenuItem(Loc.L("连接状态:检测中…", "Status: checking…")) { Enabled = false };
        menu.Items.Add(_statusItem);
        _devicesItem = new ToolStripMenuItem(Loc.L("已绑定:— 台手机", "Paired phones: —")) { Enabled = false };
        menu.Items.Add(_devicesItem);
        menu.Items.Add(new ToolStripSeparator());

        var pairItem = new ToolStripMenuItem(Loc.L("配对码 / 绑定二维码…", "Pair code / QR…"), null, (_, _) => ShowPairWindow());
        menu.Items.Add(pairItem);

        var refreshItem = new ToolStripMenuItem(Loc.L("绑定新手机(出一个新码)", "Pair a new phone (new code)"), null, (_, _) => ShowPairWindow(forceNew: true));
        menu.Items.Add(refreshItem);

        menu.Items.Add(new ToolStripSeparator());

        // 在终端继续:开一个带 agent-hub 通道的 claude 终端,让这个窗口注册成 hub 会话、
        // 能直接收手机指令(成为主线程)。子菜单按 ~/.earpiece/sessions.json 现读现建。
        var resumeItem = new ToolStripMenuItem(Loc.L("在终端继续", "Continue in Terminal"));
        resumeItem.DropDownOpening += (_, _) => RebuildSessionsSubmenu(resumeItem);
        resumeItem.DropDownItems.Add(new ToolStripMenuItem(Loc.L("(展开看会话)", "(open to list sessions)")) { Enabled = false });
        menu.Items.Add(resumeItem);

        menu.Items.Add(new ToolStripSeparator());

        _autoStartItem = new ToolStripMenuItem(Loc.L("开机自启", "Launch at login"), null, (_, _) => ToggleAutoStart())
        {
            Checked = SafeIsAutoStart(),
            CheckOnClick = false,
        };
        menu.Items.Add(_autoStartItem);

        var restartItem = new ToolStripMenuItem(Loc.L("重启后台服务", "Restart background service"), null, (_, _) => _node.Restart());
        menu.Items.Add(restartItem);

        menu.Items.Add(new ToolStripSeparator());

        var quitItem = new ToolStripMenuItem(Loc.L("退出", "Quit"), null, (_, _) => Quit());
        menu.Items.Add(quitItem);

        _icon.ContextMenuStrip = menu;
        _icon.DoubleClick += (_, _) => ShowPairWindow();

        // Poll connection status every 5s and reflect it in the status line + tooltip.
        _statusTimer = new System.Windows.Forms.Timer { Interval = 5000 };
        _statusTimer.Tick += async (_, _) => await RefreshStatusAsync();
    }

    public void Show()
    {
        _icon.Visible = true;
        _ = RefreshStatusAsync();
        _statusTimer.Start();
    }

    // 每次改动都 bump,用户靠它确认软件真的更新了
    private const string AppVersion = "0.1.7 · 0620a(stats+主脑+cowork)";

    private async Task RefreshStatusAsync()
    {
        bool alive = await RelayClient.LocalDaemonAliveAsync();
        _statusItem.Text = (alive ? Loc.L("连接状态:运行中", "Status: running") : Loc.L("连接状态:未运行", "Status: not running")) + $" · v{AppVersion}";
        _icon.Text = alive ? Loc.L("答鸭 Ducky · 运行中", "Ducky · running") : Loc.L("答鸭 Ducky · 未运行", "Ducky · not running");
        _autoStartItem.Checked = SafeIsAutoStart();

        var devices = await RelayClient.BoundDevicesAsync();
        _devicesItem.DropDownItems.Clear();
        if (devices == null)
        {
            _devicesItem.Text = Loc.L("已绑定:连接中继查不到", "Paired: relay unreachable");
        }
        else if (devices.Count == 0)
        {
            _devicesItem.Text = Loc.L("还没绑定手机 — 让手机扫配对二维码", "No phones paired — scan the QR code");
        }
        else
        {
            _devicesItem.Text = Loc.L($"已绑定:{devices.Count} 台手机", $"Paired phones: {devices.Count}");
            foreach (var d in devices)
            {
                var name = d.Name;
                var sfx = Suffix(name);
                var idPart = sfx.Length == 0 ? "" : $" ({sfx})";
                var it = new ToolStripMenuItem($"📱 {ShortName(name)}{idPart}  ·  {RelTime(d.LastSeen)}   ✕")
                {
                    ToolTipText = Loc.L("点击解绑这台手机", "Click to unbind this phone")
                };
                it.Click += async (_, _) =>
                {
                    var yes = MessageBox.Show(
                        Loc.L($"解绑「{ShortName(name)}」?它将不再收到播报和批准。", $"Unbind \"{ShortName(name)}\"? It will stop receiving broadcasts and approvals."),
                        Loc.L("解绑手机", "Unbind phone"),
                        MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes;
                    if (!yes) return;
                    await RelayClient.UnbindAsync(name);
                    await RefreshStatusAsync();
                };
                _devicesItem.DropDownItems.Add(it);
            }
        }
    }

    // 设备名 "Miles 的 iPhone·1a2b3c4d" → 去掉 ·后缀
    private static string ShortName(string s) => s.Split('·')[0];

    // ·后缀(vendorID 前8位)——两台同名手机靠它区分
    private static string Suffix(string s)
    {
        var i = s.IndexOf('·');
        return i >= 0 && i + 1 < s.Length ? s[(i + 1)..] : "";
    }

    // 毫秒时间戳 → 相对时间
    private static string RelTime(long ms)
    {
        if (ms <= 0) return Loc.L("未知", "unknown");
        var sec = (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - ms) / 1000;
        if (sec < 60) return Loc.L("刚刚", "just now");
        if (sec < 3600) return Loc.L($"{sec / 60} 分钟前", $"{sec / 60}m ago");
        if (sec < 86400) return Loc.L($"{sec / 3600} 小时前", $"{sec / 3600}h ago");
        return Loc.L($"{sec / 86400} 天前", $"{sec / 86400}d ago");
    }

    private void ShowPairWindow(bool forceNew = false)
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            if (_pairWindow is { IsLoaded: true } && !forceNew)
            {
                _pairWindow.Activate();
                return;
            }
            _pairWindow?.Close();
            _pairWindow = new PairWindow();
            _pairWindow.Closed += (_, _) => _pairWindow = null;
            _pairWindow.Show();
            _pairWindow.Activate();
        });
    }

    private void ToggleAutoStart()
    {
        try
        {
            if (AutoStart.IsEnabled()) AutoStart.Disable();
            else AutoStart.Enable();
        }
        catch { /* non-fatal */ }
        _autoStartItem.Checked = SafeIsAutoStart();
    }

    private static bool SafeIsAutoStart()
    {
        try { return AutoStart.IsEnabled(); } catch { return false; }
    }

    private void Quit()
    {
        _statusTimer.Stop();
        _icon.Visible = false;
        Application.Current.Shutdown();
    }

    /// <summary>现读 ~/.earpiece/sessions.json("项目@目录":sessionId)重建「在终端继续」子菜单。</summary>
    private void RebuildSessionsSubmenu(ToolStripMenuItem parent)
    {
        parent.DropDownItems.Clear();
        try
        {
            string path = Path.Combine(Config.Dir, "sessions.json");
            if (File.Exists(path)
                && JsonNode.Parse(File.ReadAllText(path)) is JsonObject map && map.Count > 0)
            {
                foreach (var kv in map.OrderBy(k => k.Key))
                {
                    string sessionId = kv.Value?.GetValue<string>() ?? "";
                    if (sessionId.Length == 0) continue;
                    var parts = kv.Key.Split('@', 2);
                    string project = parts[0];
                    string dir = parts.Length > 1 ? parts[1] : Config.Dir;
                    parent.DropDownItems.Add(new ToolStripMenuItem(
                        $"{project} — {dir}", null, (_, _) => ResumeSession(dir, sessionId)));
                }
                if (parent.DropDownItems.Count > 0) return;
            }
        }
        catch { /* 落到下面的空提示 */ }
        parent.DropDownItems.Add(new ToolStripMenuItem(Loc.L("(暂无会话)", "(no sessions)")) { Enabled = false });
    }

    /// <summary>
    /// 开一个终端跑 claude,带上 agent-hub 通道 —— 这个终端才会注册成 hub 会话、能直接收
    /// 手机指令(成为主线程)。优先 Windows Terminal,没有就退回 cmd。和 macOS 的「在终端继续」对齐。
    /// </summary>
    private static void ResumeSession(string dir, string sessionId)
    {
        string claudeCmd = $"claude --dangerously-load-development-channels server:agent-hub --resume {sessionId}";
        try
        {
            // wt.exe -d <dir> cmd /k "<claude…>"  (Windows Terminal 在指定目录开一个标签)
            Process.Start(new ProcessStartInfo
            {
                FileName = "wt.exe",
                Arguments = $"-d \"{dir}\" cmd /k \"{claudeCmd}\"",
                UseShellExecute = true,
            });
        }
        catch
        {
            // 没装 Windows Terminal → 退回 cmd.exe
            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/k cd /d \"{dir}\" && {claudeCmd}",
                UseShellExecute = true,
            });
        }
    }

    /// <summary>Load the packed app icon; fall back to the system app icon.</summary>
    private static Icon LoadTrayIcon()
    {
        try
        {
            var uri = new Uri("pack://application:,,,/Assets/ducky.ico", UriKind.Absolute);
            var info = Application.GetResourceStream(uri);
            if (info != null) return new Icon(info.Stream);
        }
        catch { /* fall through */ }
        return SystemIcons.Application;
    }

    public void Dispose()
    {
        _statusTimer.Dispose();
        _icon.Dispose();
    }
}
