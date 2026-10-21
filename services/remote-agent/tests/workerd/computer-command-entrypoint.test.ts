import { runInDurableObject } from "cloudflare:test";
import {
  getWorkspace,
  type WorkspaceRuntimeEvent,
  type WorkspaceRuntimeExecHandle,
} from "@cloudflare/computer";
import { expect, it, vi } from "vitest";
import {
  COMPUTER_COMMAND_PREFIX,
  ComputerCommandSqlStorage,
} from "../../flue-adapter/computer-command-storage";
import type { AgentComputer } from "../../flue-adapter/computer-workspace";
import { env } from "./worker-env";

// The native boundary uses the installed SDK's event and result contracts.
// The public AgentComputer method, Workspace RPC, filesystem and SQLite remain real.
function exitedNativeHandle(id: string) {
  return Object.assign(
    new ReadableStream<WorkspaceRuntimeEvent>({
      start(controller) {
        controller.enqueue({ id, seq: 1, name: "exit", code: 0 });
        controller.close();
      },
    }),
    {
      id,
      backend: "worker-javascript",
      result: async () => ({
        status: "completed",
        exitCode: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
        pushed: 0,
        pulled: 0,
        skipped: [],
        sync: { status: "complete", applied: 0, skipped: [] },
      }),
      kill: async () => undefined,
      [Symbol.dispose]: () => undefined,
    }
  ) as WorkspaceRuntimeExecHandle;
}

function computerStub() {
  const namespace = (
    env as { AGENT_COMPUTER: DurableObjectNamespace<AgentComputer> }
  ).AGENT_COMPUTER;
  return namespace.get(namespace.newUniqueId());
}

it("keeps a remote Workspace client active until its RPC stub is disposed", async () => {
  const stub = computerStub();
  const workspace = await getWorkspace(
    stub as unknown as Parameters<typeof getWorkspace>[0]
  );
  try {
    await runInDurableObject(stub, async (computer, state) => {
      const close = vi.spyOn(computer.workspace, "close");
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 180_000);
      try {
        await computer.alarm();
        expect(close).not.toHaveBeenCalled();
      } finally {
        close.mockRestore();
        clock.mockRestore();
        await state.storage.deleteAlarm();
      }
    });
  } finally {
    workspace[Symbol.dispose]();
  }
  await runInDurableObject(stub, async (computer, state) => {
    const close = vi.spyOn(computer.workspace, "close");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 180_000);
    try {
      await computer.alarm();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      close.mockRestore();
      clock.mockRestore();
      await state.storage.deleteAlarm();
    }
  });
});

it.each([
  { paused: false, git: false },
  { paused: true, git: false },
  { paused: true, git: true },
])("schedules the real Computer alarm from command receipts (paused=$paused, Git=$git)", async ({
  paused,
  git,
}) => {
  await runInDurableObject(computerStub(), async (computer, state) => {
    const now = Date.now();
    const next = now + 120_000;
    const storage = new ComputerCommandSqlStorage(state.storage.sql);
    await storage.put(`${COMPUTER_COMMAND_PREFIX}alarm:work`, {
      id: "original",
      key: "work",
      fingerprint: "original",
      createdAt: now,
      collectable: false,
      backend: "container",
      collection: {
        unconfirmedAttempts: paused ? 8 : 2,
        nextAttemptAtMs: paused ? null : next,
      },
    });
    if (git) {
      await state.storage.put("openmeld:git-pack-job:fresh", {
        status: "running",
        startedAtMs: now,
      });
    }
    try {
      await computer.alarm();
      const alarm = await state.storage.getAlarm();
      if (git) {
        expect(alarm).toBeGreaterThanOrEqual(now + 15_000);
        expect(alarm).toBeLessThan(now + 16_000);
      } else if (paused) {
        expect(alarm).toBeGreaterThanOrEqual(next);
      } else {
        expect(alarm).toBe(next);
      }
    } finally {
      await state.storage.deleteAlarm();
    }
  });
});

