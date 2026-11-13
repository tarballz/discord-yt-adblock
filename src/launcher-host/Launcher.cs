// Tiny Windows (GUI-subsystem) launcher, compiled on the user's machine at
// install time with the C# compiler that ships with .NET Framework.
//
// Why it exists: Windows' Startup apps list (Task Manager / Settings) names a
// login entry after the program it runs. Running node through conhost.exe
// showed up as "Console Window Host"; this program shows up as
// "Discord (no YT ads)". It also starts node without a console window.
//
// Usage: discord-no-yt-ads.exe <node.exe> <script.js> [args...]
// Starts node with the script and arguments, then exits immediately.
// (C# 5 only: that's what the .NET Framework compiler supports.)
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

[assembly: AssemblyTitle("Discord (no YT ads)")]
[assembly: AssemblyDescription("Starts Discord with YouTube ads blocked")]
[assembly: AssemblyProduct("discord-yt-adblock")]
[assembly: AssemblyCompany("discord-yt-adblock")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Launcher
{
    static int Main(string[] args)
    {
        if (args.Length < 2) return 2;
        var arguments = new StringBuilder();
        for (int i = 1; i < args.Length; i++)
        {
            if (i > 1) arguments.Append(' ');
            arguments.Append(Quote(args[i]));
        }
        var info = new ProcessStartInfo(args[0], arguments.ToString());
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        // Never the install folder: a process's working directory locks that folder.
        info.WorkingDirectory = Path.GetDirectoryName(args[0]) ?? Environment.CurrentDirectory;
        try
        {
            Process.Start(info);
            return 0;
        }
        catch (Exception)
        {
            return 1;
        }
    }

    // Quotes one argument so the C runtime / CommandLineToArgvW parse it back exactly.
    static string Quote(string arg)
    {
        if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
        var sb = new StringBuilder("\"");
        int backslashes = 0;
        foreach (char c in arg)
        {
            if (c == '\\') { backslashes++; continue; }
            if (c == '"') sb.Append('\\', backslashes * 2 + 1);
            else sb.Append('\\', backslashes);
            backslashes = 0;
            sb.Append(c);
        }
        sb.Append('\\', backslashes * 2);
        sb.Append('"');
        return sb.ToString();
    }
}
