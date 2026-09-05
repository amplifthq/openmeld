import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readWindowsTaskAction,
  runWindowsUserTask,
  windowsPowerShellPath,
  windowsTaskActionArguments,
} from "../src/local-service/lifecycle/windows-user-task";

// Runs against the real Task Scheduler, under a logged-in Windows test user.
// It never uses an OpenMeld service name or the user's OpenMeld home directory.
describe.skipIf(process.platform !== "win32")(
  "Windows user task native contract",
  () => {
    it("runs in the current account, preserves paths/environment, and obeys stop and disable", async () => {
      const root = await mkdtemp(join(tmpdir(), "OpenMeld user task 测试 "));
      const request = {
        name: `OpenMeld-Test-${randomUUID()}`,
        legacyScript: join(root, "never-installed.bat"),
      };
      const output = join(root, "result.json");
      const expected = "a value with spaces, 中文, %PATH%, & and $HOME";
      const action = windowsTaskActionArguments({
        executable: process.execPath,
        args: [
          "-e",
          "require('fs').writeFileSync(process.argv[1], JSON.stringify({pid:process.pid,value:process.env.OPENMELD_TASK_TEST_VALUE,user:require('os').userInfo().username}));setInterval(()=>{},1000)",
          output,
        ],
        env: { OPENMELD_TASK_TEST_VALUE: expected },
        logPath: join(root, "process.log"),
      });
      try {
        expect(
          (await runWindowsUserTask({ ...request, operation: "status" }))
            .installed
        ).toBe(false);
        const installed = await runWindowsUserTask({
          ...request,
          operation: "install",
          executable: windowsPowerShellPath(),
          arguments: action,
          workingDirectory: root,
        });
        expect(installed.installed).toBe(true);
        expect(installed.running).toBe(false);
        expect(
          readWindowsTaskAction(installed.actionArguments ?? "").env
            .OPENMELD_TASK_TEST_VALUE
        ).toBe(expected);
        await runWindowsUserTask({ ...request, operation: "start" });
        let result: string | null = null;
        for (let attempt = 0; attempt < 100 && result === null; attempt++) {
          result = await readFile(output, "utf8").catch(() => null);
          if (result === null) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        expect(result).not.toBeNull();
        expect(JSON.parse(result ?? "null")).toMatchObject({
          value: expected,
          user: (await import("node:os")).userInfo().username,
        });
        await runWindowsUserTask({ ...request, operation: "disable" });
        await runWindowsUserTask({ ...request, operation: "stop" });
        const stopped = await runWindowsUserTask({
          ...request,
          operation: "status",
        });
        expect(stopped.enabled).toBe(false);
        expect(stopped.running).toBe(false);
        const childPid = JSON.parse(result ?? "null").pid;
        await expect
          .poll(() => {
            try {
              process.kill(childPid, 0);
              return true;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ESRCH") {
                return false;
              }
              throw error;
            }
          })
          .toBe(false);
      } finally {
        await runWindowsUserTask({ ...request, operation: "disable" });
        await runWindowsUserTask({ ...request, operation: "stop" });
        await runWindowsUserTask({ ...request, operation: "uninstall" });
        await rm(root, { force: true, recursive: true });
      }
    }, 60_000);
  }
);
