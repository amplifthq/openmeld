using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;

// An installation concern only: no machine-wide PATH, elevation, or shell profile.
static class ManagedCommandPath {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr SendMessageTimeoutW(IntPtr window, uint message, UIntPtr wParam,
    string lParam, uint flags, uint timeout, out UIntPtr result);

  public static string Activate(string binDirectory) {
    if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
    if (!Path.IsPathFullyQualified(binDirectory) || binDirectory.Contains(';') ||
        !File.Exists(Path.Combine(binDirectory, "openmeld.exe")))
      throw new ArgumentException("Invalid managed command directory");
    // Already fully qualified and checked above. Preserve its spelling: the
    // installer may legitimately use an 8.3 profile path supplied by Windows.
    string bin = Path.TrimEndingDirectorySeparator(binDirectory);
    using RegistryKey key = Registry.CurrentUser.CreateSubKey("Environment", true);
    object raw = key.GetValue("Path", null, RegistryValueOptions.DoNotExpandEnvironmentNames);
    RegistryValueKind kind = raw == null ? RegistryValueKind.ExpandString : key.GetValueKind("Path");
    if ((kind != RegistryValueKind.String && kind != RegistryValueKind.ExpandString) ||
        (raw != null && raw is not string))
      throw new InvalidDataException("Unexpected user PATH type");
    string previous = raw as string ?? "";
    var entries = new List<string> { bin };
    if (previous.Length > 0) {
      foreach (string entry in previous.Split(';')) {
        // Preserve every unrelated entry verbatim, including expandable values.
        string expanded = kind == RegistryValueKind.ExpandString
          ? Environment.ExpandEnvironmentVariables(entry) : entry;
        string comparable = Path.TrimEndingDirectorySeparator(expanded.Trim().Trim('"'));
        if (!string.Equals(comparable, bin, StringComparison.OrdinalIgnoreCase)) entries.Add(entry);
      }
    }
    string next = string.Join(';', entries);
    if (string.Equals(previous, next, StringComparison.Ordinal)) return "already_active";
    if (next.Length >= 32767) throw new InvalidDataException("User PATH is too long");
    key.SetValue("Path", next, kind);
    // Persistence is authoritative. A hung recipient cannot block installation.
    // Existing terminal processes retain their own inherited environment.
    SendMessageTimeoutW(new IntPtr(0xffff), 0x001a, UIntPtr.Zero, "Environment",
      0x0002, 1000, out _);
    return "activated";
  }
}
