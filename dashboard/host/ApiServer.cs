using Microsoft.Extensions.FileProviders;

namespace RetellSync.Dashboard;

/// <summary>
/// Builds the embedded ASP.NET Core app that serves both the built frontend and
/// the read-only <c>/api</c> endpoints from a single localhost origin (the same
/// model as the Cosmos Audit dashboard's <c>/api/*</c> layer).
/// </summary>
public static class ApiServer
{
    public static WebApplication Build(DashboardOptions options)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls(options.Url);
        builder.Logging.AddSimpleConsole(o => o.SingleLine = true);

        var app = builder.Build();

        // Serve the built Vite app. Prefer the source dist so a fresh
        // `npm run build` (e.g. from the launcher) is picked up on the very next
        // launch; fall back to the wwwroot copied next to the binary.
        var webroot = ResolveWebRoot();
        if (webroot is not null)
        {
            var provider = new PhysicalFileProvider(webroot);
            var defaults = new DefaultFilesOptions { FileProvider = provider };
            defaults.DefaultFileNames.Clear();
            defaults.DefaultFileNames.Add("index.html");
            app.UseDefaultFiles(defaults);
            app.UseStaticFiles(new StaticFileOptions { FileProvider = provider });
        }
        else
        {
            app.Logger.LogWarning(
                "No built frontend found (looked for frontend/dist and {WebRoot}); serving a placeholder page. Run `npm run build` in dashboard/frontend.",
                Path.Combine(AppContext.BaseDirectory, "wwwroot"));
        }

        app.MapGet("/api/health", () => Results.Json(new { ok = true }));
        app.MapGet("/api/conversion", () => ConversionSource.ReadRaw(ConversionSource.Resolve(options)));
        app.MapGet("/api/conversion/stats", () => ConversionSource.ReadStats(ConversionSource.Resolve(options)));

        if (webroot is null)
        {
            app.MapGet("/", () => Results.Content(PlaceholderHtml, "text/html"));
        }

        return app;
    }

    /// <summary>
    /// Locate the frontend to serve. Prefers the live source build at
    /// <c>dashboard/frontend/dist</c> (walking up from the binary to find it) so a
    /// fresh <c>npm run build</c> shows up on the next launch without depending on
    /// MSBuild's copy step — which only runs after a C# compile, and <c>dotnet
    /// run</c> skips that when nothing in the host changed. Falls back to the
    /// <c>wwwroot</c> copied next to the binary (published/CI builds have no source
    /// tree beside them). Returns <c>null</c> when neither exists.
    /// </summary>
    private static string? ResolveWebRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 8 && dir is not null; i++, dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "frontend", "dist");
            if (File.Exists(Path.Combine(candidate, "index.html")))
            {
                return candidate;
            }
        }

        var wwwroot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        return Directory.Exists(wwwroot) ? wwwroot : null;
    }

    private const string PlaceholderHtml =
        "<!doctype html><meta charset=utf-8><title>Retell → Conversion</title>" +
        "<body style=\"font-family:system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem\">" +
        "<h1>Dashboard host is running</h1>" +
        "<p>The frontend hasn't been built yet. From <code>dashboard/frontend</code> run " +
        "<code>npm install &amp;&amp; npm run build</code>, then restart the host.</p>" +
        "<p>API is live: <a href=\"/api/health\">/api/health</a> · " +
        "<a href=\"/api/conversion/stats\">/api/conversion/stats</a></p></body>";
}
