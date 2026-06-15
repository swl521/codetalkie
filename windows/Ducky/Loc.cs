using System.Globalization;

namespace Ducky;

/// <summary>
/// 极简中英:系统 UI 语言是英文就给英文,否则中文。WinForms/WPF 不自动本地化菜单文案,
/// 故和 macOS 菜单栏的 L("中","En") 一样内联手搓,保持两端一致。
/// </summary>
public static class Loc
{
    private static readonly bool IsEN =
        CultureInfo.CurrentUICulture.TwoLetterISOLanguageName
            .Equals("en", StringComparison.OrdinalIgnoreCase);

    public static string L(string zh, string en) => IsEN ? en : zh;
}
