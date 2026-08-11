using System.Text.Json;

namespace RetellSync.Dashboard;

/// <summary>
/// Locates and reads <c>email_log.json</c> — the overdue-lead digest send-log the
/// Python alert path appends to (see <c>retell_sync/sendlog.py</c>) — for the
/// <c>/api/email-log</c> endpoint that backs the dashboard's Email Log page.
/// </summary>
/// <remarks>
/// Read-only, and passed through verbatim like <see cref="ConversionSource"/>. The
/// log sits next to <c>conversion.json</c> in the same <c>outputs/</c> directory,
/// so resolution reuses <see cref="ConversionSource.Resolve"/> and swaps the
/// filename — one env override (<c>RETELL_SYNC_EMAIL_LOG_JSON</c>) still wins.
/// <para>
/// A <em>missing</em> file returns an empty array with 200, not a 404: an empty log
/// is the normal state (per-rep digests are off until <c>RETELL_ALERT_PER_REP</c>
/// is set), so the page shows its explanatory empty state rather than an error.
/// Only a present-but-unparseable file is surfaced as an error.
/// </para>
/// </remarks>
public static class EmailLogSource
{
    private const string EmailLogFilename = "email_log.json";

    /// <summary>
    /// Resolve the email_log.json path: env <c>RETELL_SYNC_EMAIL_LOG_JSON</c> if set,
    /// else the sibling of the resolved <c>conversion.json</c> (same outputs dir).
    /// The returned path may not exist — <see cref="ReadRaw"/> treats that as empty.
    /// </summary>
    public static string Resolve(DashboardOptions options)
    {
        var env = Environment.GetEnvironmentVariable("RETELL_SYNC_EMAIL_LOG_JSON");
        if (!string.IsNullOrWhiteSpace(env))
        {
            return Path.GetFullPath(env);
        }

        var conversion = ConversionSource.Resolve(options);
        var dir = Path.GetDirectoryName(conversion) ?? ".";
        return Path.Combine(dir, EmailLogFilename);
    }

    /// <summary>Return the log array verbatim; <c>[]</c> when missing, 404 when unparseable.</summary>
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
                new { error = $"email_log.json is unparseable: {ex.Message}", resolvedPath = path },
                statusCode: StatusCodes.Status404NotFound);
        }

        return Results.Content(text, "application/json");
    }
}
