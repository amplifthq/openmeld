import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { powerShellEncodedArguments } from "@openmeld/adapter-core/windows-system";
import { describe, expect, it, vi } from "vitest";
import { buildDaemonServiceUpdateWorkerSpec } from "../src/local-service/lifecycle/daemon-service-update-worker-manager";
import { windowsDirectTaskArguments } from "../src/local-service/lifecycle/windows-task-command";
import {
  readWindowsTaskAction,
  runWindowsUserTask,
  windowsPowerShellPath,
  windowsTaskActionArguments,
} from "../src/local-service/lifecycle/windows-user-task";
import { withTempHome } from "./helpers/fs";

const exec = promisify(execFile);
const LOG_LINES = /\r?\n/u;
describe.skipIf(process.platform !== "win32")(
  "native direct task registration",
  () => {
    it("registers the maintenance action from a default-home setup", async () => {
      const artifact = process.env.OPENMELD_TEST_HOST_BINARY;
      if (!artifact) {
        throw new Error(
          "Build and supply the actual Windows Service artifact."
        );
      }
      await withTempHome(async (tempHome) => {
        // The public setup leaves OPENMELD_HOME unset; use an isolated HOME so
        // this test never registers against the runner's real user state.
        Reflect.deleteProperty(process.env, "OPENMELD_HOME");
        process.env.OPENMELD_ENV_PRESET = "prod";
        const home = join(tempHome, ".openmeld");
        const runtime = join(home, "runtime", "daemon");
        const fingerprint = "a".repeat(64);
        const executable = join(
          runtime,
          "bundles",
          `maintenance-${fingerprint}`,
          "openmeld.exe"
        );
        await mkdir(dirname(executable), { recursive: true });
        await copyFile(artifact, executable);
        const spec = await buildDaemonServiceUpdateWorkerSpec({
          preparedBundle: {
            v: 2,
            schema: "openmeld-daemon-active-bundle-v2",
            bundleFormat: "binary_v1",
            bundleId: "native-default-home",
            createdAt: "2026-09-26T00:00:00.000Z",
            daemonVersion: "0.3.0",
            entryScriptRelativePath: "openmeld.exe",
            sourceDistFingerprint: fingerprint,
            sourceDistRootPath: dirname(executable),
            sourceEntryScriptPath: executable,
            sourceKind: "package_install",
            sourcePackageRootPath: dirname(executable),
            updatedAt: "2026-09-26T00:00:00.000Z",
          },
        });
        expect(spec.env.OPENMELD_HOME).toBe(home);
        const request = {
          name: `OpenMeld-Default-Home-${randomUUID()}`,
          legacyScript: join(runtime, "service-update-worker.bat"),
        };
        try {
          await runWindowsUserTask({
            ...request,
            operation: "install",
            executable: spec.executable,
            arguments: windowsDirectTaskArguments({
              ...spec,
              logPath: join(runtime, "worker.log"),
            }),
            workingDirectory: spec.workingDirectory,
            periodic: true,
          });
          expect(
            await runWindowsUserTask({ ...request, operation: "status" })
          ).toMatchObject({ installed: true, legacy: false });
        } finally {
          await runWindowsUserTask({ ...request, operation: "uninstall" });
        }
      });
    }, 90_000);

    it("migrates an owned stopped legacy action to the verified GUI entry and rejects a different lane", async () => {
      const artifact = process.env.OPENMELD_TEST_HOST_BINARY;
      if (!artifact) {
        throw new Error(
          "Build and supply the actual Windows Service artifact."
        );
      }
      await withTempHome(async () => {
        const home = process.env.OPENMELD_HOME;
        if (!home) {
          throw new Error("Fixture home missing.");
        }
        const runtime = join(home, "runtime", "daemon");
        const executable = join(runtime, "bundles", "fixture", "openmeld.exe");
        await mkdir(dirname(executable), { recursive: true });
        await copyFile(artifact, executable);
        const request = {
          name: `OpenMeld-Direct-Test-${randomUUID()}`,
          legacyScript: join(runtime, "service-update-worker.bat"),
        };
        const action = {
          executable,
          args: ["service", "update-worker"],
          env: { OPENMELD_HOME: home },
          logPath: join(runtime, "worker.log"),
        };
        const historical = windowsTaskActionArguments({
          ...action,
          executable: process.execPath,
          args: ["fixture-old-entry.js", ...action.args],
        });
        const prefix = String.raw`
$ErrorActionPreference='Stop'
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$s=New-Object -ComObject 'Schedule.Service'; $s.Connect(); $folder=$s.GetFolder('\')
$name=$env:OPENMELD_TEST_TASK_NAME+'-'+$sid
`;
        const query = async (script: string) =>
          await exec(
            windowsPowerShellPath(),
            powerShellEncodedArguments(prefix + script),
            {
              env: {
                ...process.env,
                OPENMELD_TEST_TASK_NAME: request.name,
                OPENMELD_TEST_OLD_ACTION: historical,
              },
              encoding: "utf8",
              timeout: 30_000,
              windowsHide: true,
            }
          );
        try {
          await query(`
$d=$s.NewTask(0); $d.Principal.UserId=$sid; $d.Principal.LogonType=3; $d.Principal.RunLevel=0; $d.Settings.Enabled=$false
$a=$d.Actions.Create(0); $a.Path=Join-Path $PSHOME 'powershell.exe'; $a.Arguments=$env:OPENMELD_TEST_OLD_ACTION
$null=$folder.RegisterTaskDefinition($name,$d,6,$sid,$null,3,$null)
`);
          const install = {
            ...request,
            operation: "install" as const,
            executable,
            arguments: windowsDirectTaskArguments(action),
            workingDirectory: runtime,
            periodic: true,
          };
          await runWindowsUserTask(install);
          await runWindowsUserTask(install);
          const status = await runWindowsUserTask({
            ...request,
            operation: "status",
          });
          expect(status).toMatchObject({
            installed: true,
            enabled: true,
            running: false,
            legacy: false,
          });
          expect(readWindowsTaskAction(status.actionArguments ?? "")).toEqual(
            action
          );
          const observed = JSON.parse(
            (
              await query(`
$d=$folder.GetTask($name).Definition
@{path=$d.Actions.Item(1).Path; logon=$d.Principal.LogonType; level=$d.Principal.RunLevel; interval=$d.Triggers.Item(2).Repetition.Interval; limit=$d.Settings.ExecutionTimeLimit; multiple=$d.Settings.MultipleInstances} | ConvertTo-Json -Compress
`)
            ).stdout
          );
          expect(observed).toEqual({
            path: executable,
            logon: 3,
            level: 0,
            interval: "PT1H",
            limit: "PT0S",
            multiple: 2,
          });
          await expect(
            runWindowsUserTask({
              ...install,
              arguments: windowsDirectTaskArguments({
                ...action,
                env: { OPENMELD_HOME: join(home, "different-lane") },
              }),
            })
          ).rejects.toThrow("does not belong");
          expect(
            readWindowsTaskAction(
              (await runWindowsUserTask({ ...request, operation: "status" }))
                .actionArguments ?? ""
            )
          ).toEqual(action);
        } finally {
          await runWindowsUserTask({ ...request, operation: "uninstall" });
        }
      });
    }, 90_000);

    it("keeps a running maintenance copy alive while the next invocation selects a new bundle", async () => {
      const fixture = process.env.OPENMELD_TEST_DIRECT_TASK_BINARY;
      if (!fixture) {
        throw new Error("Build and supply the actual GUI task fixture.");
      }
      await withTempHome(async () => {
        const home = process.env.OPENMELD_HOME;
        if (!home) {
          throw new Error("Fixture home missing.");
        }
        const runtime = join(home, "runtime", "daemon");
        const oldExecutable = join(runtime, "bundles", "old", "openmeld.exe");
        const newExecutable = join(runtime, "bundles", "new", "openmeld.exe");
        const release = join(home, "release-old-maintenance");
        const oldLog = join(runtime, "old-maintenance.log");
        const newLog = join(runtime, "new-maintenance.log");
        await mkdir(dirname(oldExecutable), { recursive: true });
        await mkdir(dirname(newExecutable), { recursive: true });
        await copyFile(fixture, oldExecutable);
        await copyFile(fixture, newExecutable);
        const request = {
          name: `OpenMeld-Maintenance-Test-${randomUUID()}`,
          legacyScript: join(runtime, "service-update-worker.bat"),
        };
        const action = (
          executable: string,
          marker: string,
          logPath: string
        ) => ({
          executable,
          args: ["service", "update-worker"],
          env: {
            OPENMELD_HOME: home,
            OPENMELD_TASK_FIXTURE: marker,
            ...(marker === "old"
              ? { OPENMELD_TASK_FIXTURE_RELEASE: release }
              : {}),
          },
          logPath,
        });
        const oldAction = action(oldExecutable, "old", oldLog);
        const newAction = action(newExecutable, "new", newLog);
        const install = (selected: typeof oldAction) => ({
          ...request,
          operation: "install" as const,
          executable: selected.executable,
          arguments: windowsDirectTaskArguments(selected),
          workingDirectory: runtime,
          periodic: true,
        });
        try {
          await runWindowsUserTask(install(oldAction));
          await runWindowsUserTask({ ...request, operation: "start" });
          await vi.waitFor(
            async () => {
              expect(await readFile(oldLog, "utf8")).toContain(
                "direct task waiting for release"
              );
            },
            { timeout: 20_000 }
          );
          const oldReceipt = JSON.parse(
            (await readFile(oldLog, "utf8")).split(LOG_LINES)[0] ?? ""
          );
          const oldPid = Number(oldReceipt.pid);
          expect(oldPid).toBeGreaterThan(0);
          expect(
            (await realpath(String(oldReceipt.executable))).toLowerCase()
          ).toBe((await realpath(oldExecutable)).toLowerCase());
          await runWindowsUserTask(install(newAction));
          const status = await runWindowsUserTask({
            ...request,
            operation: "status",
          });
          expect(status).toMatchObject({ installed: true, running: true });
          expect(readWindowsTaskAction(status.actionArguments ?? "")).toEqual(
            newAction
          );
          const oldProcess = await exec(
            windowsPowerShellPath(),
            powerShellEncodedArguments(
              `[Console]::Out.Write((Get-Process -Id ${oldPid} -ErrorAction Stop).Id)`
            ),
            { encoding: "utf8", timeout: 30_000, windowsHide: true }
          );
          expect(Number(oldProcess.stdout)).toBe(oldPid);
          await writeFile(release, "release");
          await vi.waitFor(
            async () => {
              expect(
                (await runWindowsUserTask({ ...request, operation: "status" }))
                  .running
              ).toBe(false);
            },
            { timeout: 20_000 }
          );
          const remainingOldProcess = await exec(
            windowsPowerShellPath(),
            powerShellEncodedArguments(
              `[Console]::Out.Write([bool](Get-Process -Id ${oldPid} -ErrorAction SilentlyContinue))`
            ),
            { encoding: "utf8", timeout: 30_000, windowsHide: true }
          );
          expect(remainingOldProcess.stdout.trim()).toBe("False");
          await runWindowsUserTask({ ...request, operation: "start" });
          await vi.waitFor(
            async () => {
              const receipt = JSON.parse(
                (await readFile(newLog, "utf8")).split(LOG_LINES)[0] ?? ""
              );
              expect(receipt.value).toBe("new");
              expect(
                (await realpath(String(receipt.executable))).toLowerCase()
              ).toBe((await realpath(newExecutable)).toLowerCase());
            },
            { timeout: 20_000 }
          );
        } catch (error) {
          for (const log of [oldLog, newLog]) {
            const content = await readFile(log, "utf8").catch(() => "");
            console.error(`Maintenance fixture ${log}: ${content}`);
          }
          throw error;
        } finally {
          await writeFile(release, "release");
          await runWindowsUserTask({ ...request, operation: "uninstall" });
        }
      });
    }, 90_000);
  }
);
