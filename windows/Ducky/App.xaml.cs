using System.Threading;
using System.Windows;
using Application = System.Windows.Application; // disambiguate from WinForms (UseWindowsForms=true)

namespace Ducky;

/// <summary>
/// Entry point. Headless WPF app: no main window, the tray icon is the whole UI.
/// On startup it (1) ensures ~/.earpiece config exists, (2) registers HKCU Run
/// for auto-start, (3) spawns the bundled node daemon, (4) shows the tray icon.
/// </summary>
public partial class App : Application
{
    private static Mutex? _singleInstance;

    private TrayController? _tray;
    private NodeRunner? _node;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // Single-instance guard: a second launch just exits (tray would collide).
        _singleInstance = new Mutex(initiallyOwned: true, "com.example.codetalkie.desktop.singleton", out bool fresh);
        if (!fresh)
        {
            Shutdown();
            return;
        }

        // 1. Config: write default relay.json if missing, ensure account key exists.
        Config.EnsureDefaults();

        // 2. Auto-start on login (idempotent).
        try { AutoStart.Enable(); } catch { /* non-fatal */ }

        // 3. Launch the embedded node daemon (node.exe + agent/, no system node).
        _node = new NodeRunner();
        _node.Start();

        // 4. Tray icon + context menu. This is the only visible surface.
        _tray = new TrayController(_node);
        _tray.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _tray?.Dispose();
        _node?.Stop();
        _singleInstance?.ReleaseMutex();
        base.OnExit(e);
    }
}
