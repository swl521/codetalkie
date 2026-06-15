using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace Ducky;

/// <summary>Pairing-code result from POST {relay}/pair/offer.</summary>
public sealed record PairCode(string Code, int ExpiresInSec)
{
    /// <summary>Deep link encoded into the QR image: codetalkie://pair?code=XXXXXX</summary>
    public string DeepLink => $"codetalkie://pair?code={Code}";
    public string Pretty => Code.Length == 6 ? $"{Code[..3]} {Code[3..]}" : Code;
}

/// <summary>
/// Thin client over the relay. Mirrors agent/src/account.js requestPairCode:
/// POST {relay}/pair/offer  Authorization: Bearer &lt;accountKey&gt;  body {}
///   -> { code, expiresInSec }
/// </summary>
public sealed class RelayClient
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };

    /// <summary>Request a fresh 6-digit pairing code from the primary relay.</summary>
    public static async Task<PairCode> RequestPairCodeAsync(CancellationToken ct = default)
    {
        var relay = Config.PrimaryRelay().TrimEnd('/');
        var key = Config.ResolveAccountKey();

        using var req = new HttpRequestMessage(HttpMethod.Post, $"{relay}/pair/offer")
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json"),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);

        using var resp = await Http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"配对发码失败 HTTP {(int)resp.StatusCode}");

        var json = JsonNode.Parse(await resp.Content.ReadAsStringAsync(ct))!.AsObject();
        var code = json["code"]?.GetValue<string>() ?? throw new InvalidOperationException("relay returned no code");
        var ttl = json["expiresInSec"]?.GetValue<int>() ?? 600;
        return new PairCode(code, ttl);
    }

    /// <summary>
    /// Best-effort connection check: the daemon listens on 127.0.0.1:7780 once up.
    /// Returns true if the local daemon answers /status.
    /// </summary>
    public static async Task<bool> LocalDaemonAliveAsync(CancellationToken ct = default)
    {
        try
        {
            using var resp = await Http.GetAsync("http://127.0.0.1:7780/status", ct);
            return resp.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    /// <summary>这个账户绑了几台手机(中继 /status 的 devices 字段)。失败回 -1。</summary>
    public static async Task<int> BoundDeviceCountAsync(CancellationToken ct = default)
    {
        try
        {
            var relay = Config.PrimaryRelay().TrimEnd('/');
            var key = Config.ResolveAccountKey();
            using var req = new HttpRequestMessage(HttpMethod.Get, $"{relay}/status");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
            using var resp = await Http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode) return -1;
            var json = JsonNode.Parse(await resp.Content.ReadAsStringAsync(ct))!.AsObject();
            return json["devices"]?.GetValue<int>() ?? 0;
        }
        catch { return -1; }
    }
}
