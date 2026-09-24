using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;

// The managed installer owns this record. The launcher has no account, Service,
// update, or fallback policy: it forwards argv and stdio to that exact version.
static class ManagedCliLauncher {
  internal static int Run(string[] args) {
    string binary = Environment.ProcessPath ?? throw new InvalidOperationException("Missing executable path");
    string bin = Path.GetDirectoryName(binary);
    if (!string.Equals(Path.GetFileName(bin), "bin", StringComparison.OrdinalIgnoreCase))
      throw new InvalidOperationException("Invalid managed launcher location");
    using JsonDocument record = JsonDocument.Parse(File.ReadAllText(Path.Combine(bin, "cli-installation.json")));
    JsonElement installation = record.RootElement;
    if (installation.GetProperty("schemaVersion").GetInt32() != 1)
      throw new InvalidOperationException("Unsupported managed installation record");
    string version = installation.GetProperty("version").GetString();
    // One safe directory segment; the installer owns semantic-version policy.
    if (version == null || version.Length > 128 ||
        !Regex.IsMatch(version, @"\A[0-9][0-9A-Za-z.+-]*\z", RegexOptions.CultureInvariant))
      throw new InvalidOperationException("Invalid managed version");
    string target = Path.Combine(Path.GetDirectoryName(bin), "versions", version, "openmeld.exe");
    var start = new ProcessStartInfo(target) { UseShellExecute = false };
    foreach (string arg in args) start.ArgumentList.Add(arg);
    using Process child = Process.Start(start) ?? throw new InvalidOperationException("CLI did not start");
    // The child shares the console and receives Ctrl+C itself. Keep the launcher
    // alive to return its actual exit status instead of abandoning the child.
    Console.CancelKeyPress += (_, signal) => signal.Cancel = true;
    child.WaitForExit();
    return child.ExitCode;
  }
}
