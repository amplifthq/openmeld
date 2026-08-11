import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  withAgentActivityDeliveryLock,
  withAgentActivityLocalStateLock,
} from "../src/agent-activity/local-state-lock";

let root: string | null = null;
const children = new Set<ChildProcess>();

afterEach(async () => {
  for (const child of children) {
    child.kill("SIGKILL");
  }
  children.clear();
  if (root) {
    await rm(root, { force: true, recursive: true });
    root = null;
  }
});

describe("Agent Activity local state lock", () => {
  it("serializes overlapping async operations in the same process", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-lock-"));
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withAgentActivityLocalStateLock(
      { rootDir: root },
      async () => {
        order.push("first-enter");
        await firstMayFinish;
        order.push("first-exit");
      }
    );
    await until(() => order.includes("first-enter"));
    const second = withAgentActivityLocalStateLock({ rootDir: root }, () => {
      order.push("second-enter");
      return Promise.resolve();
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(order).toEqual(["first-enter"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-enter", "first-exit", "second-enter"]);
  });

  it("keeps delivery and state locks independent", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-lock-"));
    await expect(
      Promise.all([
        withAgentActivityLocalStateLock({ rootDir: root }, async () => "state"),
        withAgentActivityDeliveryLock(
          { rootDir: root },
          async () => "delivery"
        ),
      ])
    ).resolves.toEqual(["state", "delivery"]);
  });

  it("serializes with a live owner in another process", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-lock-"));
    const child = await startLeaseOwner(root, "release", 250);
    const startedAtMs = Date.now();

    await expect(
      withAgentActivityLocalStateLock({ rootDir: root }, async () => "entered")
    ).resolves.toBe("entered");
    expect(Date.now() - startedAtMs).toBeGreaterThanOrEqual(150);
    await waitForExit(child);
  });

  it("reclaims an unexpired lease after its owning process crashes", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-lock-"));
    const child = await startLeaseOwner(root, "crash", 0);
    child.send("crash");
    await waitForExit(child);

    await expect(
      withAgentActivityLocalStateLock({ rootDir: root }, async () => "entered")
    ).resolves.toBe("entered");
  });

  it("reclaims a lease when its pid belongs to another process identity", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-lock-"));
    await withAgentActivityLocalStateLock({ rootDir: root }, () =>
      Promise.resolve()
    );
    await writeLeaseOwner(root, {
      ownerPid: process.pid,
      ownerProcessStartedAt: "ps:definitely-not-this-process",
      token: "stale",
    });

    await expect(
      withAgentActivityLocalStateLock({ rootDir: root }, async () => "entered")
    ).resolves.toBe("entered");
  });

  it("does not steal a lease from the same live process identity", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-lock-"));
    await withAgentActivityLocalStateLock({ rootDir: root }, () =>
      Promise.resolve()
    );
    await writeLeaseOwner(root, {
      ownerPid: process.pid,
      ownerProcessStartedAt: processStartIdentity(process.pid),
      token: "paused-owner",
    });

    await expect(
      withAgentActivityLocalStateLock({ rootDir: root }, async () => "entered")
    ).rejects.toThrow("Timed out waiting for Agent Activity state lock");
  }, 7000);
});

function processStartIdentity(pid: number) {
  return `ps:${execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
  }).trim()}`;
}

async function writeLeaseOwner(
  rootDir: string,
  input: {
    ownerPid: number;
    ownerProcessStartedAt: string;
    token: string;
  }
) {
  const path = join(
    rootDir,
    "device",
    "agent-activity",
    ".locks",
    "state.lock"
  );
  await mkdir(path, { mode: 0o700, recursive: true });
  await writeFile(
    join(path, "owner.json"),
    `${JSON.stringify({
      expiresAtMs: Date.now() + 60_000,
      ownerPid: input.ownerPid,
      ownerProcessStartedAt: input.ownerProcessStartedAt,
      token: input.token,
      version: 1,
    })}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for test condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function startLeaseOwner(
  rootDir: string,
  mode: "crash" | "release",
  holdMs: number
) {
  const child = fork(
    fileURLToPath(
      new URL("./fixtures/agent-activity-lock-owner.mjs", import.meta.url)
    ),
    [rootDir, mode, String(holdMs)],
    { silent: true }
  );
  children.add(child);
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      reject(new Error(`Lock owner exited before ready with code ${code}.`));
    });
    child.once("message", (message) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "ready"
      ) {
        resolve();
      }
    });
  });
  return child;
}

async function waitForExit(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => resolve());
    });
  }
  children.delete(child);
}
