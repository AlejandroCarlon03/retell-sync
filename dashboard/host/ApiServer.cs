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

        // Serve the built Vite app (copied into wwwroot next to the binary).
        var webroot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        var hasFrontend = Directory.Exists(webroot);
        if (hasFrontend)
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
                "No built frontend at {WebRoot}; serving a placeholder page. Run `npm run build` in dashboard/frontend.",
                webroot);
        }

        app.MapGet("/api/health", () => Results.Json(new { ok = true }));
        app.MapGet("/api/conversion", () => ConversionSource.ReadRaw(ConversionSource.Resolve(options)));
        app.MapGet("/api/conversion/stats", () => ConversionSource.ReadStats(ConversionSource.Resolve(options)));

        if (!hasFrontend)
        {
            app.MapGet("/", () => Results.Content(PlaceholderHtml, "text/html"));
        }

        return app;
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
