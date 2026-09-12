import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withRegistryLock } from "./dev-isolated-lane.mjs";

const fixture = fileURLToPath(
  new URL("./fixtures/registry-lock-child.mjs", import.meta.url)
);

const TIMEOUT = /Timed out/u;
const UNKNOWN_OWNER = /no owner identity/u;
const CANCELLED = /cancelled/u;

function child(t, mode, lockPath) {
  const process = spawn(
    globalThis.process.execPath,
    [fixture, mode, lockPath],
    {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    }
  );
  const messages = [];
  const listeners = new Map();
  process.on("message", (message) => {
    messages.push(message);
    listeners.get(message)?.();
  });
  const exited = once(process, "exit");
  t.after(async () => {
    if (process.exitCode === null && process.signalCode === null) {
      process.kill("SIGKILL");
    }
    await exited;
  });
  return {
    process,
    exited,
    messages,
    wait: (message) =>
      messages.includes(message)
        ? Promise.resolve()
        : Promise.race([
            new Promise((resolve) => listeners.set(message, resolve)),
            exited.then(([code, signal]) => {
              throw new Error(
                `Child exited before ${message}: code=${code}, signal=${signal}`
              );
            }),
          ]),
  };
}

test(
  "recovers an interrupted recovery and serializes competing processes",
  { timeout: 15_000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "openmeld-lock-recovery-"));
    const lockPath = join(directory, "resources.lock");
    const recovery = child(t, "recovery", lockPath);
    await recovery.wait("recovering");
    recovery.process.kill("SIGKILL");
    await recovery.exited;

    const contenders = Array.from({ length: 4 }, () =>
      child(t, "lock", lockPath)
    );
    await Promise.all(
      contenders.map((contender) => contender.wait("attempting"))
    );
    const remaining = new Set(contenders);
    while (remaining.size > 0) {
      const owner = await Promise.race(
        [...remaining].map(async (contender) => {
          await contender.wait("acquired");
          return contender;
        })
      );
      assert.equal(
        JSON.parse(readFileSync(lockPath, "utf8")).pid,
        owner.process.pid
      );
      // A competing request must not enter while the owner awaits its release.
      await assert.rejects(
        withRegistryLock(
          {
            lockPath,
            lockPid: process.pid,
            isPidAlive: () => true,
            timeoutMs: 30,
          },
          () => assert.fail("overlapping registry writers")
        ),
        TIMEOUT
      );
      assert.equal(
        [...remaining].filter((entry) => entry.messages.includes("acquired"))
          .length,
        1
      );
      owner.process.send("release");
      await owner.exited;
      remaining.delete(owner);
    }
    t.after(() => rmSync(directory, { recursive: true, force: true }));
  }
);

test(
  "preserves an unidentifiable legacy recovery directory and cancels the wait",
  { timeout: 1000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "openmeld-legacy-lock-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const lockPath = join(directory, "resources.lock");
    writeFileSync(lockPath, JSON.stringify({ pid: 42 }));
    mkdirSync(`${lockPath}.reclaim`);
    await assert.rejects(
      withRegistryLock(
        {
          lockPath,
          lockPid: process.pid,
          isPidAlive: () => false,
          timeoutMs: 30,
        },
        () => assert.fail("legacy recovery may still be active")
      ),
      (error) => {
        assert.ok(error.message.includes(`${lockPath}.reclaim`));
        assert.match(error.message, UNKNOWN_OWNER);
        return true;
      }
    );
    const controller = new AbortController();
    const waiting = withRegistryLock(
      {
        lockPath,
        lockPid: process.pid,
        isPidAlive: () => false,
        signal: controller.signal,
      },
      () => assert.fail("legacy recovery may still be active")
    );
    controller.abort(new Error("cancelled"));
    await assert.rejects(waiting, CANCELLED);
    assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).pid, 42);
  }
);
