using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Ducky;

/// <summary>
/// Mirrors agent/src/account.js + the relay.json contract on the C# side.
/// Lives in %USERPROFILE%\.earpiece (the Windows equivalent of ~/.earpiece that
/// the node daemon already reads via os.homedir()).
///
///   relay.json   { "urls": ["https://your-relay.example.com","https://your-relay.example.com"] }
///   account.json { "accountKey": "&lt;64 hex chars&gt;" }
/// </summary>
public static class Config
{
    public static string Dir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".earpiece");

    public static string RelayPath => Path.Combine(Dir, "relay.json");
    public static string AccountPath => Path.Combine(Dir, "account.json");

    // Shipped default relay endpoints (turn = primary, apple = backup). No real token.
    private static readonly string[] DefaultRelays =
    {
        "https://your-relay.example.com",
        "https://your-relay.example.com",
    };

    /// <summary>Write relay.json if it does not exist; ensure an account key exists.</summary>
    public static void EnsureDefaults()
    {
        Directory.CreateDirectory(Dir);

        if (!File.Exists(RelayPath))
        {
            var obj = new JsonObject { ["urls"] = new JsonArray(DefaultRelays.Select(u => (JsonNode)u!).ToArray()) };
            File.WriteAllText(RelayPath, obj.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        }

        _ = ResolveAccountKey(); // side effect: generates + persists account.json if absent
    }

    /// <summary>Primary relay base URL (first non-empty of urls, or legacy url).</summary>
    public static string PrimaryRelay()
    {
        var node = JsonNode.Parse(File.ReadAllText(RelayPath))!.AsObject();
        if (node.TryGetPropertyValue("urls", out var urls) && urls is JsonArray arr)
        {
            foreach (var u in arr)
            {
                var s = u?.GetValue<string>();
                if (!string.IsNullOrWhiteSpace(s)) return s!;
            }
        }
        if (node.TryGetPropertyValue("url", out var single) && single is not null)
            return single.GetValue<string>();
        throw new InvalidOperationException("relay.json has no usable url");
    }

    public static string[] AllRelays()
    {
        var node = JsonNode.Parse(File.ReadAllText(RelayPath))!.AsObject();
        if (node.TryGetPropertyValue("urls", out var urls) && urls is JsonArray arr)
            return arr.Select(u => u?.GetValue<string>()).Where(s => !string.IsNullOrWhiteSpace(s)).Cast<string>().ToArray();
        if (node.TryGetPropertyValue("url", out var single) && single is not null)
            return new[] { single.GetValue<string>() };
        return Array.Empty<string>();
    }

    /// <summary>
    /// Account key resolution, identical priority to agent/src/account.js:
    ///   1) account.json.accountKey
    ///   2) relay.json.token (legacy dev machines) -> migrate into account.json
    ///   3) generate 256-bit key, persist to account.json
    /// </summary>
    public static string ResolveAccountKey()
    {
        if (File.Exists(AccountPath))
        {
            try
            {
                var k = JsonNode.Parse(File.ReadAllText(AccountPath))?["accountKey"]?.GetValue<string>();
                if (!string.IsNullOrEmpty(k)) return k!;
            }
            catch { /* corrupt -> regenerate */ }
        }

        if (File.Exists(RelayPath))
        {
            try
            {
                var t = JsonNode.Parse(File.ReadAllText(RelayPath))?["token"]?.GetValue<string>();
                if (!string.IsNullOrEmpty(t) && t!.Length >= 16) { SaveAccountKey(t); return t; }
            }
            catch { /* ignore */ }
        }

        var key = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant(); // 64 hex
        SaveAccountKey(key);
        return key;
    }

    private static void SaveAccountKey(string key)
    {
        Directory.CreateDirectory(Dir);
        var obj = new JsonObject { ["accountKey"] = key };
        File.WriteAllText(AccountPath, obj.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }
}