it.each([
  false,
  true,
])("closes an idle Workspace and retains files after terminal sync refusal: %s", async (syncRefused) => {
  await runInDurableObject(computerStub(), async (computer, state) => {
    await computer.writeComputerFile("/computer/keep.txt", "saved");
    if (syncRefused) {
      const storage = new ComputerCommandSqlStorage(state.storage.sql);
      await storage.put(`${COMPUTER_COMMAND_PREFIX}idle:refused`, {
        id: "refused",
        key: "refused",
        fingerprint: "refused",
        createdAt: Date.now(),
        collectable: true,
        backend: "container",
        observation: {
          status: "running",
          exitCode: 0,
          syncError: "ESYNC_READ_ONLY",
        },
      });
    }
    const close = vi.spyOn(computer.workspace, "close");
    const now = Date.now();
    const clock = vi.spyOn(Date, "now");
    try {
      await computer.alarm();
      expect(close).not.toHaveBeenCalled();
      clock.mockReturnValue(now + 121_000);
      await computer.alarm();
      expect(close).toHaveBeenCalledOnce();
      expect(await state.storage.getAlarm()).toBeNull();
      await computer.workspace.ready();
      expect(
        await computer.workspace.fs.readFile("/computer/keep.txt", "utf8")
      ).toBe("saved");
    } finally {
      clock.mockRestore();
      close.mockRestore();
      await state.storage.deleteAlarm();
    }
  });
});

it("keeps the Workspace open during a slow file write and pending synchronization", async () => {
  await runInDurableObject(computerStub(), async (computer, state) => {
    await computer.workspace.ready();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const originalWrite = computer.workspace.fs.writeFile.bind(
      computer.workspace.fs
    );
    const write = vi
      .spyOn(computer.workspace.fs, "writeFile")
      .mockImplementation(async (...args) => {
        entered.resolve();
        await release.promise;
        return await originalWrite(...args);
      });
    const close = vi.spyOn(computer.workspace, "close");
    const startedAt = Date.now();
    const clock = vi.spyOn(Date, "now");
    let maintenance: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const pending = computer.writeComputerFile(
        "/computer/slow.txt",
        "retained"
      );
      await entered.promise;
      clock.mockReturnValue(startedAt + 3_600_000);
      await computer.alarm();
      expect(close).not.toHaveBeenCalled();
      release.resolve();
      await pending;
      clock.mockReturnValue(startedAt + 3_721_000);
      maintenance = vi
        .spyOn(computer.workspace, "maintainSync")
        .mockResolvedValue(true);
      await computer.alarm();
      expect(close).not.toHaveBeenCalled();
      maintenance.mockRestore();
      await computer.alarm();
      expect(close).toHaveBeenCalledOnce();
      expect(
        await computer.workspace.fs.readFile("/computer/slow.txt", "utf8")
      ).toBe("retained");
    } finally {
      release.resolve();
      write.mockRestore();
      close.mockRestore();
      clock.mockRestore();
      maintenance?.mockRestore();
      await state.storage.deleteAlarm();
    }
  });
});

it.each([
  { backend: "container", syncError: undefined },
  { backend: "worker-shell", syncError: undefined },
  { backend: "worker-javascript", syncError: undefined },
  { backend: "container", syncError: "ENOENT" },
])("does not close an unfinished $backend command with paused collection (syncError=$syncError)", async ({
  backend,
  syncError,
}) => {
  await runInDurableObject(computerStub(), async (computer, state) => {
    const storage = new ComputerCommandSqlStorage(state.storage.sql);
    await storage.put(`${COMPUTER_COMMAND_PREFIX}idle:work`, {
      id: "work",
      key: "work",
      fingerprint: "work",
      createdAt: Date.now(),
      collectable: false,
      backend,
      ...(syncError
        ? {
            observation: {
              status: "running",
              exitCode: 0,
              syncPending: true,
              syncError,
            },
          }
        : {}),
      collection: { unconfirmedAttempts: 8, nextAttemptAtMs: null },
    });
    const close = vi.spyOn(computer.workspace, "close");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3_600_000);
    try {
      await computer.alarm();
      expect(close).not.toHaveBeenCalled();
      expect(await state.storage.getAlarm()).not.toBeNull();
    } finally {
      clock.mockRestore();
      close.mockRestore();
      await state.storage.deleteAlarm();
    }
  });
});

