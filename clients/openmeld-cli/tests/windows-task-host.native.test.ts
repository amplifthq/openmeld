import { execFile, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { windowsUserTaskActionSchema } from "@openmeld/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  daemonRuntimeRootPath,
  withDaemonServiceRunLock,
} from "../src/config/daemon-state";
import { buildDaemonSystemServiceCommandSpec } from "../src/local-service/lifecycle/daemon-service-command-spec";
import { resolveDaemonServiceIdentity } from "../src/local-service/lifecycle/daemon-service-identity";
import { resolveDaemonServiceManager } from "../src/local-service/lifecycle/daemon-service-manager";
import {
  WINDOWS_TASK_HOST_INSTALL_SCRIPT,
  WINDOWS_TASK_HOST_SUFFIX,
} from "../src/local-service/lifecycle/windows-task-host";
import {
  readWindowsTaskAction,
  runWindowsUserTask,
  windowsPowerShellPath,
  windowsTaskActionArguments,
} from "../src/local-service/lifecycle/windows-user-task";
import { withTempHome } from "./helpers/fs";
import {
  readTaskActionPayload,
  withStoredTaskActionPayload,
} from "./helpers/windows-task-action-fixture";

const execFileAsync = promisify(execFile);
const nativeArguments = (script: string) => [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-WindowStyle",
  "Hidden",
  "-EncodedCommand",
  Buffer.from(script, "utf16le").toString("base64"),
];

async function powershell(script: string, env = process.env) {
  return await execFileAsync(
    windowsPowerShellPath(),
    nativeArguments(
      `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n${script}`
    ),
    {
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    }
  );
}

