using System.Runtime.InteropServices;

namespace RetellSync.Dashboard;

/// <summary>
/// Gives the dashboard window its own taskbar identity so Windows shows the app's
/// logo on the taskbar button.
/// </summary>
/// <remarks>
/// Photino gives the process an app ID that no shortcut maps to, so the taskbar
/// ignores the window icon and falls back to the generic application icon (two
/// windows even group under it). Stamping the window's own AppUserModel
/// properties (ID, relaunch command, icon and name) makes the taskbar resolve the
/// button, and any pin, to this exe and its embedded icon.
/// </remarks>
internal static class TaskbarIdentity
{
    private const string AppId = "DKB.RetellDashboard";
    private const string DisplayName = "Retell Dashboard";

    // PKEY_AppUserModel_* share one format id; the pid picks the property.
    private static readonly Guid AppUserModelFmtid = new("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    private const uint RelaunchCommand = 2, RelaunchIconResource = 3, RelaunchDisplayName = 4, Id = 5;

    /// <summary>Best-effort: a failure only means the generic taskbar icon.</summary>
    public static void Apply(IntPtr hwnd)
    {
        var exe = Environment.ProcessPath;
        if (!OperatingSystem.IsWindows() || hwnd == IntPtr.Zero || exe is null)
        {
            return;
        }

        try
        {
            var iid = typeof(IPropertyStore).GUID;
            if (SHGetPropertyStoreForWindow(hwnd, ref iid, out var store) != 0)
            {
                return;
            }
            try
            {
                Set(store, RelaunchCommand, $"\"{exe}\"");
                Set(store, RelaunchIconResource, $"{exe},0");
                Set(store, RelaunchDisplayName, DisplayName);
                Set(store, Id, AppId); // set last: the ID change is what refreshes the button
                store.Commit();
            }
            finally
            {
                Marshal.ReleaseComObject(store);
            }
        }
        catch (Exception ex) when (ex is COMException or InvalidCastException)
        {
            // Leave the default icon rather than fail the window.
        }
    }

    private static void Set(IPropertyStore store, uint pid, string value)
    {
        var key = new PropertyKey { FormatId = AppUserModelFmtid, PropertyId = pid };
        var variant = new PropVariant { VarType = 31 /* VT_LPWSTR */, Pointer = Marshal.StringToCoTaskMemUni(value) };
        try
        {
            store.SetValue(ref key, ref variant);
        }
        finally
        {
            Marshal.FreeCoTaskMem(variant.Pointer);
        }
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PropertyKey
    {
        public Guid FormatId;
        public uint PropertyId;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct PropVariant
    {
        [FieldOffset(0)] public ushort VarType;
        [FieldOffset(8)] public IntPtr Pointer;
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        int GetCount(out uint count);
        int GetAt(uint index, out PropertyKey key);
        int GetValue(ref PropertyKey key, out PropVariant value);
        int SetValue(ref PropertyKey key, ref PropVariant value);
        int Commit();
    }

    [DllImport("shell32.dll")]
    private static extern int SHGetPropertyStoreForWindow(
        IntPtr hwnd, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
}
