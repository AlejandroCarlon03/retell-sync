using Microsoft.AspNetCore.StaticFiles;
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
        builder.Services.AddSingleton(sp => new DataRefresher(
            RepoPaths.FindRoot(), sp.GetRequiredService<ILogger<DataRefresher>>()));
        if (options.DataUrl is { } dataUrl)
        {
            builder.Services.AddSingleton(new ViewerProxy(
                new HttpClient { Timeout = TimeSpan.FromSeconds(20) }, dataUrl));
        }

        var app = builder.Build();

        // Serve the built Vite app (see ResolveFrontend for where it comes from).
        var provider = ResolveFrontend(options.IsViewer);
        if (provider is not null)
        {
            var defaults = new DefaultFilesOptions { FileProvider = provider };
            defaults.DefaultFileNames.Clear();
            defaults.DefaultFileNames.Add("index.html");
            app.UseDefaultFiles(defaults);
            app.UseStaticFiles(new StaticFileOptions
            {
                FileProvider = provider,
                OnPrepareResponse = SetCacheHeaders,
            });
        }
        else
        {
            app.Logger.LogWarning(
                "No built frontend found (source dist, embedded, or {WebRoot}); serving a placeholder page. Run `npm run build` in dashboard/frontend.",
                Path.Combine(AppContext.BaseDirectory, "wwwroot"));
        }

        app.MapGet("/api/health", () => Results.Json(new { ok = true, mode = options.IsViewer ? "viewer" : "admin" }));

        if (options.IsViewer)
        {
            // Read-only viewer: the static build fetches ./conversion.json and
            // ./history.json; serve them from the server's published copies. None of
            // the admin routes (local files, settings, data pull) exist in this mode.
            foreach (var file in ViewerProxy.Files)
            {
                app.MapGet("/" + file, async (ViewerProxy proxy, HttpContext ctx) =>
                {
                    ctx.Response.Headers.CacheControl = "no-store";
                    return await proxy.FetchAsync(file, ctx.RequestAborted);
                });
            }
            if (provider is null)
            {
                app.MapGet("/", () => Results.Content(PlaceholderHtml, "text/html"));
            }
            return app;
        }

        app.MapGet("/api/conversion", () => ConversionSource.ReadRaw(ConversionSource.Resolve(options)));
        app.MapGet("/api/conversion/stats", () => ConversionSource.ReadStats(ConversionSource.Resolve(options)));

        // The overdue-lead digest send-log (see retell_sync/sendlog.py), backing the
        // admin-only Email Log page. Read-only; empty array when nothing sent yet.
        app.MapGet("/api/email-log", () => EmailLogSource.ReadRaw(EmailLogSource.Resolve(options)));

        // The per-run KPI history (see retell_sync/output.py append_history), backing
        // the Trends Over Time page. Read-only; empty array until the first run lands.
        app.MapGet("/api/history", () => HistorySource.ReadRaw(HistorySource.Resolve(options)));

        // Editable alert recipients / SLA / on-off. Read + write the settings JSON
        // that Python's config layer also reads. Bound to localhost like the rest of
        // /api, and absent from the static IIS viewer, so only the admin desktop app
        // reaches these routes.
        app.MapGet("/api/settings", () => SettingsStore.ReadResult(SettingsStore.Resolve(options)));
        app.MapPut("/api/settings", (HttpRequest req) => SettingsStore.WriteResult(SettingsStore.Resolve(options), req));

        // Background `python -m retell_sync run` (see DataRefresher). The window starts
        // one on launch; the header's Refresh button POSTs another. Localhost-only
        // like the rest of /api and absent from the static IIS viewer.
        app.MapGet("/api/refresh", (DataRefresher refresher) => Results.Json(refresher.Status));
        app.MapPost("/api/refresh", (DataRefresher refresher) => Results.Json(refresher.Start()));

        if (provider is null)
        {
            app.MapGet("/", () => Results.Content(PlaceholderHtml, "text/html"));
        }

        return app;
    }

    /// <summary>
    /// Cache policy for the served frontend — the WebView2 counterpart to the IIS
    /// <c>web.config</c> shipped in the static build. index.html points at
    /// content-hashed <c>/assets</c> bundles; without this, the webview heuristically
    /// caches index.html and, after a rebuild, keeps requesting old hashes that no
    /// longer exist — a stale window until a manual reload. So: hashed assets cache
    /// immutably (new build = new filename), while index.html always revalidates and
    /// so is picked up on the next launch.
    /// </summary>
    private static void SetCacheHeaders(StaticFileResponseContext ctx)
    {
        var path = ctx.Context.Request.Path;
        if (path.StartsWithSegments("/assets"))
        {
            ctx.Context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        }
        else if (ctx.File.Name.Equals("index.html", StringComparison.OrdinalIgnoreCase))
        {
            ctx.Context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
        }
    }

    /// <summary>
    /// Locate the frontend to serve, in order:
    /// <list type="number">
    /// <item>A viewer build serves the UI embedded in its own exe (the static web
    /// build), so the single copied file is the whole app.</item>
    /// <item>The live source build at <c>dashboard/frontend/dist</c> (walking up from
    /// the binary), so a fresh <c>npm run build</c> shows up on the next dev launch
    /// without depending on MSBuild's copy step, which <c>dotnet run</c> skips when
    /// nothing in the host changed.</item>
    /// <item>The UI embedded by <c>Publish-App.ps1</c> (single-file publish).</item>
    /// <item>A <c>wwwroot</c> copied next to the binary (plain builds).</item>
    /// </list>
    /// Returns <c>null</c> when none exists.
    /// </summary>
    private static IFileProvider? ResolveFrontend(bool viewer)
    {
        var embedded = EmbeddedFrontend();
        if (viewer && embedded is not null)
        {
            return embedded;
        }

        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 8 && dir is not null; i++, dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "frontend", "dist");
            if (File.Exists(Path.Combine(candidate, "index.html")))
            {
                return new PhysicalFileProvider(candidate);
            }
        }

        if (embedded is not null)
        {
            return embedded;
        }

        var wwwroot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        return Directory.Exists(wwwroot) ? new PhysicalFileProvider(wwwroot) : null;
    }

    /// <summary>
    /// The frontend embedded at publish time (<c>-p:EmbedFrontend=true</c>), if any.
    /// Resources are named <c>RetellSync.Dashboard.wwwroot.assets.index-abc.js</c>;
    /// the provider maps <c>/assets/index-abc.js</c> back onto that (Vite emits one
    /// flat <c>assets</c> folder, so the dotted names are unambiguous).
    /// </summary>
    private static IFileProvider? EmbeddedFrontend()
    {
        var provider = new EmbeddedFileProvider(typeof(ApiServer).Assembly, "RetellSync.Dashboard.wwwroot");
        return provider.GetFileInfo("index.html").Exists ? provider : null;
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
