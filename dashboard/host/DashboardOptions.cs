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

    public static DashboardOptions Parse(string[] args)
    {
        string? path = null;
        int? port = null;
        var noWindow = false;

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

        return new DashboardOptions
        {
            ConversionPath = path,
            Url = $"http://127.0.0.1:{port ?? 0}",
            NoWindow = noWindow,
        };
    }
}
