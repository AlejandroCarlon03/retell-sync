using System.Text.Json;

namespace RetellSync.Dashboard;

/// <summary>
/// Locates and reads <c>history.json</c> — the append-only per-run KPI history the
/// Python <c>run</c> command upserts (see <c>retell_sync/output.py</c>
/// <c>append_history</c>) — for the <c>/api/history</c> endpoint that backs the
/// dashboard's Trends Over Time page.
/// </summary>
/// <remarks>
/// Read-only, and passed through verbatim like <see cref="EmailLogSource"/>. The
/// file sits next to <c>conversion.json</c> in the same <c>outputs/</c> directory,
/// so resolution reuses <see cref="ConversionSource.Resolve"/> and swaps the
/// filename — one env override (<c>RETELL_SYNC_HISTORY_JSON</c>) still wins.
/// <para>
/// A <em>missing</em> file returns an empty array with 200, not a 404: no history
/// yet is the normal state before the first daily <c>run</c> lands, so the page
/// shows its "collecting history" empty state rather than an error. Only a
/// present-but-unparseable file is surfaced as an error.
/// </para>
/// </remarks>
public static class HistorySource
{
    private const string HistoryFilename = "history.json";

    /// <summary>
    /// Resolve the history.json path: env <c>RETELL_SYNC_HISTORY_JSON</c> if set,
    /// else the sibling of the resolved <c>conversion.json</c> (same outputs dir).
    /// The returned path may not exist — <see cref="ReadRaw"/> treats that as empty.
    /// </summary>
    public static string Resolve(DashboardOptions options)
    {
        var env = Environment.GetEnvironmentVariable("RETELL_SYNC_HISTORY_JSON");
        if (!string.IsNullOrWhiteSpace(env))
        {
            return Path.GetFullPath(env);
        }

        var conversion = ConversionSource.Resolve(options);
        var dir = Path.GetDirectoryName(conversion) ?? ".";

        // Prefer a real history.json beside conversion.json; if it isn't there yet,
        // fall back to a bundled history.sample.json in the same directory (the
        // samples dir ships one so the Trends page demos with data out of the box —
        // the same outputs-then-sample fallback ConversionSource uses). When
        // neither exists, return the real path; ReadRaw treats a missing file as [].
        var real = Path.Combine(dir, HistoryFilename);
        if (File.Exists(real))
        {
            return real;
        }
        var sample = Path.Combine(dir, "history.sample.json");
        if (File.Exists(sample))
        {
            return sample;
        }
        return real;
    }

    /// <summary>Return the history array verbatim; <c>[]</c> when missing, 404 when unparseable.</summary>
    public static IResult ReadRaw(string path)
    {
        if (!File.Exists(path))
        {
            return Results.Content("[]", "application/json");
        }

        string text;
        try
        {
            text = File.ReadAllText(path);
            using var _ = JsonDocument.Parse(text); // validate only
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            return Results.Json(
                new { error = $"history.json is unparseable: {ex.Message}", resolvedPath = path },
                statusCode: StatusCodes.Status404NotFound);
        }

        return Results.Content(text, "application/json");
    }
}
