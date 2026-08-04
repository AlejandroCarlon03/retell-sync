using System.Text.Json;
using System.Text.Json.Nodes;

namespace RetellSync.Dashboard;

/// <summary>
/// Locates and reads <c>conversion.json</c> for the API endpoints.
/// </summary>
/// <remarks>
/// Read-only: the host never writes the file or calls any external service. The
/// full payload is passed through <em>verbatim</em> (not re-serialized) so the
/// JSON-safe numbers written by <c>retell_sync/output.py</c> reach the browser
/// exactly as produced. Resolution runs per request, so a <c>conversion.json</c>
/// generated after startup is picked up on the next refresh.
/// </remarks>
public static class ConversionSource
{
    /// <summary>
    /// Resolve the conversion.json path: (1) CLI arg, (2) env
    /// <c>RETELL_SYNC_CONVERSION_JSON</c>, (3) <c>&lt;repo&gt;/outputs/conversion.json</c>
    /// if it exists, (4) the bundled dev sample. The returned path may not exist —
    /// the endpoints report a 404 with the resolved path in that case.
    /// </summary>
    public static string Resolve(DashboardOptions options)
    {
        if (!string.IsNullOrWhiteSpace(options.ConversionPath))
        {
            return Path.GetFullPath(options.ConversionPath);
        }

        var env = Environment.GetEnvironmentVariable("RETELL_SYNC_CONVERSION_JSON");
        if (!string.IsNullOrWhiteSpace(env))
        {
            return Path.GetFullPath(env);
        }

        var repo = FindRepoRoot();
        if (repo is not null)
        {
            var outputs = Path.Combine(repo, "outputs", "conversion.json");
            if (File.Exists(outputs))
            {
                return outputs;
            }
            return Path.Combine(repo, "samples", "conversion.sample.json");
        }

        return Path.GetFullPath("conversion.json");
    }

    /// <summary>Return the full payload verbatim, or a 404 if missing/unparseable.</summary>
    public static IResult ReadRaw(string path)
    {
        if (!File.Exists(path))
        {
            return NotFound(path);
        }

        string text;
        try
        {
            text = File.ReadAllText(path);
            using var _ = JsonDocument.Parse(text); // validate only
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            return Unparseable(path, ex);
        }

        return Results.Content(text, "application/json");
    }

    /// <summary>Return only <c>{ generated_at, window, kpis }</c> — a light header poll.</summary>
    public static IResult ReadStats(string path)
    {
        if (!File.Exists(path))
        {
            return NotFound(path);
        }

        JsonNode? node;
        try
        {
            node = JsonNode.Parse(File.ReadAllText(path));
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            return Unparseable(path, ex);
        }

        if (node is null)
        {
            return Unparseable(path, null);
        }

        var stats = new JsonObject
        {
            ["generated_at"] = node["generated_at"]?.DeepClone(),
            ["window"] = node["window"]?.DeepClone(),
            ["kpis"] = node["kpis"]?.DeepClone(),
        };
        return Results.Content(stats.ToJsonString(), "application/json");
    }

    private static IResult NotFound(string path) =>
        Results.Json(
            new { error = "conversion.json not found", resolvedPath = path },
            statusCode: StatusCodes.Status404NotFound);

    private static IResult Unparseable(string path, Exception? ex) =>
        Results.Json(
            new { error = $"conversion.json is unparseable: {ex?.Message ?? "empty document"}", resolvedPath = path },
            statusCode: StatusCodes.Status404NotFound);

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