it("serves retained public controls when native readiness and mkdir fail", async () => {
  await runInDurableObject(computerStub(), async (computer) => {
    await computer.workspace.ready();
    const ready = vi
      .spyOn(computer.workspace, "ready")
      .mockResolvedValue(undefined);
    const exec = vi
      .spyOn(computer.workspace.runtime, "exec")
      .mockImplementation(
        async (_source, options) =>
          exitedNativeHandle(options?.id ?? "missing-id") as never
      );
    const mkdir = vi.spyOn(computer.workspace.fs, "mkdir");
    const start = {
      action: "command",
      invocationId: "retained",
      command: {
        action: "start",
        key: "work",
        backend: "worker-javascript",
        command: "export default () => 0",
      },
    };
    try {
      await expect(computer.computerOperation(start)).resolves.toMatchObject({
        status: "completed",
        exitCode: 0,
      });
      ready.mockRejectedValue(new Error("injected native readiness failure"));
      mkdir.mockRejectedValue(new Error("injected directory failure"));
      await expect(
        computer.computerOperation({
          action: "command",
          invocationId: "retained",
          command: { action: "list" },
        })
      ).resolves.toMatchObject([{ key: "work" }]);
      for (const action of ["poll", "stop"]) {
        await expect(
          computer.computerOperation({
            action: "command",
            invocationId: "retained",
            command: { action, key: "work" },
          })
        ).resolves.toMatchObject({ status: "completed", exitCode: 0 });
      }
      await expect(computer.computerOperation(start)).resolves.toMatchObject({
        status: "completed",
        exitCode: 0,
      });
      expect(exec).toHaveBeenCalledOnce();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

it.each([
  { fault: "ready", stop: false },
  { fault: "mkdir", stop: false },
  { fault: "mkdir", stop: true },
] as const)("bounds public launch preparation and prevents delayed spawn (fault=$fault, Stop=$stop)", async ({
  fault,
  stop,
}) => {
  await runInDurableObject(computerStub(), async (computer) => {
    await computer.workspace.ready();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const ready = vi
      .spyOn(computer.workspace, "ready")
      .mockResolvedValue(undefined);
    const mkdir = vi.spyOn(computer.workspace.fs, "mkdir");
    const exec = vi
      .spyOn(computer.workspace.runtime, "exec")
      .mockImplementation(
        async (_source, options) =>
          exitedNativeHandle(options?.id ?? "missing-id") as never
      );
    vi.spyOn(computer.workspace.runtime, "killExec").mockResolvedValue(
      undefined
    );
    const waitForPreparation = async () => {
      entered.resolve();
      await release.promise;
    };
    if (fault === "ready") {
      ready.mockImplementation(waitForPreparation);
    } else {
      mkdir.mockImplementation(waitForPreparation);
    }
    vi.useFakeTimers();
    const launch = computer
      .computerOperation({
        action: "command",
        invocationId: "prepare",
        command: {
          action: "start",
          key: "work",
          backend: "worker-javascript",
          command: "export default () => 0",
        },
      })
      .catch((error: unknown) => error);
    try {
      await entered.promise;
      if (stop) {
        const stopping = computer
          .computerOperation({
            action: "command",
            invocationId: "prepare",
            command: { action: "stop", key: "work", signal: "SIGKILL" },
          })
          .catch((error: unknown) => error);
        const stopDeadline = new Promise((resolve) =>
          setTimeout(
            () => resolve({ status: "test.stop_blocked_by_mkdir" }),
            5001
          )
        );
        await vi.advanceTimersByTimeAsync(5001);
        expect(await Promise.race([stopping, stopDeadline])).toMatchObject({
          status: "completed",
          exitCode: null,
        });
        release.resolve();
        await vi.advanceTimersByTimeAsync(1100);
        expect(await launch).toMatchObject({
          status: "completed",
          exitCode: null,
        });
      } else {
        const deadline = new Promise((resolve) =>
          setTimeout(
            () => resolve({ code: "test.no_command_owner_budget" }),
            60_001
          )
        );
        await vi.advanceTimersByTimeAsync(60_001);
        expect(await Promise.race([launch, deadline])).toMatchObject({
          code: "computer.observation_timeout",
        });
        release.resolve();
        await vi.advanceTimersByTimeAsync(1100);
      }
      expect(exec).not.toHaveBeenCalled();
      await expect(
        computer.computerOperation({
          action: "command",
          invocationId: "prepare",
          command: { action: "list" },
        })
      ).resolves.toMatchObject([{ key: "work" }]);
    } finally {
      release.resolve();
      await vi.advanceTimersByTimeAsync(1100);
      await launch;
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});
