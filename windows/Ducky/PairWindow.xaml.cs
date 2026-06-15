using System.IO;
using System.Windows;
using System.Windows.Media.Imaging;
using QRCoder;

namespace Ducky;

/// <summary>
/// Pairing window: fetches a 6-digit code from the relay and shows it plus a QR
/// of codetalkie://pair?code=XXXXXX so the phone app can scan or type it.
/// </summary>
public partial class PairWindow : Window
{
    public PairWindow()
    {
        InitializeComponent();
        // 跟随系统语言设标题与说明(XAML 里写的是中文兜底)。
        Title = Loc.L("答鸭 Ducky — 绑定电脑", "Ducky — Pair a computer");
        TitleHeader.Text = Loc.L("绑定电脑", "Pair a computer");
        SubtitleText.Text = Loc.L("手机「答鸭」→ 绑定电脑 → 扫码或输入 6 位码",
                                  "Phone “Ducky” → Pair a computer → scan or enter the 6-digit code");
        Loaded += async (_, _) => await LoadCodeAsync();
    }

    private async Task LoadCodeAsync()
    {
        try
        {
            HintText.Text = Loc.L("正在获取配对码…", "Fetching pair code…");
            var pair = await RelayClient.RequestPairCodeAsync();

            CodeText.Text = pair.Pretty;
            QrImage.Source = RenderQr(pair.DeepLink);
            var mins = Math.Max(1, (int)Math.Round(pair.ExpiresInSec / 60.0));
            HintText.Text = Loc.L($"{mins} 分钟内有效,用过即失效", $"valid for {mins} min, single use");
        }
        catch (Exception ex)
        {
            CodeText.Text = "— — —";
            HintText.Text = Loc.L($"获取失败:{ex.Message}", $"Failed: {ex.Message}");
        }
    }

    /// <summary>QRCoder -> PNG bytes -> WPF BitmapImage.</summary>
    private static BitmapImage RenderQr(string content)
    {
        using var gen = new QRCodeGenerator();
        using var data = gen.CreateQrCode(content, QRCodeGenerator.ECCLevel.Q);
        var png = new PngByteQRCode(data).GetGraphic(20);

        var img = new BitmapImage();
        using var ms = new MemoryStream(png);
        img.BeginInit();
        img.CacheOption = BitmapCacheOption.OnLoad;
        img.StreamSource = ms;
        img.EndInit();
        img.Freeze();
        return img;
    }
}
