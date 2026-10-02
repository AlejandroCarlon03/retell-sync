using System.Diagnostics;

namespace RetellSync.Dashboard;

/// <summary>A point-in-time view of the background data pull, served by <c>GET /api/refresh</c>.</summary>
/// <param name="State"><c>idle</c> (never run), <c>running</c>, <c>succeeded</c>, or <c>failed</c>.</param>
/// <param name="Message">Why it failed (the pull's last error line), or a short note.</param>
/// <param name="LogPath">Full output of this pull (only once Python actually ran).</param>
public sealed record RefreshStatus(
    string State,
    DateTimeOffset? StartedAt,
    DateTimeOffset? FinishedAt,
    string? Message,
    string? LogPath);

/// <summary>
/// Runs <c>python -m retell_sync run</c> in the background so the desktop app can
/// open its window immediately on the last saved data and pick up fresh data when
/// the pull lands — the job <c>Retell-Dashboard.cmd</c> used to do in a console
/// before the window appeared.
/// </summary>
/// <remarks>
/// Alerts are forced off for these pulls (<c>RETELL_ALERT_ENABLED=false</c>):
/// emailing the SLA / per-rep digests is the nightly scheduled task's job, so
/// opening or refreshing the dashboard can never re-email reps. A machine-wide
/// semaphore stops two open windows from pulling at once; the second simply waits
/// for the first and then reports its result.
/// </remarks>
public sealed class DataRefresher
{
    private static readonly TimeSpan Timeout = TimeSpan.FromMinutes(10);
    private const string SemaphoreName = @"Local\RetellSync.DataRefresh";

    private readonly string? _repoRoot;
    private readonly ILogger _logger;
    private readonly object _gate = new();
    private RefreshStatus _status = new("idle", null, null, null, null);

    public DataRefresher(string? repoRoot, ILogger logger)
    {
        _repoRoot = repoRoot;
        _logger = logger;
    }

    public RefreshStatus Status
    {
        get { lock (_gate) return _status; }
    }

    /// <summary>Start a pull unless one is already running. Returns the resulting status.</summary>
    public RefreshStatus Start()
    {
        lock (_gate)
        {
            if (_status.State == "running")
            {
                return _status;
            }
            _status = new RefreshStatus("running", DateTimeOffset.Now, null, null, null);
        }

        _ = Task.Run(RunAsync);
        return Status;
    }

    private string? LogPath => _repoRoot is null ? null : Path.Combine(_repoRoot, "outputs", "refresh.log");

    private async Task RunAsync()
    {
        string state;
        string? message = null;
        string? log = null;
        try
        {
            (state, message, log) = await PullAsync();
        }
        catch (Exception ex)
        {
            state = "failed";
            message = ex.Message;
        }

        if (state == "failed")
        {
            _logger.LogWarning("Data refresh failed: {Message}", message);
        }

        lock (_gate)
        {
            _status = _status with
            {
                State = state, FinishedAt = DateTimeOffset.Now, Message = message, LogPath = log,
            };
        }
    }

    private async Task<(string State, string? Message, string? Log)> PullAsync()
    {
        if (_repoRoot is null)
        {
            return ("failed", "Couldn't find the retell-sync folder (no pyproject.toml above the app).", null);
        }

        var python = ResolvePython();
        if (python is null)
        {
            return ("failed",
                "The Python environment isn't set up yet. Run scripts\\Publish-App.ps1 once " +
                "(or set RETELL_SYNC_PYTHON to a python.exe that has retell-sync installed).", null);
        }

        using var semaphore = new Semaphore(1, 1, SemaphoreName);
        if (!semaphore.WaitOne(0))
        {
            // Another window is already pulling: wait for it, then reuse its result.
            if (!await Task.Run(() => semaphore.WaitOne(Timeout)))
            {
                return ("failed", "Another dashboard window's data pull is stuck; close it and try again.", null);
            }
            semaphore.Release();
            return ("succeeded", "Refreshed by another open dashboard window.", null);
        }

        try
        {
            return await RunPythonAsync(python, _repoRoot);
        }
        finally
        {
            semaphore.Release();
        }
    }

    private async Task<(string State, string? Message, string? Log)> RunPythonAsync(string python, string repoRoot)
    {
        var psi = new ProcessStartInfo(python)
        {
            WorkingDirectory = repoRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.ArgumentList.Add("-m");
        psi.ArgumentList.Add("retell_sync");
        psi.ArgumentList.Add("run");
        psi.ArgumentList.Add("-v");
        psi.Environment["RETELL_ALERT_ENABLED"] = "false";
        psi.Environment["PYTHONIOENCODING"] = "utf-8";

        _logger.LogInformation("Pulling fresh data: {Python} -m retell_sync run", python);
        using var process = Process.Start(psi)
            ?? throw new InvalidOperationException($"Could not start {python}.");

        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();

        using var cts = new CancellationTokenSource(Timeout);
        try
        {
            await process.WaitForExitAsync(cts.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            return ("failed", $"The data pull took longer than {Timeout.TotalMinutes:0} minutes and was stopped.", null);
        }

        var output = await stdout;
        var errors = await stderr;
        var log = WriteLog(output, errors, process.ExitCode);

        return process.ExitCode == 0
            ? ("succeeded", null, log)
            : ("failed", LastLine(errors) ?? LastLine(output) ?? $"The data pull exited with code {process.ExitCode}.", log);
    }

    /// <summary>
    /// The Python to run: <c>RETELL_SYNC_PYTHON</c> if set, else the per-user venv
    /// the launcher and <c>Publish-App.ps1</c> create (kept off OneDrive).
    /// </summary>
    private static string? ResolvePython()
    {
        var env = Environment.GetEnvironmentVariable("RETELL_SYNC_PYTHON");
        if (!string.IsNullOrWhiteSpace(env))
        {
            return File.Exists(env) ? env : null;
        }

        var venv = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".venvs", "retell-sync", "Scripts", "python.exe");
        return File.Exists(venv) ? venv : null;
    }

    /// <summary>Write the pull's full output to <c>outputs/refresh.log</c>; returns the path, or null.</summary>
    private string? WriteLog(string output, string errors, int exitCode)
    {
        if (LogPath is null)
        {
            return null;
        }
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
            File.WriteAllText(LogPath,
                $"# retell_sync run — {DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss zzz} — exit {exitCode}\n\n" +
                output + (errors.Length > 0 ? "\n--- stderr ---\n" + errors : ""));
            return LogPath;
        }
        catch (IOException ex)
        {
            _logger.LogWarning("Couldn't write {LogPath}: {Message}", LogPath, ex.Message);
            return null;
        }
    }

    private static string? LastLine(string text)
    {
        var line = text
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .LastOrDefault();
        return line is { Length: > 300 } ? line[..300] + "…" : line;
    }
}
