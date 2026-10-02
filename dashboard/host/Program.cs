using System.Runtime.InteropServices;
using Photino.NET;
using RetellSync.Dashboard;

internal static class Program
{
    /// <summary>
    /// Entry point: start the embedded API/static server, then open a Photino
    /// window pointed at it. STAThread is required by the native webview on
    /// Windows. With <c>--no-window</c> (or <c>DASHBOARD_NO_WINDOW=1</c>) the
    /// server runs headless — used by CI / smoke tests that hit the API without a
    /// display.
    /// </summary>
    [STAThread]
    private static void Main(string[] args)
    {
        var options = DashboardOptions.Parse(args);
        try
        {
            Run(options);
        }
        catch (Exception ex) when (!options.NoWindow)
        {
            // A Release build has no console, so a startup failure (e.g. the WebView2
            // runtime missing) would otherwise vanish without a trace.
            MessageBoxW(IntPtr.Zero,
                $"The dashboard couldn't start.\n\n{ex.Message}",
                "Retell Dashboard", 0x10 /* MB_ICONERROR */);
            Environment.ExitCode = 1;
        }
    }

    private static void Run(DashboardOptions options)
    {
        var app = ApiServer.Build(options);

        if (options.NoWindow)
        {
            app.Run(); // blocks, serving the API until the process is stopped
            return;
        }

        app.StartAsync().GetAwaiter().GetResult();
        var address = app.Urls.First();
        app.Logger.LogInformation("Dashboard host listening at {Address}", address);

        // Open on the last saved data straight away; the pull runs in the background
        // and the frontend reloads when it lands (see DataRefresher, /api/refresh).
        if (!options.NoRefresh)
        {
            app.Services.GetRequiredService<DataRefresher>().Start();
        }

        var window = new PhotinoWindow()
            .SetTitle("Retell → Conversion")
            .SetUseOsDefaultSize(false)
            .SetSize(1280, 860)
            .Center()
            .SetResizable(true)
            .RegisterWindowCreatedHandler((sender, _) =>
                TaskbarIdentity.Apply(((PhotinoWindow)sender!).WindowHandle));

        var icon = Path.Combine(AppContext.BaseDirectory, "app.ico");
        if (File.Exists(icon))
        {
            window.SetIconFile(icon);
        }

        window.Load(new Uri(address)).WaitForClose();

        app.StopAsync().GetAwaiter().GetResult();
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);
}
