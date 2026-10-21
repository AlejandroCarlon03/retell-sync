using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

namespace RetellSync.Dashboard;

/// <summary>A newer installer the update feed advertises.</summary>
/// <param name="Version">The release's version, e.g. <c>1.0.1</c>.</param>
/// <param name="InstallerUrl">Absolute URL of the setup exe (same server as the feed).</param>
/// <param name="Sha256">Lower-case hex SHA-256 of the setup exe.</param>
/// <param name="Notes">Optional one-line release notes for the prompt.</param>
public sealed record UpdateInfo(string Version, Uri InstallerUrl, string Sha256, string? Notes);

/// <summary>
/// The app's version, and — for the viewer — whether a newer one is published and
/// how to install it.
/// </summary>
/// <remarks>
/// The feed is a small <c>latest.json</c> on the internal server that already
/// publishes the report (<c>&lt;data url&gt;/updates/latest.json</c>, written by
/// <c>scripts/Publish-Update.ps1</c>):
/// <code>{ "version": "1.0.1", "file": "RetellDashboard-Viewer-Setup-1.0.1.exe",
///   "sha256": "…", "notes": "…" }</code>
/// <c>file</c> resolves against the feed URL and must stay on the feed's server, so
/// the app only ever runs an installer published next to the feed. Installing
/// downloads it to %TEMP%, checks the SHA-256, starts it with <c>/SILENT</c> plus
/// <c>/RELAUNCH=1</c> (the installer reopens the app when it finishes), and asks
/// the host to exit. The admin app (built from source) has no feed unless
/// <c>RETELL_DASHBOARD_UPDATE_URL</c> is set; it only reports its version.
/// </remarks>
public sealed class UpdateService
{
    private static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(30);

    private readonly HttpClient _http;
    private readonly Uri? _feedUrl;
    private readonly ILogger _logger;
    private readonly Action _exitApp;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private (DateTimeOffset At, UpdateInfo? Info, string? Error)? _cached;
    private int _installing;

    public UpdateService(HttpClient http, Uri? feedUrl, ILogger logger, Action exitApp)
    {
        _http = http;
        _feedUrl = feedUrl;
        _logger = logger;
        _exitApp = exitApp;
    }

    /// <summary>This build's version (the csproj <c>&lt;Version&gt;</c>), e.g. <c>1.0.0</c>.</summary>
    public static string CurrentVersion { get; } = ReadCurrentVersion();

    /// <summary>
    /// The feed for this run: env <c>RETELL_DASHBOARD_UPDATE_URL</c>, else
    /// <c>updates/latest.json</c> under the viewer's data URL, else none.
    /// </summary>
    public static Uri? ResolveFeedUrl(DashboardOptions options)
    {
        var env = Environment.GetEnvironmentVariable("RETELL_DASHBOARD_UPDATE_URL");
        if (!string.IsNullOrWhiteSpace(env) && Uri.TryCreate(env.Trim(), UriKind.Absolute, out var custom)
            && (custom.Scheme == Uri.UriSchemeHttp || custom.Scheme == Uri.UriSchemeHttps))
        {
            return custom;
        }
        return options.DataUrl is { } dataUrl ? new Uri(dataUrl, "updates/latest.json") : null;
    }