// This is native PE/process evidence, not a screenshot or a human Desktop smoke.
// All paths, task names and processes are disposable; never touch a real Service.
describe.skipIf(process.platform !== "win32")(
  "Windows console-free task host",
  () => {
    let root: string;
    let host: string;
    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "OpenMeld task host 空格 "));
      host = join(root, `fixture${WINDOWS_TASK_HOST_SUFFIX}`);
      await powershell(
        `$ErrorActionPreference='Stop'; $task=$null; $hostPath=$env:OPENMELD_TEST_HOST; ${WINDOWS_TASK_HOST_INSTALL_SCRIPT}`,
        {
          ...process.env,
          OPENMELD_TEST_HOST: host,
        }
      );
    }, 30_000);
    afterAll(async () => {
      if (root) {
        await rm(root, { recursive: true, force: true, maxRetries: 3 });
      }
    });

    it("is a GUI executable and creates no console for the outer PowerShell, preserving its failure", async () => {
      const image = await readFile(host);
      const pe = image.readUInt32LE(0x3c);
      expect(image.subarray(pe, pe + 4).toString("hex")).toBe("50450000");
      // IMAGE_SUBSYSTEM_WINDOWS_GUI (2), not WINDOWS_CUI (3). A parent-side hide
      // flag must not be what makes this test pass.
      expect(image.readUInt16LE(pe + 24 + 68)).toBe(2);
      const result = spawnSync(
        host,
        nativeArguments(`
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
[Console]::WriteLine('console=' + [ConsoleProbe]::GetConsoleWindow().ToInt64())
[Console]::Error.WriteLine('fixture diagnostic')
exit 23
`),
        { windowsHide: false, timeout: 30_000 }
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(23);
      const log = await readFile(`${host}.log`, "utf8");
      expect(log).toContain("console=0");
      expect(log).toContain("fixture diagnostic");
    });

    it.each([
      0, 7,
    ])("preserves the existing Node action, environment, logs and exit %s", async (code) => {
      const logPath = join(root, `node-${code}.log`);
      const expected =
        'a value with spaces, 中文, %PATH%, &, "quotes", $HOME and \\';
      const action = windowsTaskActionArguments({
        executable: process.execPath,
        args: [
          "-e",
          "console.log(JSON.stringify({arg:process.argv[1],env:process.env.OPENMELD_TEST_VALUE}));console.error('node stderr');process.exit(Number(process.argv[2]))",
          expected,
          String(code),
        ],
        env: { OPENMELD_TEST_VALUE: expected },
        logPath,
      });
      const result = spawnSync(host, action.split(" "), {
        windowsHide: false,
        cwd: root,
        timeout: 30_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(code);
      const log = await readFile(logPath, "utf8");
      expect(log).toContain(JSON.stringify({ arg: expected, env: expected }));
      expect(log).toContain("node stderr");
    });

    it("installs the real Service specification and reads it back through the Service manager", async () => {
      await withTempHome(async () => {
        process.env.OPENMELD_ENV_PRESET = "dev-local";
        const manager = await resolveDaemonServiceManager("windows-service");
        if (!manager) {
          throw new Error("Native Windows task manager is unavailable.");
        }
        const spec = buildDaemonSystemServiceCommandSpec({
          controller: "windows-service",
          distribution: "npm",
        });
        const identity = resolveDaemonServiceIdentity();
        const request = {
          name: identity.windowsServiceName,
          legacyScript: join(
            daemonRuntimeRootPath(),
            `${identity.serviceName}-runner.bat`
          ),
        };
        try {
          // No start: exercise the actual production install -> status assertion
          // with a unique dev-local registration and no authenticated Service.
          await withDaemonServiceRunLock(
            async () => await manager.install(spec)
          );
          const status = await manager.status();
          expect(status).toMatchObject({
            installed: true,
            enabled: true,
            running: false,
          });
          expect(status.commandSpec).toMatchObject({
            executable: spec.executable,
            args: spec.args,
            env: spec.env,
          });
          const task = await runWindowsUserTask({
            ...request,
            operation: "status",
          });
          expect(
            windowsUserTaskActionSchema.parse(
              readTaskActionPayload(task.actionArguments ?? "")
            )
          ).toEqual(status.commandSpec);
          // The existing-task ownership reader must also permit a second install.
          await withDaemonServiceRunLock(
            async () => await manager.install(spec)
          );
        } finally {
          // Cleanup still works if a future regression breaks manager.status().
          await runWindowsUserTask({ ...request, operation: "uninstall" });
        }
      });
    }, 60_000);

    it("migrates only an owned stopped PowerShell task and retains the per-user hourly policy", async () => {
      const request = {
        name: `OpenMeld-Test-${randomUUID()}`,
        legacyScript: join(root, "legacy.cmd"),
      };
      const spec = {
        executable: process.execPath,
        args: ["-e", "process.exit(0)"],
        env: { OPENMELD_HOME: root },
        logPath: join(root, "migration.log"),
        workingDirectory: root,
        pendingJobPath: join(root, "service-update.json"),
      };
      const action = windowsTaskActionArguments(spec);
      const storedAction = withStoredTaskActionPayload(action, spec);
      const env = {
        ...process.env,
        OPENMELD_TEST_NAME: request.name,
        OPENMELD_TEST_ACTION: storedAction,
      };
      const taskLookup = String.raw`
$ErrorActionPreference='Stop'
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$scheduler=New-Object -ComObject 'Schedule.Service'; $scheduler.Connect()
$folder=$scheduler.GetFolder('\'); $name=$env:OPENMELD_TEST_NAME+'-'+$sid
`;
      try {
        // Seed the actual pre-fix registration shape, disabled so no interactive
        // session is needed and no old visible process is launched by this test.
        await powershell(
          `${taskLookup}
$d=$scheduler.NewTask(0); $d.Principal.UserId=$sid; $d.Principal.LogonType=3; $d.Principal.RunLevel=0
$d.Settings.Enabled=$false
$a=$d.Actions.Create(0); $a.Path=Join-Path $PSHOME 'powershell.exe'; $a.Arguments=$env:OPENMELD_TEST_ACTION
$null=$folder.RegisterTaskDefinition($name,$d,6,$sid,$null,3,$null)
`,
          env
        );
        expect(
          readWindowsTaskAction(
            (await runWindowsUserTask({ ...request, operation: "status" }))
              .actionArguments ?? ""
          ).env.OPENMELD_HOME
        ).toBe(root);
        expect(
          existsSync(request.legacyScript + WINDOWS_TASK_HOST_SUFFIX)
        ).toBe(false);
        const install = {
          ...request,
          operation: "install" as const,
          executable: windowsPowerShellPath(),
          arguments: action,
          workingDirectory: root,
          periodic: true,
        };
        // A matching task name alone must not authorize taking over another host.
        await powershell(
          `${taskLookup}
$d=$folder.GetTask($name).Definition; $d.Actions.Item(1).Path=Join-Path $env:SystemRoot 'System32\\cmd.exe'
$null=$folder.RegisterTaskDefinition($name,$d,6,$sid,$null,3,$null)
`,
          env
        );
        await expect(runWindowsUserTask(install)).rejects.toThrow();
        expect(
          existsSync(request.legacyScript + WINDOWS_TASK_HOST_SUFFIX)
        ).toBe(false);
        await powershell(
          `${taskLookup}
$d=$folder.GetTask($name).Definition; $d.Actions.Item(1).Path=Join-Path $PSHOME 'powershell.exe'
$null=$folder.RegisterTaskDefinition($name,$d,6,$sid,$null,3,$null)
`,
          env
        );
        await runWindowsUserTask(install);
        // Reinstallation uses atomic replacement; a cached path is not enough to
        // silently skip compiling the current fixed source.
        await runWindowsUserTask(install);
        await runWindowsUserTask({ ...request, operation: "disable" });
        const installed = await runWindowsUserTask({
          ...request,
          operation: "status",
        });
        expect(
          windowsUserTaskActionSchema.parse(
            readTaskActionPayload(installed.actionArguments ?? "")
          )
        ).toEqual({
          executable: spec.executable,
          args: spec.args,
          env: spec.env,
          logPath: spec.logPath,
        });
        const observed = await powershell(
          `${taskLookup}
$d=$folder.GetTask($name).Definition
$user=$d.Principal.UserId
if ($user -notmatch '^S-[0-9]-') { $user=([Security.Principal.NTAccount]$user).Translate([Security.Principal.SecurityIdentifier]).Value }
@{path=$d.Actions.Item(1).Path; arguments=$d.Actions.Item(1).Arguments; user=$user; sid=$sid; logon=$d.Principal.LogonType; level=$d.Principal.RunLevel; interval=$d.Triggers.Item(2).Repetition.Interval; limit=$d.Settings.ExecutionTimeLimit} | ConvertTo-Json -Compress
`,
          env
        );
        expect(JSON.parse(observed.stdout)).toMatchObject({
          path: request.legacyScript + WINDOWS_TASK_HOST_SUFFIX,
          arguments: action,
          logon: 3,
          level: 0,
          interval: "PT1H",
          limit: "PT0S",
        });
        const { user, sid } = JSON.parse(observed.stdout);
        expect(user).toBe(sid);
      } finally {
        // Cleanup owns this unique fixture even when the negative case made the
        // product correctly refuse to control it. No other tasks are enumerated.
        await powershell(`${taskLookup}\n$folder.DeleteTask($name,0)`, env);
      }
    }, 60_000);
  }
);
