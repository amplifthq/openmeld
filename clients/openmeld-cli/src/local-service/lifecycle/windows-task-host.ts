// Task Scheduler must start a Windows-subsystem executable, not a console
// executable that hides its window after startup. Keep the existing encoded
// PowerShell action as the command/environment/logging owner.
// Windows PowerShell 5.1 compiles this fixed source during guarded installation;
// no SDK, downloaded executable, WSH/VBScript, or administrator access is needed.
export const WINDOWS_TASK_HOST_SOURCE = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;

public static class OpenMeldTaskHostV1 {
  public static int Main(string[] args) {
    string logPath = Assembly.GetExecutingAssembly().Location + ".log";
    try {
      // Accept only the existing OpenMeld action, never an arbitrary executable
      // or a shell-interpolated command line. Base64 contains no quoting syntax.
      if (args.Length != 7 || args[0] != "-NoLogo" || args[1] != "-NoProfile" ||
          args[2] != "-NonInteractive" || args[3] != "-WindowStyle" ||
          args[4] != "Hidden" || args[5] != "-EncodedCommand" ||
          !Regex.IsMatch(args[6], @"\A[A-Za-z0-9+/]+={0,2}\z"))
        throw new ArgumentException("Invalid OpenMeld task arguments.");
      Convert.FromBase64String(args[6]);
      var start = new ProcessStartInfo();
      start.FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
        @"WindowsPowerShell\v1.0\powershell.exe");
      start.Arguments = String.Join(" ", args);
      start.UseShellExecute = false;
      start.CreateNoWindow = true;
      start.RedirectStandardInput = true;
      start.RedirectStandardOutput = true;
      start.RedirectStandardError = true;
      using (var log = Stream.Synchronized(new FileStream(logPath, FileMode.Append,
          FileAccess.Write, FileShare.ReadWrite)))
      using (var child = new Process()) {
        child.StartInfo = start;
        child.Start();
        child.StandardInput.Close();
        var stdout = child.StandardOutput.BaseStream.CopyToAsync(log);
        var stderr = child.StandardError.BaseStream.CopyToAsync(log);
        // Do not detach or break away from Task Scheduler's process ownership.
        // The task remains running until the action completes, and restart-on-
        // failure still receives the action's real exit code.
        child.WaitForExit();
        stdout.GetAwaiter().GetResult();
        stderr.GetAwaiter().GetResult();
        return child.ExitCode;
      }
    } catch (Exception error) {
      try { File.AppendAllText(logPath, DateTime.UtcNow.ToString("o") + " " +
        error.GetType().Name + ": " + error.Message + Environment.NewLine, Encoding.UTF8); }
      catch { /* Task Scheduler still receives a nonzero result if logging fails. */ }
      return 1;
    }
  }
}
`;

// Per-task, lane-owned path: updating the maintenance host cannot replace the
// executable of a running main Service, or vice versa. Keep v1 stable; a future
// host format must explicitly support migration from this path.
export const WINDOWS_TASK_HOST_SUFFIX = ".task-host-v1.exe";

// The caller has already verified identity and acquired the lifecycle grant.
// Build beside the target and replace atomically, never overwrite a running
// host or fall back to a flashing console when compilation is unavailable.
export const WINDOWS_TASK_HOST_INSTALL_SCRIPT = `
$hostDirectory = [IO.Path]::GetDirectoryName($hostPath)
$null = [IO.Directory]::CreateDirectory($hostDirectory)
$temporaryHost = Join-Path $hostDirectory ([Guid]::NewGuid().ToString('N') + '.exe')
try {
  Add-Type -TypeDefinition @'
${WINDOWS_TASK_HOST_SOURCE}
'@ -OutputAssembly $temporaryHost -OutputType WindowsApplication -ErrorAction Stop
  if ($task -and $task.State -eq 4) { throw 'OpenMeld cannot replace a background task while it is running.' }
  if ([IO.File]::Exists($hostPath)) {
    [IO.File]::Replace($temporaryHost, $hostPath, $null)
  } else {
    [IO.File]::Move($temporaryHost, $hostPath)
  }
} finally {
  if ([IO.File]::Exists($temporaryHost)) { [IO.File]::Delete($temporaryHost) }
}
`;
