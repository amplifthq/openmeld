using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

// A console-subsystem witness at the real controller process boundary. It
// delegates the protocol to the pinned official Codex, never a mock RPC server.
internal static class WindowsConsoleProbe
{
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    private static int Main(string[] args)
    {
        bool hasConsole = GetConsoleWindow() != IntPtr.Zero;
        if (args.Length == 1 && args[0] == "--console-check")
        {
            Console.WriteLine(hasConsole ? "console" : "no-console");
            return 0;
        }
        if (hasConsole)
            throw new InvalidOperationException("Background probe allocated a console.");
        if (args.Length != 3 || args[0] != "app-server" ||
            args[1] != "--listen" || args[2] != "stdio://")
            throw new ArgumentException("Unexpected native probe invocation.");

        var start = new ProcessStartInfo(
            Environment.GetEnvironmentVariable("OPENMELD_TEST_CODEX"),
            "app-server --listen stdio://")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        using (var child = Process.Start(start))
        {
            Task.Run(async () => {
                var input = Console.OpenStandardInput();
                var output = child.StandardInput.BaseStream;
                var buffer = new byte[4096];
                int count;
                while ((count = await input.ReadAsync(buffer, 0, buffer.Length)) != 0)
                {
                    await output.WriteAsync(buffer, 0, count);
                    await output.FlushAsync();
                }
                child.StandardInput.Close();
            });
            var stdout = child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
            var stderr = child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
            child.WaitForExit();
            Task.WaitAll(stdout, stderr);
            return child.ExitCode;
        }
    }
}
