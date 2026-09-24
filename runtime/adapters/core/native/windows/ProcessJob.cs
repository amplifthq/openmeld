// Windows 10+ STARTUPINFOEX job-list assignment is atomic with process creation.
// Do not replace it with CreateProcess + AssignProcessToJobObject: death between
// those calls would strand a child outside the ownership boundary.
// References: Microsoft CreateProcessW, UpdateProcThreadAttribute, Job Objects.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class OpenMeldProcessJobV1 {
  const uint WaitTimeout = 258;
  const uint WaitFailed = 0xffffffff;
  const uint KillOnClose = 0x2000;
  const uint ExtendedStartup = 0x00080000;
  const uint NoWindow = 0x08000000;
  const uint UnicodeEnvironment = 0x00000400;

  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long ProcessTime, JobTime;
    public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {
    public ulong ReadOperations, WriteOperations, OtherOperations;
    public ulong ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits Basic;
    public IoCounters Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
    public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct StartupInfo {
    public uint Size;
    public string Reserved, Desktop, Title;
    public uint X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
    public ushort ShowWindow, ReservedBytes;
    public IntPtr ReservedPointer, StandardInput, StandardOutput, StandardError;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx {
    public StartupInfo Startup;
    public IntPtr Attributes;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
    public IntPtr Process, Thread;
    public uint ProcessId, ThreadId;
  }

  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObjectW(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting info, uint size, IntPtr length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnedSize);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfoEx startup, out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);

  static void Check(bool ok, string operation) {
    if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
  }
  static IntPtr DuplicateStandard(int kind) {
    IntPtr original = GetStdHandle(kind), copied;
    if (original == IntPtr.Zero || original == new IntPtr(-1)) throw new InvalidOperationException("Standard stream unavailable");
    Check(DuplicateHandle(GetCurrentProcess(), original, GetCurrentProcess(), out copied, 0, true, 2), "DuplicateHandle");
    return copied;
  }
  static void WaitUntilEmpty(IntPtr job, bool terminate) {
    if (terminate) Check(TerminateJobObject(job, 1223), "TerminateJobObject");
    Stopwatch clock = Stopwatch.StartNew();
    while (true) {
      Accounting state;
      Check(QueryInformationJobObject(job, 1, out state, (uint)Marshal.SizeOf<Accounting>(), IntPtr.Zero), "QueryInformationJobObject");
      if (state.ActiveProcesses == 0) return;
      if (clock.ElapsedMilliseconds > 10000) throw new TimeoutException("Windows process cleanup was not confirmed");
      Thread.Sleep(25);
    }
  }
  public static string ReadIdentity(int pid) {
    IntPtr process = OpenProcess(0x00101000, false, pid);
    Check(process != IntPtr.Zero, "Open identity process");
    try {
      long started, exited, kernel, user;
      Check(GetProcessTimes(process, out started, out exited, out kernel, out user), "Read process identity");
      if (WaitForSingleObject(process, 0) != WaitTimeout) return null;
      return started.ToString(CultureInfo.InvariantCulture);
    } finally { CloseHandle(process); }
  }
  public static void VerifyDrained(string name) {
    IntPtr job = OpenJobObjectW(4, false, name);
    if (job == IntPtr.Zero) {
      int error = Marshal.GetLastWin32Error();
      // After the supervisor exits, absence means no owner or associated process
      // remains. No delayed launcher can subsequently create this Job.
      if (error == 2) return;
      throw new Win32Exception(error, "OpenJobObjectW");
    }
    try { WaitUntilEmpty(job, false); } finally { CloseHandle(job); }
  }
  public static int Run(string name, string executable, string command, string cwd, int ownerPid, string ownerStartedAt) {
    IntPtr owner = IntPtr.Zero, job = IntPtr.Zero, attributes = IntPtr.Zero;
    IntPtr jobs = IntPtr.Zero, handles = IntPtr.Zero;
    IntPtr input = IntPtr.Zero, output = IntPtr.Zero, errorOutput = IntPtr.Zero;
    ProcessInfo child = new ProcessInfo();
    bool attributesInitialized = false;
    try {
      owner = OpenProcess(0x00101000, false, ownerPid);
      Check(owner != IntPtr.Zero, "Open owner process");
      long started, exited, kernel, user;
      Check(GetProcessTimes(owner, out started, out exited, out kernel, out user), "GetProcessTimes");
      if (started.ToString(CultureInfo.InvariantCulture) != ownerStartedAt || WaitForSingleObject(owner, 0) != WaitTimeout)
        throw new InvalidOperationException("The launch owner is no longer alive");
      job = CreateJobObjectW(IntPtr.Zero, name);
      int createError = Marshal.GetLastWin32Error();
      Check(job != IntPtr.Zero, "CreateJobObjectW");
      if (createError == 183) throw new InvalidOperationException("Job identity collision");
      ExtendedLimits limits = new ExtendedLimits();
      limits.Basic.Flags = KillOnClose;
      Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>()), "SetInformationJobObject");

      IntPtr size = IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
      if (size == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Attribute list size");
      attributes = Marshal.AllocHGlobal(size);
      Check(InitializeProcThreadAttributeList(attributes, 2, 0, ref size), "InitializeProcThreadAttributeList");
      attributesInitialized = true;
      jobs = Marshal.AllocHGlobal(IntPtr.Size);
      Marshal.WriteIntPtr(jobs, job);
      // PROC_THREAD_ATTRIBUTE_JOB_LIST: no attach-after-spawn race, no breakaway.
      Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x0002000d), jobs, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "Set atomic Job assignment");
      input = DuplicateStandard(-10); output = DuplicateStandard(-11); errorOutput = DuplicateStandard(-12);
      handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
      Marshal.WriteIntPtr(handles, 0, input); Marshal.WriteIntPtr(handles, IntPtr.Size, output); Marshal.WriteIntPtr(handles, IntPtr.Size * 2, errorOutput);
      Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x00020002), handles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero), "Set inherited streams");
      StartupInfoEx startup = new StartupInfoEx();
      startup.Startup.Size = (uint)Marshal.SizeOf<StartupInfoEx>();
      startup.Startup.Flags = 0x100;
      startup.Startup.StandardInput = input; startup.Startup.StandardOutput = output; startup.Startup.StandardError = errorOutput;
      startup.Attributes = attributes;
      Check(CreateProcessW(executable, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true, ExtendedStartup | NoWindow | UnicodeEnvironment, IntPtr.Zero, cwd, ref startup, out child), "CreateProcessW in Job");
      CloseHandle(input); input = IntPtr.Zero; CloseHandle(output); output = IntPtr.Zero; CloseHandle(errorOutput); errorOutput = IntPtr.Zero;
      while (true) {
        uint wait = WaitForSingleObject(child.Process, 100);
        if (wait == 0) break;
        Check(wait != WaitFailed, "Wait for controller");
        if (WaitForSingleObject(owner, 0) != WaitTimeout) {
          WaitUntilEmpty(job, true);
          return 1223;
        }
      }
      uint exitCode;
      Check(GetExitCodeProcess(child.Process, out exitCode), "GetExitCodeProcess");
      CloseHandle(child.Thread); child.Thread = IntPtr.Zero;
      CloseHandle(child.Process); child.Process = IntPtr.Zero;
      WaitUntilEmpty(job, true);
      return unchecked((int)exitCode);
    } finally {
      if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
      if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
      if (job != IntPtr.Zero) CloseHandle(job);
      if (owner != IntPtr.Zero) CloseHandle(owner);
      if (input != IntPtr.Zero) CloseHandle(input);
      if (output != IntPtr.Zero) CloseHandle(output);
      if (errorOutput != IntPtr.Zero) CloseHandle(errorOutput);
      if (attributesInitialized) DeleteProcThreadAttributeList(attributes);
      if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
      if (jobs != IntPtr.Zero) Marshal.FreeHGlobal(jobs);
      if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
    }
  }
}
