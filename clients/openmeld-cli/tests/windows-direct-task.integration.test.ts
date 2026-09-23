import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { powerShellEncodedArguments } from "@openmeld/adapter-core/windows-system";
import { describe, expect, it } from "vitest";
import { windowsDirectTaskArguments } from "../src/local-service/lifecycle/windows-task-command";
import {
  readWindowsTaskAction,
  runWindowsUserTask,
  windowsPowerShellPath,
  windowsTaskActionArguments,
} from "../src/local-service/lifecycle/windows-user-task";
import { withTempHome } from "./helpers/fs";

const exec = promisify(execFile);
describe.skipIf(process.platform !== "win32")(
  "native direct task registration",
  () => {
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
  }
);
