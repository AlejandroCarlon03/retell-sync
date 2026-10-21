using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using RetellSync.Dashboard;
using Xunit;

namespace RetellSync.Dashboard.Tests;

/// <summary>
/// The update feed: what counts as newer, which feeds are trusted, and that a
/// download that doesn't match its checksum is never run.
/// </summary>
public sealed class UpdateServiceTests
{
    private static readonly Uri Feed = new("http://server:8090/updates/latest.json");
    private static readonly string Sha = new('a', 64);

    [Theory]
    [InlineData("1.0.1", "1.0.0", true)]
    [InlineData("1.1.0", "1.0.9", true)]
    [InlineData("2.0", "1.9.9", true)]
    [InlineData("1.0.0", "1.0.0", false)]
    [InlineData("1.0", "1.0.0", false)]
    [InlineData("0.9.9", "1.0.0", false)]
    [InlineData("garbage", "1.0.0", false)]
    public void Only_a_strictly_newer_version_counts(string candidate, string current, bool newer)
    {
        Assert.Equal(newer, UpdateService.IsNewer(candidate, current));
    }

    [Fact]
    public void Feed_installer_resolves_next_to_the_feed()
    {
        var info = UpdateService.ParseFeed(
            $"{{\"version\":\"1.0.1\",\"file\":\"RetellDashboard-Viewer-Setup-1.0.1.exe\",\"sha256\":\"{Sha.ToUpperInvariant()}\",\"notes\":\"Faster tables\"}}",
            Feed);
        Assert.NotNull(info);
        Assert.Equal("http://server:8090/updates/RetellDashboard-Viewer-Setup-1.0.1.exe", info!.InstallerUrl.ToString());
        Assert.Equal(Sha, info.Sha256);
        Assert.Equal("Faster tables", info.Notes);
    }

    [Theory]
    [InlineData("{\"version\":\"1.0.1\",\"file\":\"http://elsewhere/setup.exe\",\"sha256\":\"SHA\"}")]
    [InlineData("{\"version\":\"1.0.1\",\"file\":\"//elsewhere/setup.exe\",\"sha256\":\"SHA\"}")]
    [InlineData("{\"version\":\"1.0.1\",\"file\":\"setup.exe\",\"sha256\":\"not-a-hash\"}")]
    [InlineData("{\"version\":\"one\",\"file\":\"setup.exe\",\"sha256\":\"SHA\"}")]
    [InlineData("{\"file\":\"setup.exe\",\"sha256\":\"SHA\"}")]
    [InlineData("not json")]
    public void Untrusted_or_malformed_feed_is_rejected(string json)
    {
        Assert.Throws<FormatException>(() => UpdateService.ParseFeed(json.Replace("SHA", Sha), Feed));
    }

    [Fact]
    public void Viewer_feed_lives_under_the_data_url()
    {
        var options = DashboardOptions.Parse(["--data-url", "http://server:8090"]);
        Assert.Equal(Feed, UpdateService.ResolveFeedUrl(options));
        Assert.Null(UpdateService.ResolveFeedUrl(DashboardOptions.Parse([])));
    }

    [Fact]
    public async Task Newer_release_is_reported()
    {
        var service = Service(_ => Json($"{{\"version\":\"99.0.0\",\"file\":\"s.exe\",\"sha256\":\"{Sha}\"}}"));
        var (update, error) = await service.CheckAsync(default);
        Assert.Null(error);
        Assert.Equal("99.0.0", update!.Version);
    }

    [Fact]
    public async Task Same_or_older_release_means_no_update()
    {
        var service = Service(_ => Json($"{{\"version\":\"{UpdateService.CurrentVersion}\",\"file\":\"s.exe\",\"sha256\":\"{Sha}\"}}"));
        var (update, error) = await service.CheckAsync(default);
        Assert.Null(update);
        Assert.Null(error);
    }

    [Fact]
    public async Task Nothing_published_yet_is_not_an_error()
    {
        var (update, error) = await Service(_ => new HttpResponseMessage(HttpStatusCode.NotFound)).CheckAsync(default);
        Assert.Null(update);
        Assert.Null(error);
    }

    [Fact]
    public async Task Unreachable_server_is_reported_quietly()
    {
        var (update, error) = await Service(_ => throw new HttpRequestException("down")).CheckAsync(default);
        Assert.Null(update);
        Assert.Equal("Couldn't reach the update server.", error);
    }

    [Fact]
    public async Task No_feed_means_version_only()
    {
        var service = new UpdateService(new HttpClient(), null, NullLogger.Instance, () => { });
        Assert.Equal((null, null), await service.CheckAsync(default));
        Assert.Equal("There's no newer version to install.", await service.InstallAsync(default));
    }

    [Fact]
    public async Task Download_that_fails_its_checksum_is_never_run()
    {
        var exited = false;
        var body = Encoding.UTF8.GetBytes("not the real installer");
        var service = Service(req => req.RequestUri!.AbsolutePath.EndsWith("latest.json")
            ? Json($"{{\"version\":\"99.0.0\",\"file\":\"s.exe\",\"sha256\":\"{Sha}\"}}")
            : new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(body) },
            () => exited = true);

        var error = await service.InstallAsync(default);

        Assert.Contains("didn't match its published checksum", error);
        Assert.False(exited);
        Assert.False(File.Exists(Path.Combine(Path.GetTempPath(), "RetellDashboard-update",
            "RetellDashboard-Viewer-Setup-99.0.0.exe")));
        Assert.NotEqual(Sha, Convert.ToHexString(SHA256.HashData(body)).ToLowerInvariant());
    }

    private static UpdateService Service(Func<HttpRequestMessage, HttpResponseMessage> respond, Action? exit = null) =>
        new(new HttpClient(new StubHandler(respond)), Feed, NullLogger.Instance, exit ?? (() => { }));

    private static HttpResponseMessage Json(string json) =>
        new(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(respond(request));
    }
}
