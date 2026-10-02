using System.Reflection;

namespace RetellSync.Dashboard;

/// <summary>
/// Startup options parsed from CLI args and environment.
/// </summary>
/// <remarks>
/// The conversion-file path resolution order (CLI arg &gt; env &gt; outputs &gt;
/// sample) lives in <see cref="ConversionSource.Resolve"/>; this type only
/// captures the raw inputs. Port 0 means "let the OS pick" — the Photino window
/// then loads whatever address the server actually bound to. A fixed port (via
/// <c>--port</c> or <c>DASHBOARD_PORT</c>) is used for <c>npm run dev</c>, whose
/// Vite proxy targets a known port.
/// </remarks>
public sealed class DashboardOptions
{
    /// <summary>Explicit conversion.json path from a CLI arg (highest priority).</summary>
    public string? ConversionPath { get; init; }

    /// <summary>The URL Kestrel binds to. Port 0 = OS-assigned ephemeral port.</summary>
    public string Url { get; init; } = "http://127.0.0.1:0";

    /// <summary>When true, serve the API without opening a window (CI / headless).</summary>
    public bool NoWindow { get; init; }

    /// <summary>
    /// When true, the window does not pull fresh data on launch (<c>--no-refresh</c>
    /// or <c>DASHBOARD_NO_REFRESH=1</c>) — e.g. <c>Retell-Dashboard.cmd</c>, which
    /// has already pulled in its console. Headless mode never auto-refreshes.
    /// </summary>
    public bool NoRefresh { get; init; }

    /// <summary>
    /// Viewer mode: where the published <c>conversion.json</c> / <c>history.json</c>
    /// live (the server's internal web viewer). Set, in priority order, by
    /// <c>--data-url</c>, env <c>RETELL_DASHBOARD_DATA_URL</c>, or the URL baked into
    /// a viewer build by <c>Publish-App.ps1 -Viewer</c>. When set, the app reads that
    /// data instead of a local checkout: no Python, no API keys, no admin pages.
    /// </summary>
    public Uri? DataUrl { get; init; }

    /// <summary>True for the shareable read-only viewer (see <see cref="DataUrl"/>).</summary>
    public bool IsViewer => DataUrl is not null;

    public static DashboardOptions Parse(string[] args)
    {
        string? path = null;
        int? port = null;
        var noWindow = false;
        var noRefresh = false;
        string? dataUrl = null;

        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];
            if ((arg is "--conversion" or "-c") && i + 1 < args.Length)
            {
                path = args[++i];
            }
            else if (arg.StartsWith("--conversion=", StringComparison.Ordinal))
            {
                path = arg["--conversion=".Length..];
            }
            else if ((arg is "--port" or "-p") && i + 1 < args.Length && int.TryParse(args[i + 1], out var p))
            {
                port = p;
                i++;
            }
            else if (arg.StartsWith("--port=", StringComparison.Ordinal) && int.TryParse(arg["--port=".Length..], out var pv))
            {
                port = pv;
            }
            else if (arg is "--no-window")
            {
                noWindow = true;
            }
            else if (arg is "--no-refresh")
            {
                noRefresh = true;
            }
            else if (arg is "--data-url" && i + 1 < args.Length)
            {
                dataUrl = args[++i];
            }
            else if (arg.StartsWith("--data-url=", StringComparison.Ordinal))
            {
                dataUrl = arg["--data-url=".Length..];
            }
            else if (path is null && !arg.StartsWith('-'))
            {
                path = arg; // positional conversion path
            }
        }

        if (port is null && int.TryParse(Environment.GetEnvironmentVariable("DASHBOARD_PORT"), out var envPort))
        {
            port = envPort;
        }
        if (!noWindow && Environment.GetEnvironmentVariable("DASHBOARD_NO_WINDOW") is "1" or "true")
        {
            noWindow = true;
        }
        if (Environment.GetEnvironmentVariable("DASHBOARD_NO_REFRESH") is "1" or "true")
        {
            noRefresh = true;
        }

        return new DashboardOptions
        {
            ConversionPath = path,
            Url = $"http://127.0.0.1:{port ?? 0}",
            NoWindow = noWindow,
            NoRefresh = noRefresh,
            DataUrl = ParseDataUrl(
                dataUrl
                ?? Environment.GetEnvironmentVariable("RETELL_DASHBOARD_DATA_URL")
                ?? BakedDataUrl()),
        };
    }

    /// <summary>An absolute http(s) base URL, always ending in '/' so file names append.</summary>
    public static Uri? ParseDataUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }
        var text = value.Trim();
        if (!text.EndsWith('/'))
        {
            text += "/";
        }
        return Uri.TryCreate(text, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
            ? uri
            : null;
    }

    /// <summary>The data URL a viewer build carries (csproj ViewerDataUrl → assembly metadata).</summary>
    private static string? BakedDataUrl() =>
        typeof(DashboardOptions).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(a => a.Key == "ViewerDataUrl")?.Value;
}
