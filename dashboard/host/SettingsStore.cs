using System.Text.Json;
using System.Text.Json.Serialization;

namespace RetellSync.Dashboard;

/// <summary>
/// Runtime alert settings — the recipient list, SLA window, and on/off switch that
/// a successor edits from the dashboard's Settings page without touching code or
/// env. Persisted as <c>data/alert_settings.json</c> (snake_case keys) so the
/// Python config layer (<c>retell_sync.config.load_alert_settings</c>) reads the
/// exact same file. Deliberately holds no secrets: the Microsoft Graph credentials
/// and sender mailbox stay in the machine environment.
/// </summary>
public sealed record AlertSettings
{
    [JsonPropertyName("recipients")]
    public string[] Recipients { get; init; } = [];

    [JsonPropertyName("sla_hours")]
    public double SlaHours { get; init; } = DefaultSlaHours;

    [JsonPropertyName("enabled")]
    public bool Enabled { get; init; }

    /// <summary>Matches <c>AlertConfig.sla_hours</c> so the UI opens on the real default.</summary>
    public const double DefaultSlaHours = 48.0;
}

/// <summary>
/// Locates, reads, and writes the alert-settings JSON for the <c>/api/settings</c>
/// endpoints. Unlike <see cref="ConversionSource"/> this store also *writes*, but
/// only ever this one small, secret-free file, and only from the localhost-bound
/// host (the static IIS viewer never mounts these routes).
/// </summary>
public static class SettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    /// <summary>
    /// Resolve the settings path: (1) env <c>RETELL_SYNC_ALERT_SETTINGS</c>, else
    /// (2) <c>&lt;repo&gt;/data/alert_settings.json</c> — the same data directory
    /// Python resolves. The file need not exist yet; <see cref="Read"/> returns
    /// defaults and <see cref="Write"/> creates it (and the directory) on first save.
    /// </summary>
    public static string Resolve(DashboardOptions options)
    {
        var env = Environment.GetEnvironmentVariable("RETELL_SYNC_ALERT_SETTINGS");
        if (!string.IsNullOrWhiteSpace(env))
        {
            return Path.GetFullPath(env);
        }

        var repo = FindRepoRoot();
        var baseDir = repo ?? Directory.GetCurrentDirectory();
        return Path.Combine(baseDir, "data", ALERT_SETTINGS_FILENAME);
    }

    /// <summary>The shared filename, mirrored in <c>retell_sync.config.ALERT_SETTINGS_FILENAME</c>.</summary>
    public const string ALERT_SETTINGS_FILENAME = "alert_settings.json";

    // --- Pure model helpers (unit-tested via the roundtrip) ------------------ #

    /// <summary>
    /// Read and sanitize the settings at <paramref name="path"/>. A missing or
    /// unparseable file yields the defaults (no recipients, 48h, disabled) so the
    /// editor always has a valid shape to render.
    /// </summary>
    public static AlertSettings Read(string path)
    {
        if (!File.Exists(path))
        {
            return new AlertSettings();
        }

        try
        {
            var parsed = JsonSerializer.Deserialize<AlertSettings>(File.ReadAllText(path), JsonOptions);
            return Sanitize(parsed ?? new AlertSettings());
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            return new AlertSettings();
        }
    }

    /// <summary>
    /// Sanitize and persist <paramref name="settings"/> to <paramref name="path"/>,
    /// creating the data directory if needed, and return the cleaned value that was
    /// written (so the caller/UI reflects exactly what was stored).
    /// </summary>
    public static AlertSettings Write(string path, AlertSettings settings)
    {
        var clean = Sanitize(settings);
        var dir = Path.GetDirectoryName(Path.GetFullPath(path));
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }
        File.WriteAllText(path, JsonSerializer.Serialize(clean, JsonOptions));
        return clean;
    }

    /// <summary>
    /// Normalize a settings value: trim recipients and drop blanks/dupes, floor the
    /// SLA to a positive number (falling back to the default when non-positive).
    /// </summary>
    public static AlertSettings Sanitize(AlertSettings settings)
    {
        var recipients = (settings.Recipients ?? [])
            .Where(r => !string.IsNullOrWhiteSpace(r))
            .Select(r => r.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var sla = settings.SlaHours > 0 ? settings.SlaHours : AlertSettings.DefaultSlaHours;

        return settings with { Recipients = recipients, SlaHours = sla };
    }

    // --- Endpoint adapters --------------------------------------------------- #

    /// <summary>GET handler: return the current settings as JSON.</summary>
    public static IResult ReadResult(string path) =>
        Results.Json(Read(path), JsonOptions);

    /// <summary>
    /// PUT handler: parse the request body as settings, sanitize + persist it, and
    /// echo back the stored value. A malformed body is a 400; an IO failure a 500.
    /// </summary>
    public static async Task<IResult> WriteResult(string path, HttpRequest request)
    {
        AlertSettings? incoming;
        try
        {
            incoming = await request.ReadFromJsonAsync<AlertSettings>(JsonOptions);
        }
        catch (JsonException ex)
        {
            return Results.Json(new { error = $"invalid settings body: {ex.Message}" },
                statusCode: StatusCodes.Status400BadRequest);
        }

        if (incoming is null)
        {
            return Results.Json(new { error = "settings body is required" },
                statusCode: StatusCodes.Status400BadRequest);
        }

        try
        {
            var written = Write(path, incoming);
            return Results.Json(written, JsonOptions);
        }
        catch (IOException ex)
        {
            return Results.Json(new { error = $"could not save settings: {ex.Message}", resolvedPath = path },
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    /// <summary>Walk up from the running binary to the repo root (marked by pyproject.toml).</summary>
    private static string? FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "pyproject.toml")))
            {
                return dir.FullName;
            }
            dir = dir.Parent;
        }
        return null;
    }
}
