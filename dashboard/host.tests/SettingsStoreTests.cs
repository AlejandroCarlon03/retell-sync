using System.Text.Json;
using RetellSync.Dashboard;
using Xunit;

namespace RetellSync.Dashboard.Tests;

/// <summary>
/// Read/write roundtrip and sanitisation for <see cref="SettingsStore"/> — the
/// editable-recipient bridge. The on-disk JSON must round-trip cleanly and stay in
/// the snake_case shape that Python's config layer reads back.
/// </summary>
public sealed class SettingsStoreTests
{
    private static string TempPath() =>
        Path.Combine(Path.GetTempPath(), $"alert_settings_{Guid.NewGuid():N}.json");

    [Fact]
    public void Read_missing_file_returns_defaults()
    {
        var settings = SettingsStore.Read(TempPath());

        Assert.Empty(settings.Recipients);
        Assert.Equal(AlertSettings.DefaultSlaHours, settings.SlaHours);
        Assert.False(settings.Enabled);
    }

    [Fact]
    public void Write_then_Read_roundtrips_the_values()
    {
        var path = TempPath();
        try
        {
            var stored = SettingsStore.Write(
                path,
                new AlertSettings { Recipients = ["alex@dkbinc.co"], SlaHours = 24, Enabled = true });

            // Write echoes the sanitized value...
            Assert.Equal(["alex@dkbinc.co"], stored.Recipients);
            Assert.Equal(24, stored.SlaHours);
            Assert.True(stored.Enabled);

            // ...and reading it back yields the same thing.
            var read = SettingsStore.Read(path);
            Assert.Equal(["alex@dkbinc.co"], read.Recipients);
            Assert.Equal(24, read.SlaHours);
            Assert.True(read.Enabled);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Write_persists_snake_case_keys_for_python()
    {
        var path = TempPath();
        try
        {
            SettingsStore.Write(path, new AlertSettings { Recipients = ["a@b.co"], SlaHours = 12, Enabled = true });

            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            Assert.True(root.TryGetProperty("recipients", out _));
            Assert.True(root.TryGetProperty("sla_hours", out var sla));
            Assert.True(root.TryGetProperty("enabled", out _));
            Assert.Equal(12, sla.GetDouble());
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Sanitize_trims_dedupes_and_drops_blank_recipients()
    {
        var clean = SettingsStore.Sanitize(new AlertSettings
        {
            Recipients = [" alex@dkbinc.co ", "", "  ", "ALEX@dkbinc.co", "sam@dkbinc.co"],
            SlaHours = 48,
        });

        // Trimmed, blanks removed, case-insensitive duplicate dropped.
        Assert.Equal(["alex@dkbinc.co", "sam@dkbinc.co"], clean.Recipients);
    }

    [Fact]
    public void Sanitize_floors_nonpositive_sla_to_default()
    {
        var clean = SettingsStore.Sanitize(new AlertSettings { SlaHours = 0 });
        Assert.Equal(AlertSettings.DefaultSlaHours, clean.SlaHours);
    }

    [Fact]
    public void Read_unparseable_file_returns_defaults()
    {
        var path = TempPath();
        try
        {
            File.WriteAllText(path, "{ this is not json");
            var settings = SettingsStore.Read(path);
            Assert.Empty(settings.Recipients);
            Assert.Equal(AlertSettings.DefaultSlaHours, settings.SlaHours);
        }
        finally
        {
            File.Delete(path);
        }
    }
}
