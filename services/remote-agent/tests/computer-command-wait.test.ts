import type { CloudComputerOperation } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeAgentComputerCommand } from "../flue-adapter/computer-command-wait";
import { createNativeComputerTool } from "../flue-adapter/computer-native";

const reference = {
  invocationId: "original",
  key: "render",
  id: "native-once",
  backend: "container" as const,
};
const operation = {
  action: "command",
  invocationId: "original",
  cwd: "/computer/tasks/original",
  command: {
    action: "poll",
    key: "render",
    reference,
    waitSeconds: 20,
    after: 0,
  },
} satisfies Extract<CloudComputerOperation, { action: "command" }>;
const running = {
  id: reference.id,
  key: reference.key,
  reference,
  status: "running",
  phase: "running",
  collection: { nextAttemptAtMs: 1000, unconfirmedAttempts: 0 },
};
afterEach(() => vi.useRealTimers());

describe.each(["wait owner", "native tool"])("%s", (entrypoint) => {
  const run = (input: Parameters<typeof executeAgentComputerCommand>[0]) => {
    if (entrypoint === "wait owner") {
      return executeAgentComputerCommand(input);
    }
    const tool = createNativeComputerTool({
      invocationId: input.operation.invocationId,
      workingDirectory: input.operation.cwd ?? "/computer/home",
      hasPendingInput: input.hasPendingInput,
      workspaceAccess: {
        computerOperation: input.execute,
        withWorkspace: () => {
          throw new Error("Use the authorized operation owner");
        },
      },
    });
    return tool.execute(
      { action: "command", input: input.operation.command },
      { signal: input.signal }
    );
  };

  it("waits inside one tool call and reads only the original command until files are synchronized", async () => {
    vi.useFakeTimers();
    const complete = {
      ...running,
      status: "completed",
      phase: "completed",
      stdout: "ORIGINAL RESULT",
      exitCode: 0,
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce({
        ...running,
        status: "completed",
        phase: "sync_pending",
        syncPending: true,
      })
      .mockResolvedValue(complete);
    const result = run({ operation, execute });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual(complete);
    expect(execute).toHaveBeenCalledTimes(3);
    for (const [request] of execute.mock.calls) {
      expect(request).toEqual(operation);
    }
  });

  it.each([
    { ...running, status: "stop_requested" },
    {
      ...running,
      phase: "result_unavailable",
      nextAction: "inspect",
      stdout: "Saved partial result",
      stderr: "Saved warning",
      exitCode: null,
      after: 2,
    },
    {
      ...running,
      phase: "sync_pending",
      syncPending: true,
      syncError: "ENOENT",
    },
    {
      ...running,
      collection: { nextAttemptAtMs: null, unconfirmedAttempts: 8 },
    },
    {
      ...running,
      stdout: "Saved partial result",
      observation: {
        status: "timed_out",
        phase: "poll",
        message:
          "The receipt is the last confirmed state, not current progress.",
      },
    },
  ])("returns unresolved or stopped evidence without retrying or relaunching: %j", async (result) => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(result)
      .mockRejectedValue(
        new Error("The unresolved observation must return to the Agent")
      );
    await expect(run({ operation, execute })).resolves.toEqual(result);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("honors Stop during waiting without owning a second cleanup path", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const execute = vi.fn(() => {
      abort.abort(new Error("stopped"));
      return Promise.resolve(running);
    });
    await expect(
      run({ operation, execute, signal: abort.signal })
    ).rejects.toThrow("stopped");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...operation.command, waitSeconds: 0 },
    { action: "start", key: "render", command: "echo complete" },
    { action: "stop", key: "render" },
    { action: "list" },
  ] as const)("keeps non-waiting $action operations single-call", async (command) => {
    const execute = vi.fn().mockResolvedValue(running);
    await expect(
      run({
        operation: {
          ...operation,
          command,
        },
        execute,
      })
    ).resolves.toEqual(running);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("yields the original running receipt for authorized input without stopping or restarting it", async () => {
    const execute = vi.fn().mockResolvedValue(running);
    await expect(
      run({
        operation,
        execute,
        hasPendingInput: () => Promise.resolve(true),
      })
    ).resolves.toEqual(running);
    expect(execute).toHaveBeenCalledExactlyOnceWith(operation);
  });
});
