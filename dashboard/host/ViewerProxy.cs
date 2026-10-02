namespace RetellSync.Dashboard;

/// <summary>
/// Viewer mode's data source: fetches the server's published <c>conversion.json</c>
/// and <c>history.json</c> (the files the nightly task copies into the internal
/// web viewer) and hands them to the frontend verbatim from the app's own origin.
/// </summary>
/// <remarks>
/// The viewer ships the static web build, which reads <c>./conversion.json</c> and
/// <c>./history.json</c> beside its <c>index.html</c>, so serving those two paths
/// is all the host does: no Python, no API keys, nothing written to disk. A missing
/// file passes through as 404 (the Trends page reads a missing history as "none
/// yet"); an unreachable server is a 502 whose message says what to check.
/// </remarks>
public sealed class ViewerProxy
{
    public static readonly string[] Files = ["conversion.json", "history.json"];

    private readonly HttpClient _http;
    private readonly Uri _baseUrl;

    public ViewerProxy(HttpClient http, Uri baseUrl)
    {
        _http = http;
        _baseUrl = baseUrl;
    }

    public async Task<IResult> FetchAsync(string file, CancellationToken ct)
    {
        var url = new Uri(_baseUrl, file);
        try
        {
            using var resp = await _http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var status = (int)resp.StatusCode;
                return Results.Json(
                    new { error = $"The dashboard server returned {status} for {file} ({url})." },
                    statusCode: status == StatusCodes.Status404NotFound ? status : StatusCodes.Status502BadGateway);
            }
            var body = await resp.Content.ReadAsStringAsync(ct);
            return Results.Content(body, "application/json");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return Results.Json(
                new
                {
                    error = $"Couldn't reach the dashboard server at {_baseUrl}. " +
                            "Check that you're on the office network or VPN, then press Refresh.",
                },
                statusCode: StatusCodes.Status502BadGateway);
        }
    }
}
