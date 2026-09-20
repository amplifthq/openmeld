import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { systemDir } from "../src/config/paths";
import { createDaemonLocalExecutionSlots } from "../src/local-service/carrier/local-execution-slots";
import {
  acquireExecutionHostOwnership,
  readExecutionHostBootIdentity,
} from "../src/local-service/execution-host/ownership";

describe("execution Host durable process ownership", () => {
  let root: string;
  const releases: Array<() => Promise<void>> = [];
  const firstBoot = "darwin:811b4099-be87-4efc-8cc6-20a7ef71a2ed";
  const secondBoot = "darwin:c615b170-8643-4d12-b5b6-7ea5ab222d99";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-host-owner-"));
  });
  afterEach(async () => {
    await Promise.all(releases.splice(0).map((release) => release()));
    await rm(root, { recursive: true, force: true });
  });
  const acquire = async (
    bootIdentity: string | null,
    ownerUserId = "test-owner"
  ) => {
    const owner = await acquireExecutionHostOwnership({
      stateRoot: root,
      hostInstanceId: randomUUID(),
      ownerUserId,
      deviceId: "test-device",
      lane: "dev-local",
      bootIdentity,
    });
    releases.push(owner.release);
    return owner;
  };
  const receiptPath = () =>
    join(
      systemDir({ env: { OPENMELD_HOME: root } }),
      "execution-host-owner.json"
    );

  it("allows an empty/quiescent installation without reboot evidence and retains one owner", async () => {
    const first = await acquire(null);
    await expect(acquire(null)).rejects.toThrow();
    await first.release();
    const next = await acquire(null);
    expect(
      JSON.parse(await readFile(receiptPath(), "utf8")).localQuiescent
    ).toBe(true);
    await next.release();
  });

  it.each([
    [firstBoot, firstBoot, false],
    [firstBoot, secondBoot, true],
    [firstBoot, null, false],
    [null, secondBoot, false],
    ["win32:100:638900000000000000", "win32:101:638900000000000001", true],
    ["win32:100:638900000000000000", "win32:100:638900000000000002", false],
    ["win32:100:638900000000000000", "win32:1:638900000000000002", false],
  ] as const)("does not replace unknown local work without trustworthy reboot evidence (%s → %s)", async (before, after, recover) => {
    const first = await acquire(before);
    first.observeLocalQuiescence(false);
    await first.release();
    const retained = await readFile(receiptPath(), "utf8");
    if (recover) {
      const replacement = await acquire(after);
      expect(
        JSON.parse(await readFile(receiptPath(), "utf8")).localQuiescent
      ).toBe(true);
      await replacement.release();
    } else {
      await expect(acquire(after, "another-account")).rejects.toMatchObject({
        code: "host.previous_work_unconfirmed",
      });
      expect(await readFile(receiptPath(), "utf8")).toBe(retained);
    }
  });

  it("allows confirmed quiescence, but never replaces a corrupt ownership record", async () => {
    const first = await acquire(firstBoot);
    first.observeLocalQuiescence(false);
    first.observeLocalQuiescence(true);
    await first.release();
    const next = await acquire(firstBoot);
    await next.release();
    await writeFile(receiptPath(), "{broken");
    await expect(acquire(secondBoot)).rejects.toThrow();
    expect(await readFile(receiptPath(), "utf8")).toBe("{broken");
  });

  it("persists released execution slots before replacing a drained Host", async () => {
    const first = await acquire(firstBoot);
    const slots = createDaemonLocalExecutionSlots({
      limits: { globalConcurrency: 1, queueMax: 10 },
      presenter: {
        view: "agent",
        event: () => undefined,
        line: () => undefined,
        data: () => undefined,
      },
      onChanged: () => {
        first.observeLocalQuiescence(slots.isQuiescent());
      },
    });
    let complete!: () => void;
    const work = new Promise<void>((resolve) => {
      complete = resolve;
    });
    first.observeLocalQuiescence(false);
    expect(
      slots.request({
        adapterId: "codex",
        attemptId: "attempt-completed",
        controllerKey: "builtin:codex",
        dispatchId: "dispatch-completed",
        localExecutionLaneKey: "profile:test",
        profileId: "test",
        spaceId: "test-space",
        targetLabel: "test",
        taskId: "task-completed",
        transportMode: "local-cli",
        run: async () => {
          await work;
          return { result: "success" };
        },
      }).accepted
    ).toBe(true);
    slots.beginDrain();
    expect(
      JSON.parse(await readFile(receiptPath(), "utf8")).localQuiescent
    ).toBe(false);
    complete();
    await slots.drain();
    expect(slots.isQuiescent()).toBe(true);
    expect(
      JSON.parse(await readFile(receiptPath(), "utf8")).localQuiescent
    ).toBe(true);
    await first.release();
    const replacement = await acquire(firstBoot);
    await replacement.release();
  });

  it("reads stable same-boot evidence through the local operating system", async () => {
    const first = await readExecutionHostBootIdentity();
    const second = await readExecutionHostBootIdentity();
    expect(second).toBe(first);
    if (process.platform === "darwin" || process.platform === "linux") {
      expect(first?.startsWith(`${process.platform}:`)).toBe(true);
    }
  });

  it("refuses takeover after an actual owner process dies with unconfirmed work", async () => {
    const require = createRequire(import.meta.url);
    const loader = join(
      createRequire(require.resolve("vitest/package.json")).resolve(
        "tsx/package.json"
      ),
      "..",
      "dist/loader.mjs"
    );
    const child = spawn(
      process.execPath,
      [
        "--import",
        loader,
        join(import.meta.dirname, "fixtures/service-execution-host-owner.ts"),
        root,
      ],
      {
        env: { ...process.env, OPENMELD_HOME: root },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      }
    );
    const exited = once(child, "exit");
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4096);
    });
    try {
      const ready = await Promise.race([
        once(child, "message"),
        exited.then(() => {
          throw new Error(`Owner fixture exited before readiness: ${stderr}`);
        }),
      ]);
      expect(ready[0]).toEqual({ ready: true });
      const retained = await readFile(receiptPath(), "utf8");
      expect(JSON.parse(retained)).toMatchObject({
        pid: child.pid,
        localQuiescent: false,
      });
      child.kill("SIGKILL");
      await exited;
      // The real lock's orphan detection and durable unsafe receipt must not
      // turn a vanished PID into permission to repeat an unknown operation.
      await expect(
        acquire(await readExecutionHostBootIdentity())
      ).rejects.toThrow();
      expect(await readFile(receiptPath(), "utf8")).toBe(retained);
      expect(await readFile(join(root, "execution-started"), "utf8")).toBe(
        "once"
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await exited;
    }
  });
});
