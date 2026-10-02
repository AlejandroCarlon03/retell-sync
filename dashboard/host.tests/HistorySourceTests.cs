using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using RetellSync.Dashboard;
using Xunit;

namespace RetellSync.Dashboard.Tests;

/// <summary>
/// Resolution + read behaviour for <see cref="HistorySource"/>, the
/// <c>/api/history</c> backing source. A missing file must read as an empty array
/// (the normal "no history yet" state before the first run), a present array must
/// pass through verbatim, and a corrupt file must surface as an error.
/// </summary>
public sealed class HistorySourceTests
{
    private static string TempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"history_{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static async Task<(int Status, string Body)> Execute(IResult result)
    {
        var ctx = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider(),
        };
        using var stream = new MemoryStream();
        ctx.Response.Body = stream;
        await result.ExecuteAsync(ctx);
        stream.Position = 0;
        using var reader = new StreamReader(stream);
        return (ctx.Response.StatusCode, await reader.ReadToEndAsync());
    }

    [Fact]
    public void Resolve_uses_env_override_when_set()
    {
        var custom = Path.Combine(TempDir(), "custom_history.json");
        Environment.SetEnvironmentVariable("RETELL_SYNC_HISTORY_JSON", custom);
        try
        {
            var resolved = HistorySource.Resolve(new DashboardOptions());
            Assert.Equal(Path.GetFullPath(custom), resolved);
        }
        finally
        {
            Environment.SetEnvironmentVariable("RETELL_SYNC_HISTORY_JSON", null);
        }
    }

    [Fact]
    public void Resolve_defaults_to_sibling_of_conversion_json()
    {
        // Pin conversion.json to a scratch dir (via the CLI-arg option, not the env, so
        // it can't leak into parallel tests) instead of depending on whether this
        // checkout has an outputs/ dir: CI's clean clone doesn't, a dev machine does.
        Environment.SetEnvironmentVariable("RETELL_SYNC_HISTORY_JSON", null);
        var dir = TempDir();
        var options = new DashboardOptions { ConversionPath = Path.Combine(dir, "conversion.json") };
        var real = Path.Combine(dir, "history.json");
        var sample = Path.Combine(dir, "history.sample.json");

        // Neither exists yet: the real sibling path (ReadRaw treats it as []).
        Assert.Equal(real, HistorySource.Resolve(options));

        // Only the bundled sample beside it: fall back to the sample.
        File.WriteAllText(sample, "[]");
        Assert.Equal(sample, HistorySource.Resolve(options));

        // A real history.json wins over the sample.
        File.WriteAllText(real, "[]");
        Assert.Equal(real, HistorySource.Resolve(options));
    }

    [Fact]
    public async Task ReadRaw_missing_file_is_empty_array_200()
    {
        var (status, body) = await Execute(
            HistorySource.ReadRaw(Path.Combine(TempDir(), "history.json")));

        Assert.Equal(StatusCodes.Status200OK, status);
        Assert.Equal("[]", body);
    }

    [Fact]
    public async Task ReadRaw_passes_through_a_valid_history_verbatim()
    {
        var path = Path.Combine(TempDir(), "history.json");
        var json = """[{"date":"2026-08-04","kpis":{"total_calls":3}}]""";
        File.WriteAllText(path, json);

        var (status, body) = await Execute(HistorySource.ReadRaw(path));

        Assert.Equal(StatusCodes.Status200OK, status);
        Assert.Equal(json, body); // byte-for-byte, not re-serialized
    }

    [Fact]
    public async Task ReadRaw_unparseable_file_is_404()
    {
        var path = Path.Combine(TempDir(), "history.json");
        File.WriteAllText(path, "{ not json");

        var (status, _) = await Execute(HistorySource.ReadRaw(path));

        Assert.Equal(StatusCodes.Status404NotFound, status);
    }
}
