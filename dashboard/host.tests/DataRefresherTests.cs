using Microsoft.Extensions.Logging.Abstractions;
using RetellSync.Dashboard;
using Xunit;

namespace RetellSync.Dashboard.Tests;

/// <summary>
/// The background data pull's state machine and the launch flag that skips it.
/// The happy path shells out to Python, so it's covered by running the app, not here.
/// </summary>
public sealed class DataRefresherTests
{
    [Fact]
    public void Status_is_idle_before_any_pull()
    {
        var refresher = new DataRefresher(null, NullLogger.Instance);

        Assert.Equal("idle", refresher.Status.State);
        Assert.Null(refresher.Status.StartedAt);
    }

    [Fact]
    public async Task Pull_without_a_repo_fails_with_a_reason()
    {
        var refresher = new DataRefresher(null, NullLogger.Instance);

        var started = refresher.Start();
        Assert.Equal("running", started.State);

        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (refresher.Status.State == "running" && DateTime.UtcNow < deadline)
        {
            await Task.Delay(20);
        }

        var status = refresher.Status;
        Assert.Equal("failed", status.State);
        Assert.NotNull(status.FinishedAt);
        Assert.Contains("retell-sync folder", status.Message);
    }

    [Theory]
    [InlineData(new string[0], false)]
    [InlineData(new[] { "--no-refresh" }, true)]
    [InlineData(new[] { "--port", "5170", "--no-refresh" }, true)]
    public void No_refresh_flag_is_parsed(string[] args, bool expected)
    {
        Assert.Equal(expected, DashboardOptions.Parse(args).NoRefresh);
    }
}
