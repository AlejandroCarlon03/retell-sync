namespace RetellSync.Dashboard;

/// <summary>
/// Locates the retell-sync checkout the host belongs to. The dev build runs from
/// <c>dashboard/host/bin/...</c> and the published app from <c>&lt;repo&gt;/app</c>;
/// both sit inside the repo, so walking up to <c>pyproject.toml</c> finds the
/// shared <c>outputs/</c> and <c>data/</c> directories Python writes.
/// </summary>
public static class RepoPaths
{
    /// <summary>Walk up from the running binary to the repo root (marked by pyproject.toml).</summary>
    public static string? FindRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "pyproject.toml")))
            {
                return dir.FullName;
            }
            dir = dir.Parent;
        }
        return null;
    }
}
