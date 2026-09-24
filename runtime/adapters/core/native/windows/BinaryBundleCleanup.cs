using System;
using System.Collections.Generic;
using System.IO;

// Windows cannot unlink a live image like POSIX. Acquire the entire known
// bundle before removing any file, excluding new readers/launches until done.
// The installer holds its transaction lock and has already protected current,
// rollback, active Service, and pending worker versions.
static class BinaryBundleCleanup {
  internal static string Run(string directory) {
    if (!Path.IsPathFullyQualified(directory))
      throw new ArgumentException("Invalid binary bundle path");
    if (!Directory.Exists(directory)) return "absent";
    if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
      throw new IOException("Managed version is a reparse point");
    string[] files = Directory.GetFileSystemEntries(directory);
    foreach (string file in files) {
      string name = Path.GetFileName(file);
      if (name != "openmeld.exe" && name != "openmeld-windows-process.exe")
        return "unrecognized";
      if ((File.GetAttributes(file) & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0)
        return "unrecognized";
    }
    var handles = new List<FileStream>();
    try {
      try {
        // A read handle alone does not reject an executable's image mapping.
        // Request write access (without writing) before deleting ANY companion.
        // Keep these handles until the complete bundle has been removed.
        foreach (string file in files)
          handles.Add(new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.Delete));
      } catch (IOException error) when ((error.HResult & 0xffff) == 32 || (error.HResult & 0xffff) == 33) {
        return "in_use";
      }
      foreach (string file in files) File.Delete(file);
    } finally {
      foreach (FileStream handle in handles) handle.Dispose();
    }
    Directory.Delete(directory);
    return "removed";
  }
}
