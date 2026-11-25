// Explorer context-menu launcher for DeepSeek Harness.
//
// Invoked as: dsh-open.exe "<folder>"
// It appends the folder to the per-user hand-off queue read by the
// open-in-dsh plugin, then starts (or re-focuses) the DeepSeek Harness app.
// Compiled as a GUI subsystem binary so no console window flashes.
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;

internal static class DshOpenLauncher
{
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length < 1 || string.IsNullOrWhiteSpace(args[0])) return 2;

            string target = args[0].Trim().Trim('"');
            // A drive context menu passes "E:\"; the trailing separator must stay
            // so the drive itself is opened instead of the process working directory.
            if (target.Length == 2 && target[1] == ':') target += Path.DirectorySeparatorChar;
            if (!Directory.Exists(target)) return 3;
            target = Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (target.Length == 2 && target[1] == ':') target += Path.DirectorySeparatorChar;
            if (target.Length == 0) return 3;

            string root = AppDomain.CurrentDomain.BaseDirectory;
            string app = ReadAppPath(Path.Combine(root, "app-path.txt"));
            if (app == null || !File.Exists(app)) return 4;

            string queue = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DeepSeekHarness",
                "dsh-open");
            Directory.CreateDirectory(queue);

            string name = DateTime.UtcNow.Ticks.ToString(CultureInfo.InvariantCulture)
                + "-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".json";
            string body = "{\"path\":" + JsonString(target)
                + ",\"time\":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture) + "}";
            File.WriteAllText(Path.Combine(queue, name), body, new UTF8Encoding(false));

            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = app;
            start.WorkingDirectory = Path.GetDirectoryName(app);
            start.UseShellExecute = true;
            Process.Start(start);
            return 0;
        }
        catch
        {
            return 1;
        }
    }

    /** Reads the one-line app path; an absent or blank file means not installed. */
    private static string ReadAppPath(string file)
    {
        try
        {
            if (!File.Exists(file)) return null;
            string text = File.ReadAllText(file, Encoding.UTF8).Trim();
            return text.Length == 0 ? null : text;
        }
        catch
        {
            return null;
        }
    }

    /** Minimal JSON string encoding for one Windows path. */
    private static string JsonString(string value)
    {
        StringBuilder text = new StringBuilder(value.Length + 8);
        text.Append('"');
        foreach (char ch in value)
        {
            switch (ch)
            {
                case '"': text.Append("\\\""); break;
                case '\\': text.Append("\\\\"); break;
                case '\b': text.Append("\\b"); break;
                case '\f': text.Append("\\f"); break;
                case '\n': text.Append("\\n"); break;
                case '\r': text.Append("\\r"); break;
                case '\t': text.Append("\\t"); break;
                default:
                    if (ch < ' ') text.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                    else text.Append(ch);
                    break;
            }
        }
        text.Append('"');
        return text.ToString();
    }
}
