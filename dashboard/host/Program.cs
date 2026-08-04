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
        var app = ApiServer.Build(options);

        if (options.NoWindow)
        {
            app.Run(); // blocks, serving the API until the process is stopped
            return;
        }

        app.StartAsync().GetAwaiter().GetResult();
        var address = app.Urls.First();
        app.Logger.LogInformation("Dashboard host listening at {Address}", address);

        new PhotinoWindow()
            .SetTitle("Retell → Conversion")
            .SetUseOsDefaultSize(false)
            .SetSize(1280, 860)
            .Center()
            .SetResizable(true)
            .Load(new Uri(address))
            .WaitForClose();

        app.StopAsync().GetAwaiter().GetResult();
    }
}
