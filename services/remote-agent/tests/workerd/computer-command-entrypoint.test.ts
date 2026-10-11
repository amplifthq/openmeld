import { env, runInDurableObject } from "cloudflare:test";
import type {
  WorkspaceRuntimeEvent,
  WorkspaceRuntimeExecHandle,
} from "@cloudflare/computer";
import { expect, it, vi } from "vitest";
import {
  COMPUTER_COMMAND_PREFIX,
  ComputerCommandSqlStorage,
} from "../../flue-adapter/computer-command-storage";
import type { AgentComputer } from "../../flue-adapter/computer-workspace";

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
      } else {
        expect(alarm).toBe(paused ? null : next);
      }
    } finally {
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
