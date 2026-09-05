import { execFile } from "node:child_process";
import { win32 } from "node:path";
import { promisify } from "node:util";
import {
  type WindowsUserTaskRequest,
  windowsUserTaskActionSchema,
  windowsUserTaskRequestSchema,
  windowsUserTaskStatusSchema,
} from "@openmeld/schemas";

// Task Scheduler runs in the signed-in user's session, with that user's tokens
// and ordinary permissions. No password, elevation, or third-party service host.
// Native COM contracts: learn.microsoft.com/windows/win32/taskschd/
const TASK_CONTROL = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$r = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:OPENMELD_TASK_REQUEST)))
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($sid -in @('S-1-5-18','S-1-5-19','S-1-5-20')) { throw 'Run OpenMeld setup from your own Windows account, not a system account.' }
$scheduler = New-Object -ComObject 'Schedule.Service'
$scheduler.Connect()
$folder = $scheduler.GetFolder('\')
$name = $r.name + '-' + $sid
$task = $null
try { $task = $folder.GetTask($name) } catch {
  if ($_.Exception.GetBaseException().HResult -ne -2147024894) { throw }
}
# Migration only owns the exact legacy script in this lane. Never stop another
# user's or an administrator-customized service merely because its name matches.
$legacy = Get-CimInstance Win32_Service -Filter ("Name='" + $r.name.Replace("'","''") + "'")
if ($legacy -and $legacy.PathName.Trim('"') -ne $r.legacyScript) {
  throw 'An existing Windows service uses a different installation. Resolve that installation before continuing.'
}
switch ($r.operation) {
  'install' {
    if ($legacy -and $legacy.State -ne 'Stopped') { throw 'The previous OpenMeld Service must finish stopping before migration.' }
    if ($task -and $task.State -eq 4) { throw 'OpenMeld cannot replace a background task while it is running.' }
    $definition = $scheduler.NewTask(0)
    $definition.RegistrationInfo.Description = 'OpenMeld background process for the signed-in user.'
    $definition.Principal.UserId = $sid
    $definition.Principal.LogonType = 3
    $definition.Principal.RunLevel = 0
    $definition.Settings.Enabled = ($null -eq $legacy)
    $definition.Settings.Hidden = $true
    $definition.Settings.AllowDemandStart = $true
    $definition.Settings.DisallowStartIfOnBatteries = $false
    $definition.Settings.StopIfGoingOnBatteries = $false
    $definition.Settings.RunOnlyIfNetworkAvailable = $false
    $definition.Settings.StartWhenAvailable = $true
    $definition.Settings.ExecutionTimeLimit = 'PT0S'
    $definition.Settings.MultipleInstances = 2
    $definition.Settings.RestartInterval = 'PT1M'
    $definition.Settings.RestartCount = 999
    $trigger = $definition.Triggers.Create(9)
    $trigger.UserId = $sid
    if ($r.periodic) {
      $timer = $definition.Triggers.Create(1)
      $timer.StartBoundary = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')
      $timer.Repetition.Interval = 'PT1H'
    }
    $action = $definition.Actions.Create(0)
    $action.Path = $r.executable
    $action.Arguments = $r.arguments
    $action.WorkingDirectory = $r.workingDirectory
    $task = $folder.RegisterTaskDefinition($name, $definition, 6, $sid, $null, 3, $null)
    if ($legacy) {
      try {
        $deleted = Invoke-CimMethod -InputObject $legacy -MethodName Delete
        if ($deleted.ReturnValue -ne 0) { throw ('Cannot remove the old Windows Service (code ' + $deleted.ReturnValue + '). An administrator must remove the old registration before setup can continue.') }
      } catch {
        $folder.DeleteTask($name,0)
        throw
      }
      $task.Enabled = $true
    }
    $legacy = $null
  }
  'start' { if (!$task) { throw 'OpenMeld background task is not installed. Run setup to repair it.' }; $null = $task.Run($null) }
  'enable' { if ($task) { $task.Enabled = $true } }
  'disable' { if ($task) { $task.Enabled = $false }; if ($legacy) { $result = Invoke-CimMethod -InputObject $legacy -MethodName ChangeStartMode -Arguments @{StartMode='Manual'}; if ($result.ReturnValue -ne 0) { throw 'Cannot disable the old Windows Service. Administrator assistance is required.' } } }
  'stop' {
    if ($task) { $task.Stop(0) }
    if ($legacy -and $legacy.State -ne 'Stopped') {
      $result = Invoke-CimMethod -InputObject $legacy -MethodName StopService
      if ($result.ReturnValue -notin @(0,6)) { throw 'Cannot stop the old Windows Service. Administrator assistance is required.' }
    }
  }
  'uninstall' {
    if ($task) { $task.Stop(0); $folder.DeleteTask($name,0); $task = $null }
    if ($legacy) {
      if ($legacy.State -ne 'Stopped') { throw 'The old OpenMeld Service is still running.' }
      $result = Invoke-CimMethod -InputObject $legacy -MethodName Delete
      if ($result.ReturnValue -ne 0) { throw 'Cannot remove the old Windows Service. Administrator assistance is required.' }
      $legacy = $null
    }
  }
  'status' { }
  default { throw 'Unknown OpenMeld task operation.' }
}
@{ installed=($null -ne $task -or $null -ne $legacy); running=($(if ($task) { $task.State -eq 4 } else { $legacy -and $legacy.State -ne 'Stopped' })); enabled=($(if ($task) { [bool]$task.Enabled } else { $legacy -and $legacy.StartMode -eq 'Auto' })); legacy=($null -ne $legacy); actionArguments=($(if ($task) { $task.Definition.Actions.Item(1).Arguments } else { $null })) } | ConvertTo-Json -Compress
`;

export function windowsPowerShellPath(): string {
  const root = process.env.SystemRoot;
  if (!(root && win32.isAbsolute(root))) {
    throw new Error("Windows system directory is unavailable.");
  }
  return win32.join(
    root,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
}

export function windowsTaskActionArguments(input: {
  executable: string;
  args: string[];
  env: Record<string, string>;
  logPath: string;
}): string {
  const data = Buffer.from(JSON.stringify(input)).toString("base64");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$c = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')))
function Quote-ProcessArgument([string]$value) {
  '"' + [regex]::Replace([regex]::Replace($value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = $c.executable
$start.Arguments = (@($c.args | ForEach-Object { Quote-ProcessArgument $_ }) -join ' ')
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
foreach ($property in $c.env.PSObject.Properties) { $start.EnvironmentVariables[$property.Name] = [string]$property.Value }
$log = [IO.Stream]::Synchronized([IO.File]::Open($c.logPath, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite))
$process = New-Object Diagnostics.Process
$process.StartInfo = $start
try {
  $null = $process.Start()
  $stdout = $process.StandardOutput.BaseStream.CopyToAsync($log)
  $stderr = $process.StandardError.BaseStream.CopyToAsync($log)
  $process.WaitForExit()
  $stdout.GetAwaiter().GetResult()
  $stderr.GetAwaiter().GetResult()
  $exitCode = $process.ExitCode
} finally {
  $log.Dispose()
  $process.Dispose()
}
exit $exitCode
`;
  return `-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

const ENCODED_ACTION_PATTERN = /-EncodedCommand ([A-Za-z0-9+/=]+)$/u;
const ACTION_DATA_PATTERN = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/u;

export function readWindowsTaskAction(argumentsText: string) {
  const encoded = argumentsText.match(ENCODED_ACTION_PATTERN)?.[1];
  const data =
    encoded &&
    Buffer.from(encoded, "base64")
      .toString("utf16le")
      .match(ACTION_DATA_PATTERN)?.[1];
  if (!data) {
    throw new Error(
      "Windows task does not contain an OpenMeld launch command."
    );
  }
  const action = windowsUserTaskActionSchema.safeParse(
    JSON.parse(Buffer.from(data, "base64").toString("utf8"))
  );
  if (!action.success) {
    throw new Error(
      "Windows task contains an invalid OpenMeld launch command."
    );
  }
  return action.data;
}

export async function runWindowsUserTask(
  request: WindowsUserTaskRequest
): Promise<{
  installed: boolean;
  running: boolean;
  enabled: boolean;
  legacy: boolean;
  actionArguments: string | null;
}> {
  const result = await promisify(execFile)(
    windowsPowerShellPath(),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(TASK_CONTROL, "utf16le").toString("base64"),
    ],
    {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        OPENMELD_TASK_REQUEST: Buffer.from(
          JSON.stringify(windowsUserTaskRequestSchema.parse(request))
        ).toString("base64"),
      },
    }
  );
  const status = windowsUserTaskStatusSchema.safeParse(
    JSON.parse(result.stdout.trim())
  );
  if (!status.success) {
    throw new Error("Windows returned an invalid OpenMeld task status.");
  }
  return status.data;
}
