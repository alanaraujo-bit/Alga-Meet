// Alga Meet activity helper: reports the foreground app (one JSON line per change on stdout) and returns exe icons
// on request (stdin "icon\t<path>"). Plain C# 5, compiled by scripts/build-activity.mjs with the csc.exe that ships
// with Windows. It never reads window titles: only process, exe path, version-info names and fullscreen state.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class AlgaActivity
{
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public int dwFlags; }
    [StructLayout(LayoutKind.Sequential)] struct FILETIME { public uint Low, High; }
    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFO mi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, int[] ids, uint count, uint flags);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern bool QueryFullProcessImageName(IntPtr proc, uint flags, StringBuilder sb, ref int size);
    [DllImport("kernel32.dll")]
    static extern bool GetProcessTimes(IntPtr proc, out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);

    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    static readonly object outLock = new object();
    static StreamWriter stdout;

    static void Emit(string line)
    {
        lock (outLock) { stdout.Write(line); stdout.Write('\n'); stdout.Flush(); }
    }

    static string Esc(string s)
    {
        StringBuilder sb = new StringBuilder(s == null ? 0 : s.Length + 2);
        if (s != null)
            foreach (char c in s)
            {
                if (c == '"') sb.Append("\\\"");
                else if (c == '\\') sb.Append("\\\\");
                else if (c < 0x20 || c == 0x2028 || c == 0x2029) sb.Append("\\u").Append(((int)c).ToString("x4"));
                else sb.Append(c);
            }
        return sb.ToString();
    }

    static string PathOf(uint pid)
    {
        IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (h == IntPtr.Zero) return "";
        try
        {
            StringBuilder sb = new StringBuilder(1024);
            int n = sb.Capacity;
            return QueryFullProcessImageName(h, 0, sb, ref n) ? sb.ToString() : "";
        }
        finally { CloseHandle(h); }
    }

    static long StartOf(uint pid)
    {
        IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (h == IntPtr.Zero) return 0;
        try
        {
            FILETIME c, e, k, u;
            if (!GetProcessTimes(h, out c, out e, out k, out u)) return 0;
            long ft = ((long)c.High << 32) | c.Low;
            return ft <= 116444736000000000L ? 0 : (ft - 116444736000000000L) / 10000L;
        }
        finally { CloseHandle(h); }
    }

    static bool IsShell(IntPtr hwnd)
    {
        if (hwnd == GetShellWindow()) return true;
        StringBuilder sb = new StringBuilder(64);
        GetClassName(hwnd, sb, 64);
        string cls = sb.ToString();
        return cls == "Progman" || cls == "WorkerW";
    }

    static bool IsFullscreen(IntPtr hwnd)
    {
        if (IsShell(hwnd)) return false;
        RECT r;
        if (!GetWindowRect(hwnd, out r)) return false;
        IntPtr mon = MonitorFromWindow(hwnd, 2 /* MONITOR_DEFAULTTONEAREST */);
        MONITORINFO mi = new MONITORINFO();
        mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (mon == IntPtr.Zero || !GetMonitorInfo(mon, ref mi)) return false;
        return r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
    }

    static string lastKey = null;

    static void Poll()
    {
        IntPtr hwnd = GetForegroundWindow();
        uint pid = 0;
        string path = "";
        bool fs = false;
        if (hwnd != IntPtr.Zero)
        {
            GetWindowThreadProcessId(hwnd, out pid);
            path = pid == 0 ? "" : PathOf(pid);
            if (path.EndsWith("\\ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase))
            {
                // UWP app: the real process owns a child window of the frame host.
                uint host = pid, real = 0;
                EnumChildWindows(hwnd, delegate (IntPtr child, IntPtr lp)
                {
                    uint p;
                    GetWindowThreadProcessId(child, out p);
                    if (p != 0 && p != host) { real = p; return false; }
                    return true;
                }, IntPtr.Zero);
                if (real != 0) { pid = real; path = PathOf(pid); }
            }
            fs = IsFullscreen(hwnd);
        }
        if (path.Length == 0) pid = 0;
        string key = pid + "|" + path + "|" + (fs ? 1 : 0);
        if (key == lastKey) return;
        lastKey = key;
        string product = "", desc = "";
        long start = 0;
        if (pid != 0)
        {
            start = StartOf(pid);
            try
            {
                FileVersionInfo v = FileVersionInfo.GetVersionInfo(path);
                product = v.ProductName ?? "";
                desc = v.FileDescription ?? "";
            }
            catch (Exception) { }
        }
        Emit("{\"t\":\"fg\",\"pid\":" + pid + ",\"path\":\"" + Esc(path) + "\",\"start\":" + start + ",\"product\":\"" + Esc(product.Trim()) +
             "\",\"desc\":\"" + Esc(desc.Trim()) + "\",\"fs\":" + (fs ? "true" : "false") + "}");
    }

    static string IconPng(string path)
    {
        IntPtr[] icons = new IntPtr[1];
        int[] ids = new int[1];
        uint n;
        try { n = PrivateExtractIcons(path, 0, 64, 64, icons, ids, 1, 0); }
        catch (Exception) { return ""; }
        if (n == 0 || n == 0xFFFFFFFF || icons[0] == IntPtr.Zero) return "";
        try
        {
            using (Icon ic = Icon.FromHandle(icons[0]))
            using (Bitmap bmp = new Bitmap(64, 64, PixelFormat.Format32bppArgb))
            {
                // DrawIcon keeps the icon's alpha channel (Image.FromHbitmap would drop it).
                using (Graphics g = Graphics.FromImage(bmp)) g.DrawIcon(ic, new Rectangle(0, 0, 64, 64));
                using (MemoryStream ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    return Convert.ToBase64String(ms.ToArray());
                }
            }
        }
        catch (Exception) { return ""; }
        finally { DestroyIcon(icons[0]); }
    }

    static void ReadCommands()
    {
        StreamReader input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string line;
        while ((line = input.ReadLine()) != null)
        {
            if (!line.StartsWith("icon\t")) continue;
            string p = line.Substring(5);
            Emit("{\"t\":\"icon\",\"path\":\"" + Esc(p) + "\",\"png\":\"" + IconPng(p) + "\"}");
        }
        Environment.Exit(0); // parent is gone
    }

    static void Main()
    {
        stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        Thread t = new Thread(ReadCommands);
        t.IsBackground = true;
        t.Start();
        while (true)
        {
            try { Poll(); } catch (Exception) { }
            Thread.Sleep(1000);
        }
    }
}
