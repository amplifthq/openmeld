import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acquireDaemonServiceLifecycleLock,
  currentDaemonServiceLifecycleLock,
  releaseDaemonServiceLifecycleLock,
  withDaemonServiceRunLock,
} from "../src/config/daemon-state";
import { releaseLock } from "../src/config/lock";
import { runNativeServiceCommand } from "../src/local-service/lifecycle/native-command";
import { readProcessStartIdentity } from "../src/system/process-identity";
import { withTempHome } from "./helpers/fs";

const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const loader = join(
  vitestRequire.resolve("tsx/package.json"),
  "..",
  "dist",
  "loader.mjs"
);

describe("native Service command lifecycle ownership", () => {
  it.each([
    2, 3,
  ])("does not execute after owner death during pre-grant identity read %s", async (pauseAt) => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      process.env.OPENMELD_HOME = home;
      const bin = join(home, "bin");
      const paused = join(home, "paused");
      const marker = join(home, "executed");
      await mkdir(bin);
      // Pause the real owner before attachment (2) or after publication (3).
      // The shim delegates actual identity evidence to the platform ps.
      await writeFile(
        join(bin, "ps"),
        `#!/bin/sh
n=0
if [ -f "$TEST_COUNT" ]; then read -r n < "$TEST_COUNT"; fi
n=$((n + 1))
printf '%s\\n' "$n" > "$TEST_COUNT"
if [ "$n" = "$TEST_PAUSE_AT" ]; then
  printf '%s\\n' "$4" > "$TEST_PAUSED"
  kill -STOP "$PPID"
fi
exec /bin/ps "$@"
`,
        { mode: 0o700 }
      );
      const owner = spawn(
        process.execPath,
        [
          "--import",
          loader,
          "--input-type=module",
          "--eval",
          `
        import { withDaemonServiceRunLock } from ${JSON.stringify(new URL("../src/config/daemon-state.ts", import.meta.url).href)};
        import { runNativeServiceCommand } from ${JSON.stringify(new URL("../src/local-service/lifecycle/native-command.ts", import.meta.url).href)};
        await withDaemonServiceRunLock(() => runNativeServiceCommand({ command: process.execPath, args: ['-e', "require('node:fs').writeFileSync(process.argv[1], 'executed')", ${JSON.stringify(marker)}], throwOnError: true }));
      `,
        ],
        {
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            TEST_COUNT: join(home, "count"),
            TEST_PAUSED: paused,
            TEST_PAUSE_AT: String(pauseAt),
          },
          stdio: "ignore",
        }
      );
      try {
        await expect
          .poll(() => readFile(paused, "utf8").catch(() => ""), {
            timeout: 5000,
          })
          .not.toBe("");
        const lockPath = join(
          home,
          "runtime",
          "locks",
          "daemon-service",
          "daemon-service-run.lock"
        );
        const entries = await readdir(lockPath);
        expect(entries).toHaveLength(pauseAt === 2 ? 1 : 2);
        let nativePid = Number(await readFile(paused, "utf8"));
        if (pauseAt === 3) {
          const owners = await Promise.all(
            entries.map(
              async (entry) =>
                JSON.parse(await readFile(join(lockPath, entry), "utf8")) as {
                  pid: number;
                }
            )
          );
          nativePid = owners.find((entry) => entry.pid !== owner.pid)?.pid ?? 0;
        }
        expect(nativePid).toBeGreaterThan(0);
        const exited = once(owner, "exit");
        owner.kill("SIGKILL");
        await exited;
        await expect.poll(() => readProcessStartIdentity(nativePid)).toBeNull();
        await expect(readFile(marker)).rejects.toMatchObject({
          code: "ENOENT",
        });
        const recovered = await acquireDaemonServiceLifecycleLock();
        await releaseDaemonServiceLifecycleLock(recovered);
      } finally {
        owner.kill("SIGKILL");
      }
    });
  });
  it("refuses execution when the waiting process cannot attach to its owner", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      process.env.OPENMELD_HOME = home;
      const marker = join(home, "must-not-exist");
      await withDaemonServiceRunLock(async () => {
        const lock = currentDaemonServiceLifecycleLock();
        if (!lock) {
          throw new Error("missing lifecycle owner");
        }
        await releaseLock(lock);
        await expect(
          runNativeServiceCommand({
            command: process.execPath,
            args: [
              "-e",
              "require('node:fs').writeFileSync(process.argv[1], 'executed')",
              marker,
            ],
            throwOnError: true,
          })
        ).rejects.toThrow();
      });
      await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
  it("keeps a surviving native process fenced after its CLI owner dies, then recovers", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      process.env.OPENMELD_HOME = home;
      const ready = join(home, "ready");
      const grant = join(home, "complete");
      const result = join(home, "result");
      const nativeScript = `
        const fs = require('node:fs');
        const watcher = fs.watch(${JSON.stringify(home)}, () => {
          if (fs.existsSync(${JSON.stringify(grant)})) {
            fs.writeFileSync(${JSON.stringify(result)}, 'A');
            watcher.close();
          }
        });
        fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid));
      `;
      const owner = spawn(
        process.execPath,
        [
          "--import",
          loader,
          "--input-type=module",
          "--eval",
          `
        import { withDaemonServiceRunLock } from ${JSON.stringify(new URL("../src/config/daemon-state.ts", import.meta.url).href)};
        import { runNativeServiceCommand } from ${JSON.stringify(new URL("../src/local-service/lifecycle/native-command.ts", import.meta.url).href)};
        await withDaemonServiceRunLock(() => runNativeServiceCommand({ command: process.execPath, args: ['-e', ${JSON.stringify(nativeScript)}], throwOnError: true }));
      `,
        ],
        { env: process.env, stdio: "ignore" }
      );
      let nativePid: number | undefined;
      try {
        await expect
          .poll(async () => {
            nativePid = Number(await readFile(ready, "utf8").catch(() => "0"));
            return nativePid;
          })
          .toBeGreaterThan(0);
        const exited = once(owner, "exit");
        owner.kill("SIGKILL");
        await exited;
        await expect(acquireDaemonServiceLifecycleLock()).rejects.toMatchObject(
          { code: "openmeld.locked" }
        );
        await writeFile(grant, "complete");
        await expect
          .poll(() => readFile(result, "utf8").catch(() => ""))
          .toBe("A");
        await expect
          .poll(async () => {
            try {
              const lock = await acquireDaemonServiceLifecycleLock();
              await releaseDaemonServiceLifecycleLock(lock);
              return true;
            } catch {
              return false;
            }
          })
          .toBe(true);
      } finally {
        owner.kill("SIGKILL");
        if (nativePid) {
          try {
            process.kill(nativePid, "SIGKILL");
          } catch {
            /* Already exited. */
          }
        }
      }
    });
  });

  it("preserves literal argv, command errors, and ordinary lock release", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      process.env.OPENMELD_HOME = home;
      const literal = "`not-a-command` $(not-a-command) a b";
      const result = await withDaemonServiceRunLock(() =>
        runNativeServiceCommand({
          command: process.execPath,
          args: ["-e", "process.stdout.write(process.argv[1])", literal],
          throwOnError: true,
        })
      );
      expect(result).toEqual({ exitCode: 0, stdout: literal, stderr: "" });
      await expect(
        withDaemonServiceRunLock(() =>
          runNativeServiceCommand({
            command: process.execPath,
            args: ["-e", "process.exit(7)"],
            throwOnError: true,
          })
        )
      ).rejects.toThrow("command failed:");
      const lock = await acquireDaemonServiceLifecycleLock();
      await releaseDaemonServiceLifecycleLock(lock);
    });
  });
});
