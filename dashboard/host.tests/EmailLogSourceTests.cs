using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using RetellSync.Dashboard;
using Xunit;

namespace RetellSync.Dashboard.Tests;

/// <summary>
/// Resolution + read behaviour for <see cref="EmailLogSource"/>, the
/// <c>/api/email-log</c> backing source. A missing log must read as an empty array
/// (the normal "nothing sent yet" state), a present array must pass through
/// verbatim, and a corrupt file must surface as an error.
/// </summary>
public sealed class EmailLogSourceTests
{
    private static string TempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"email_log_{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static async Task<(int Status, string Body)> Execute(IResult result)
    {
        var ctx = new DefaultHttpContext
        {
            // Results.Content resolves a logger from RequestServices when executing.
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
        var custom = Path.Combine(TempDir(), "custom_log.json");
        Environment.SetEnvironmentVariable("RETELL_SYNC_EMAIL_LOG_JSON", custom);
        try
        {
            var resolved = EmailLogSource.Resolve(new DashboardOptions());
            Assert.Equal(Path.GetFullPath(custom), resolved);
        }
        finally
        {
            Environment.SetEnvironmentVariable("RETELL_SYNC_EMAIL_LOG_JSON", null);
        }
    }

    [Fact]
    public void Resolve_defaults_to_sibling_of_conversion_json()
    {
        Environment.SetEnvironmentVariable("RETELL_SYNC_EMAIL_LOG_JSON", null);
        var conversion = ConversionSource.Resolve(new DashboardOptions());
        var expected = Path.Combine(Path.GetDirectoryName(conversion)!, "email_log.json");

        Assert.Equal(expected, EmailLogSource.Resolve(new DashboardOptions()));
    }

    [Fact]
    public async Task ReadRaw_missing_file_is_empty_array_200()
    {
        var (status, body) = await Execute(
            EmailLogSource.ReadRaw(Path.Combine(TempDir(), "email_log.json")));

        Assert.Equal(StatusCodes.Status200OK, status);
        Assert.Equal("[]", body);
    }

    [Fact]
    public async Task ReadRaw_passes_through_a_valid_log_verbatim()
    {
        var path = Path.Combine(TempDir(), "email_log.json");
        var json = """[{"kind":"per_rep","rep":"Jane Doe","lead_count":2}]""";
        File.WriteAllText(path, json);

        var (status, body) = await Execute(EmailLogSource.ReadRaw(path));

        Assert.Equal(StatusCodes.Status200OK, status);
        Assert.Equal(json, body); // byte-for-byte, not re-serialized
    }

    [Fact]
    public async Task ReadRaw_unparseable_file_is_404()
    {
        var path = Path.Combine(TempDir(), "email_log.json");
        File.WriteAllText(path, "{ not json");

        var (status, _) = await Execute(EmailLogSource.ReadRaw(path));

        Assert.Equal(StatusCodes.Status404NotFound, status);
    }
}
