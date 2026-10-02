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
