using System.Diagnostics;
using System.IO;

namespace Ducky;

/// <summary>
/// Owns the bundled node daemon process. Uses the node.exe that ships *inside*
/// the app (runtime\node\node.exe) and the agent copied alongside
/// (runtime\agent\src\daemon.js) — never the system node, so a clean client box
/// with no Node installed still works.
///
/// Layout next to Ducky.exe after publish:
///   Ducky.exe
///   runtime\node\node.exe
///   runtime\agent\src\daemon.js
///   runtime\agent\lang\*.json
/// </summary>
public sealed class NodeRunner
{
    private Process? _proc;

    public string AppDir =>
        Path.GetDirectoryName(Process.GetCurrentProcess().MainModule!.FileName)
        ?? AppContext.BaseDirectory;

    public string NodeExe => Path.Combine(AppDir, "runtime", "node", "node.exe");
    public string DaemonJs => Path.Combine(AppDir, "runtime", "agent", "src", "daemon.js");

    private string LogPath => Path.Combine(Config.Dir, "daemon.log");

    public bool IsRunning => _proc is { HasExited: false };

    /// <summary>True if the bundled runtime is actually present (vs. a bare build).</summary>
    public bool RuntimeStaged => File.Exists(NodeExe) && File.Exists(DaemonJs);

    public void Start()
    {
        if (IsRunning) return;
        if (!RuntimeStaged)
        {
            // Dev build without staged runtime: log and bail rather than crash.
            TryLog($"[Ducky] runtime not staged (node={File.Exists(NodeExe)}, daemon={File.Exists(DaemonJs)}); daemon not started.");
            return;
        }

        Directory.CreateDirectory(Config.Dir);

        var psi = new ProcessStartInfo
        {
            FileName = NodeExe,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Path.Combine(AppDir, "runtime", "agent"),
        };
        psi.ArgumentList.Add(DaemonJs);

        _proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        _proc.OutputDataReceived += (_, e) => { if (e.Data != null) TryLog(e.Data); };
        _proc.ErrorDataReceived += (_, e) => { if (e.Data != null) TryLog(e.Data); };
        _proc.Start();
        _proc.BeginOutputReadLine();
        _proc.BeginErrorReadLine();
    }

    public void Restart()
    {
        Stop();
        Start();
    }

    public void Stop()
    {
        try
        {
            if (_proc is { HasExited: false })
            {
                _proc.Kill(entireProcessTree: true);
                _proc.WaitForExit(3000);
            }
        }
        catch { /* best effort */ }
        finally { _proc?.Dispose(); _proc = null; }
    }

    private void TryLog(string line)
    {
        try { File.AppendAllText(LogPath, line + Environment.NewLine); }
        catch { /* logging must never throw */ }
    }
}
