using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using RetellSync.Dashboard;
using Xunit;

namespace RetellSync.Dashboard.Tests;

/// <summary>
/// Viewer mode: how the server URL is chosen, and how the published files are
/// passed through (or explained) when the app reads them from the server.
/// </summary>
public sealed class ViewerTests
{
    [Theory]
    [InlineData("http://192.168.10.32:8090", "http://192.168.10.32:8090/")]
    [InlineData("https://dashboard.dkb.local/viewer/", "https://dashboard.dkb.local/viewer/")]
    [InlineData(" http://host:8090/sub ", "http://host:8090/sub/")]
    public void Data_url_is_normalized_to_a_trailing_slash(string input, string expected)
    {
        Assert.Equal(expected, DashboardOptions.ParseDataUrl(input)!.ToString());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not a url")]
    [InlineData("file:///C:/data/")]
    public void Unusable_data_url_means_admin_mode(string? input)
    {
        Assert.Null(DashboardOptions.ParseDataUrl(input));
    }

    [Fact]
    public void Data_url_flag_turns_on_viewer_mode()
    {
        var options = DashboardOptions.Parse(["--data-url", "http://server:8090"]);
        Assert.True(options.IsViewer);
        Assert.Equal("http://server:8090/", options.DataUrl!.ToString());
    }

    [Fact]
    public void Installer_setting_beats_the_baked_url()
    {
        using var config = ViewerConfig("{\"dataUrl\":\"http://new-server:8090\"}");
        var url = DashboardOptions.ResolveDataUrl(null, null, config.Path, "http://baked:8090/");
        Assert.Equal("http://new-server:8090/", url!.ToString());
    }

    [Fact]
    public void Env_and_flag_beat_the_installer_setting()
    {
        using var config = ViewerConfig("{\"dataUrl\":\"http://new-server:8090\"}");
        Assert.Equal("http://env:8090/",
            DashboardOptions.ResolveDataUrl(null, "http://env:8090", config.Path, "http://baked:8090/")!.ToString());
        Assert.Equal("http://flag:8090/",
            DashboardOptions.ResolveDataUrl("http://flag:8090", "http://env:8090", config.Path, "http://baked:8090/")!.ToString());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("not json")]
    [InlineData("{\"dataUrl\":\"not a url\"}")]
    [InlineData("{\"other\":1}")]
    public void Missing_or_bad_setting_falls_back_to_the_baked_url(string? contents)
    {
        using var config = ViewerConfig(contents);
        var url = DashboardOptions.ResolveDataUrl(null, null, config.Path, "http://baked:8090/");
        Assert.Equal("http://baked:8090/", url!.ToString());
    }

    [Fact]
    public void Setting_never_turns_the_admin_app_into_a_viewer()
    {
        using var config = ViewerConfig("{\"dataUrl\":\"http://new-server:8090\"}");
        Assert.Null(DashboardOptions.ResolveDataUrl(null, null, config.Path, baked: null));
    }

    [Fact]
    public void Config_path_honours_its_env_override()
    {
        var custom = Path.Combine(Path.GetTempPath(), "custom-viewer.json");
        Environment.SetEnvironmentVariable("RETELL_DASHBOARD_VIEWER_CONFIG", custom);
        try
        {
            Assert.Equal(custom, DashboardOptions.ViewerConfigPath());
        }
        finally
        {
            Environment.SetEnvironmentVariable("RETELL_DASHBOARD_VIEWER_CONFIG", null);
        }
        Assert.EndsWith(Path.Combine("RetellDashboard", "viewer.json"), DashboardOptions.ViewerConfigPath());
    }

    [Fact]
    public async Task Published_file_passes_through_verbatim()
    {
        var proxy = Proxy(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{\"kpis\":{\"total_calls\":469}}"),
        });

        var (status, body) = await Execute(await proxy.FetchAsync("conversion.json", default));

        Assert.Equal(200, status);
        Assert.Equal("{\"kpis\":{\"total_calls\":469}}", body);
    }

    [Fact]
    public async Task Missing_history_stays_a_404_so_trends_shows_none_yet()
    {
        var proxy = Proxy(_ => new HttpResponseMessage(HttpStatusCode.NotFound));

        var (status, _) = await Execute(await proxy.FetchAsync("history.json", default));

        Assert.Equal(404, status);
    }

    [Fact]
    public async Task Unreachable_server_is_a_502_that_says_what_to_check()
    {
        var proxy = Proxy(_ => throw new HttpRequestException("No route to host"));

        var (status, body) = await Execute(await proxy.FetchAsync("conversion.json", default));

        Assert.Equal(502, status);
        Assert.Contains("office network or VPN", body);
    }

    /// <summary>A temp viewer.json with <paramref name="contents"/> (null = no file), deleted on dispose.</summary>
    private static TempFile ViewerConfig(string? contents)
    {
        var path = Path.Combine(Path.GetTempPath(), $"viewer-{Guid.NewGuid():N}.json");
        if (contents is not null)
        {
            File.WriteAllText(path, contents);
        }
        return new TempFile(path);
    }

    private sealed record TempFile(string Path) : IDisposable
    {
        public void Dispose() => File.Delete(Path);
    }

    private static ViewerProxy Proxy(Func<HttpRequestMessage, HttpResponseMessage> respond) =>
        new(new HttpClient(new StubHandler(respond)), new Uri("http://server:8090/"));

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

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(respond(request));
    }
}