    /// <summary>The newest published release if it's newer than this one (cached for 30 minutes).</summary>
    public async Task<(UpdateInfo? Update, string? Error)> CheckAsync(CancellationToken ct)
    {
        if (_feedUrl is null)
        {
            return (null, null);
        }

        await _gate.WaitAsync(ct);
        try
        {
            if (_cached is { } c && DateTimeOffset.Now - c.At < CacheFor)
            {
                return (c.Info, c.Error);
            }

            UpdateInfo? info = null;
            string? error = null;
            try
            {
                using var resp = await _http.GetAsync(_feedUrl, ct);
                if (resp.IsSuccessStatusCode)
                {
                    var latest = ParseFeed(await resp.Content.ReadAsStringAsync(ct), _feedUrl);
                    info = latest is not null && IsNewer(latest.Version, CurrentVersion) ? latest : null;
                }
                else if (resp.StatusCode != System.Net.HttpStatusCode.NotFound)
                {
                    error = $"The update server returned {(int)resp.StatusCode}.";
                }
                // 404: nothing published yet — not an error.
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or FormatException)
            {
                error = ex is FormatException ? ex.Message : "Couldn't reach the update server.";
            }

            _cached = (DateTimeOffset.Now, info, error);
            return (info, error);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// Download, verify and launch the advertised installer, then exit the app.
    /// Returns an error message, or null once the installer is running.
    /// </summary>
    public async Task<string?> InstallAsync(CancellationToken ct)
    {
        var (update, error) = await CheckAsync(ct);
        if (update is null)
        {
            return error ?? "There's no newer version to install.";
        }
        if (Interlocked.Exchange(ref _installing, 1) == 1)
        {
            return "The update is already being installed.";
        }

        var failure = await DownloadAndLaunchAsync(update, ct);
        if (failure is not null)
        {
            Interlocked.Exchange(ref _installing, 0); // a failed download or check can retry
        }
        return failure;
    }

    private async Task<string?> DownloadAndLaunchAsync(UpdateInfo update, CancellationToken ct)
    {
        try
        {
            var dir = Path.Combine(Path.GetTempPath(), "RetellDashboard-update");
            Directory.CreateDirectory(dir);
            var setup = Path.Combine(dir, $"RetellDashboard-Viewer-Setup-{update.Version}.exe");

            using (var resp = await _http.GetAsync(update.InstallerUrl, HttpCompletionOption.ResponseHeadersRead, ct))
            {
                if (!resp.IsSuccessStatusCode)
                {
                    return $"Downloading the update failed ({(int)resp.StatusCode}).";
                }
                await using var file = File.Create(setup);
                await resp.Content.CopyToAsync(file, ct);
            }

            if (!HashMatches(setup, update.Sha256))
            {
                File.Delete(setup);
                return "The downloaded update didn't match its published checksum, so it wasn't run.";
            }

            _logger.LogInformation("Installing update {Version} from {Url}", update.Version, update.InstallerUrl);
            Process.Start(new ProcessStartInfo(setup)
            {
                UseShellExecute = true,
                Arguments = "/SILENT /SUPPRESSMSGBOXES /NORESTART /RELAUNCH=1",
            });

            // Let the response reach the window, then get out of the installer's way.
            _ = Task.Delay(TimeSpan.FromSeconds(1.5)).ContinueWith(_ => _exitApp(), TaskScheduler.Default);
            return null;
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException or UnauthorizedAccessException
                                       or TaskCanceledException or System.ComponentModel.Win32Exception)
        {
            return $"The update couldn't be installed: {ex.Message}";
        }
    }

    /// <summary>
    /// Parse a <c>latest.json</c>. Throws <see cref="FormatException"/> for a feed that
    /// is malformed, or whose installer points off the feed's own server.
    /// </summary>
    public static UpdateInfo? ParseFeed(string json, Uri feedUrl)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            string? Str(string name) =>
                root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

            var version = Str("version");
            var file = Str("file");
            var sha = Str("sha256");
            if (version is null || file is null || sha is null
                || !Version.TryParse(version, out _)
                || sha.Length != 64 || !sha.All(Uri.IsHexDigit))
            {
                throw new FormatException("The update feed is incomplete or malformed.");
            }

            var url = new Uri(feedUrl, file);
            if (!string.Equals(url.GetLeftPart(UriPartial.Authority), feedUrl.GetLeftPart(UriPartial.Authority),
                    StringComparison.OrdinalIgnoreCase))
            {
                throw new FormatException("The update feed points at an installer on another server.");
            }
            return new UpdateInfo(version, url, sha.ToLowerInvariant(), Str("notes"));
        }
        catch (JsonException)
        {
            throw new FormatException("The update feed isn't valid JSON.");
        }
    }

    /// <summary>True when <paramref name="candidate"/> is a strictly newer version.</summary>
    public static bool IsNewer(string candidate, string current) =>
        Version.TryParse(candidate, out var a) && Version.TryParse(current, out var b) && Normalize(a) > Normalize(b);

    private static Version Normalize(Version v) =>
        new(v.Major, v.Minor, Math.Max(v.Build, 0), Math.Max(v.Revision, 0));

    private static bool HashMatches(string path, string expectedHex)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).Equals(expectedHex, StringComparison.OrdinalIgnoreCase);
    }

    private static string ReadCurrentVersion()
    {
        var info = typeof(UpdateService).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        // The SDK may append "+<commit>"; the prompt only needs the release number.
        return info?.Split('+')[0] ?? typeof(UpdateService).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
    }
}
