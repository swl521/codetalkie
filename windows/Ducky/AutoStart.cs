using System.Diagnostics;
using Microsoft.Win32;

namespace Ducky;

/// <summary>
/// Login auto-start via the per-user Run key:
///   HKCU\Software\Microsoft\Windows\CurrentVersion\Run  value "Ducky" = "&lt;exe path&gt;"
/// Per-user means no admin/UAC needed — fits a zero-friction client install.
/// </summary>
public static class AutoStart
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "Ducky"; // 答鸭 Ducky

    private static string ExePath =>
        Process.GetCurrentProcess().MainModule!.FileName;

    public static void Enable()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true)
                        ?? Registry.CurrentUser.CreateSubKey(RunKey);
        key.SetValue(ValueName, $"\"{ExePath}\"");
    }

    public static void Disable()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
        key?.DeleteValue(ValueName, throwOnMissingValue: false);
    }

    public static bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: false);
        return key?.GetValue(ValueName) is not null;
    }
}
