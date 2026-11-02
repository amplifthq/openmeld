import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireLock } from "../src/config/lock";
import { systemDir } from "../src/config/paths";
import { createDaemonLocalExecutionSlots } from "../src/local-service/carrier/local-execution-slots";
import {
  acquireExecutionHostOwnership,
  readExecutionHostBootIdentity,
} from "../src/local-service/execution-host/ownership";

describe("execution Host durable process ownership", () => {
  let root: string;
  const releases: Array<() => Promise<void>> = [];
  const processTrees = new Set<number>();
  const firstBoot = "darwin:811b4099-be87-4efc-8cc6-20a7ef71a2ed";
  const secondBoot = "darwin:c615b170-8643-4d12-b5b6-7ea5ab222d99";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-host-owner-"));
  });
  afterEach(async () => {
    for (const pid of processTrees) {
      await killProcessTree(pid);
    }
    await Promise.all(releases.splice(0).map((release) => release()));
    await rm(root, { recursive: true, force: true });
  });
  const killProcessTree = async (pid: number | null) => {
    if (pid === null) {
      return;
    }
    try {
      process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
    } catch {
      // Already gone.
    }
    await waitForProcessTreeExit(pid);
    processTrees.delete(pid);
  };
  // Runs the real owner in its own process, then kills it without a release.
  const killOwnerFixture = async (
    mode?:
      | "with-provider"
      | "concurrent"
      | "concurrent-started"
      | "lingering-group"
      | "second-round"
      | "heal-retry"
      | "between-rounds"
  ) => {
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
        ...(mode ? [mode] : []),
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
      const [ready] = await Promise.race([
        once(child, "message"),
        exited.then(() => {
          throw new Error(`Owner fixture exited before readiness: ${stderr}`);
        }),
      ]);
      const { providerPid, unrecordedPid } = ready as {
        providerPid: number | null;
        unrecordedPid: number | null;
      };
      for (const pid of [providerPid, unrecordedPid]) {
        if (pid !== null) {
          processTrees.add(pid);
        }
      }
      const retained = await readFile(receiptPath(), "utf8");
      const receipt = JSON.parse(retained);
      if (receipt.pid !== child.pid || receipt.localQuiescent !== false) {
        throw new Error(`Owner fixture did not persist busy work: ${retained}`);
      }
      child.kill("SIGKILL");
      await exited;
      return { providerPid, retained };
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await exited;
    }
  };
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
  const readReceipt = async () =>
    JSON.parse(await readFile(receiptPath(), "utf8"));
  type Owner = Awaited<ReturnType<typeof acquire>>;
  const busy = (owner: Owner, runningTaskIds: string[] = ["task-a"]) =>
    owner.observeWork({
      localQuiescent: false,
      unattributedWork: false,
      runningTaskIds,
    });
  const idle = (owner: Owner) =>
    owner.observeWork({
      localQuiescent: true,
      unattributedWork: false,
      runningTaskIds: [],
    });

  it("allows an empty/quiescent installation without reboot evidence and retains one owner", async () => {
    const first = await acquire(null);
    await expect(acquire(null)).rejects.toMatchObject({
      code: "host.previous_work_running",
    });
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
    busy(first);
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

  it.each([
    ["truncated JSON", "{broken"],
    ["a wrong shape", '{"schema":"service-execution-host-owner-v2"}'],
    ["an unreadable path", null],
  ] as const)("allows confirmed quiescence, but never replaces a corrupt ownership record (%s)", async (_kind, corrupt) => {
    const first = await acquire(firstBoot);
    busy(first);
    idle(first);
    await first.release();
    const next = await acquire(firstBoot);
    await next.release();
    if (corrupt === null) {
      await rm(receiptPath());
      await mkdir(receiptPath());
    } else {
      await writeFile(receiptPath(), corrupt);
    }
    // Restart evidence cannot repair the record, so it is not that refusal.
    await expect(acquire(secondBoot)).rejects.toMatchObject({
      code: "host.owner_corrupt",
      ...(corrupt === null
        ? { message: expect.stringContaining("EISDIR") }
        : {}),
    });
    if (corrupt === null) {
      expect((await stat(receiptPath())).isDirectory()).toBe(true);
    } else {
      expect(await readFile(receiptPath(), "utf8")).toBe(corrupt);
    }
  });

  it("trusts a receipt from an older Service only while it was quiescent", async () => {
    const first = await acquire(firstBoot);
    busy(first);
    expect(await readReceipt()).toMatchObject({
      schema: "service-execution-host-owner-v3",
    });
    idle(first);
    // An older Service can still start after a verified rollback.
    expect(await readReceipt()).toMatchObject({
      schema: "service-execution-host-owner-v2",
      localQuiescent: true,
    });
    await first.release();
    // Older writers marked evidence complete Host-wide, so one task's record
    // could hide a concurrent task's unrecorded work.
    await writeFile(
      receiptPath(),
      JSON.stringify({
        ...(await readReceipt()),
        pid: 2_147_483_646,
        localQuiescent: false,
        processEvidenceComplete: true,
        ownedProcessTrees: [],
      })
    );
    await expect(acquire(firstBoot)).rejects.toMatchObject({
      code: "host.previous_work_unconfirmed",
    });
  });

  it("does not wait for an installation lock without an identifiable owner", async () => {
    const lock = await acquireLock({
      openMeldProfileId: "service-execution-host",
      key: "process-owner",
      pathResolution: { env: { ...process.env, OPENMELD_HOME: root } },
    });
    for (const entry of await readdir(lock.path)) {
      await rm(join(lock.path, entry));
    }
    await writeFile(join(lock.path, ".DS_Store"), "");
    // While a lock is published or released it briefly has no owner entry.
    await expect(acquire(firstBoot)).rejects.toMatchObject({
      code: "host.previous_work_running",
    });
    const stale = new Date(Date.now() - 10 * 60_000);
    await utimes(lock.path, stale, stale);
    await expect(acquire(firstBoot)).rejects.toMatchObject({
      code: "host.owner_lock_unverified",
    });
  });

  it("starts once a lock seen mid-handoff is gone", async () => {
    const lock = await acquireLock({
      openMeldProfileId: "service-execution-host",
      key: "process-owner",
      pathResolution: { env: { ...process.env, OPENMELD_HOME: root } },
    });
    for (const entry of await readdir(lock.path)) {
      await rm(join(lock.path, entry));
    }
    await expect(acquire(firstBoot)).rejects.toMatchObject({
      code: "host.previous_work_running",
    });
    await rm(lock.path, { recursive: true });
    await acquire(firstBoot);
  });

  it("records a started task before its work and persists released slots before replacing a drained Host", async () => {
    const first = await acquire(firstBoot);
    const observe = () =>
      first.observeWork({
        localQuiescent: slots.isQuiescent(),
        unattributedWork: false,
        runningTaskIds: slots.getRunningWork().taskIds,
      });
    const slots = createDaemonLocalExecutionSlots({
      limits: { globalConcurrency: 1, queueMax: 10 },
      presenter: {
        view: "agent",
        event: () => undefined,
        line: () => undefined,
        data: () => undefined,
      },
      beforeTaskRun: observe,
      onChanged: observe,
    });
    let complete!: () => void;
    const work = new Promise<void>((resolve) => {
      complete = resolve;
    });
    let receiptAtRunStart: unknown = null;
    busy(first, []);
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
          receiptAtRunStart = await readReceipt();
          await work;
          return { result: "success" };
        },
      }).accepted
    ).toBe(true);
    slots.beginDrain();
    await vi.waitFor(() => expect(receiptAtRunStart).not.toBeNull());
    expect(receiptAtRunStart).toMatchObject({
      localQuiescent: false,
      processEvidenceComplete: false,
    });
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
    const { retained } = await killOwnerFixture();
    // The real lock's orphan detection and durable unsafe receipt must not
    // turn a vanished PID into permission to repeat an unknown operation.
    // Waiting cannot complete missing evidence, so it is not a retry state.
    await expect(
      acquire(await readExecutionHostBootIdentity())
    ).rejects.toMatchObject({ code: "host.previous_work_unconfirmed" });
    expect(await readFile(receiptPath(), "utf8")).toBe(retained);
    expect(await readFile(join(root, "execution-started"), "utf8")).toBe(
      "once"
    );
  });

  it.skipIf(process.platform === "win32")(
    "keeps idle slots from clearing a recorded process group that is still alive",
    async () => {
      const { providerPid } = await killOwnerFixture("lingering-group");
      await expect(
        acquire(await readExecutionHostBootIdentity())
      ).rejects.toMatchObject({ code: "host.previous_work_running" });

      await killProcessTree(providerPid);
      await acquire(await readExecutionHostBootIdentity());
    }
  );

  it("recovers on the same boot only after the old Host and provider process tree are gone", async () => {
    const { providerPid, retained } = await killOwnerFixture("with-provider");
    await expect(
      acquire(await readExecutionHostBootIdentity())
    ).rejects.toMatchObject({ code: "host.previous_work_running" });
    expect(await readFile(receiptPath(), "utf8")).toBe(retained);

    await killProcessTree(providerPid);
    const replacement = await acquire(await readExecutionHostBootIdentity());
    await replacement.release();
  });

  it.each([
    // Another task, started after or before the first task recorded its provider.
    "concurrent",
    "concurrent-started",
    // The same task, in a second invocation or a retry within the first one.
    "second-round",
    "heal-retry",
  ] as const)("never lets a recorded provider vouch for work launched without a record (%s)", async (mode) => {
    const { providerPid, retained } = await killOwnerFixture(mode);
    await expect(
      acquire(await readExecutionHostBootIdentity())
    ).rejects.toMatchObject({ code: "host.previous_work_unconfirmed" });

    // The unrecorded process is still alive.
    await killProcessTree(providerPid);
    await expect(
      acquire(await readExecutionHostBootIdentity())
    ).rejects.toMatchObject({ code: "host.previous_work_unconfirmed" });
    expect(await readFile(receiptPath(), "utf8")).toBe(retained);
  });

  it("recovers a task stopped between provider invocations", async () => {
    await killOwnerFixture("between-rounds");
    await acquire(await readExecutionHostBootIdentity());
  });
});

async function waitForProcessTreeExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(process.platform === "win32" ? pid : -pid, 0);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        String(error.code) === "ESRCH"
      ) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Provider process tree ${pid} did not exit`);
}
