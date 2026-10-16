using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

static class IdleSleep {
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint SetThreadExecutionState(uint flags);

  public static int Run() {
    // Hold and release on this same native thread. No display/away-mode flags.
    if (SetThreadExecutionState(0x80000001) == 0)
      throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      Console.WriteLine("openmeld-idle-sleep-held-v1");
      Console.Out.Flush();
      // Closing the Service-owned pipe, including a crash, releases the request.
      while (Console.In.Read() != -1) { }
    } finally { SetThreadExecutionState(0x80000000); }
    return 0;
  }
}
