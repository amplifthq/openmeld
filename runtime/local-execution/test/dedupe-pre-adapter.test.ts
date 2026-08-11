import { rm } from "node:fs/promises";
import { createCodexAdapter } from "@openmeld/adapter-codex";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type RuntimeTask,
  runRuntimeTask,
} from "../src/runtime-task-orchestrator";
import {
  createNodeLedgerFileIo,
  createTempLedgerPaths,
} from "./ledger-test-io";

const createdDirs = new Set<string>();
const DEFAULT_RUNTIME_CONTEXT = {
  providerRuntimeWorkingDirectory: "/tmp/provider-runtime",
} as const;

function createRuntimeTask(
  overrides: Omit<RuntimeTask, "runtimeContext">
): RuntimeTask {
  return {
    runtimeContext: DEFAULT_RUNTIME_CONTEXT,
    ...overrides,
  };
}

afterEach(async () => {
  for (const dirPath of createdDirs) {
    await rm(dirPath, { force: true, recursive: true });
  }
  createdDirs.clear();
});

describe("scheduler runtime dedupe before adapter invocation", () => {
  it("suppresses duplicate task before adapter call", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-g2-dedupe-pre-adapter-"
    );
    createdDirs.add(paths.rootDirPath);
    const io = createNodeLedgerFileIo();

    const firstInvoke = vi.fn().mockResolvedValue({ output: "first-output" });
    const secondInvoke = vi.fn().mockResolvedValue({ output: "second-output" });

    await runRuntimeTask({
      adapter: createCodexAdapter({ invoke: firstInvoke }),
      io,
      nowMs: Date.UTC(2026, 1, 25, 15, 0, 0),
      paths,
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        mentioned: true,
        prompt: "first",
        sequence: 1,
        sourceEventId: "evt-runtime-dedupe",
        spaceId: "space-1",
        taskId: "task-runtime-first",
        triggerMode: "mention_only",
      }),
    });

    const secondResult = await runRuntimeTask({
      adapter: createCodexAdapter({ invoke: secondInvoke }),
      io,
      nowMs: Date.UTC(2026, 1, 25, 15, 1, 0),
      paths,
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        mentioned: true,
        prompt: "second",
        sequence: 2,
        sourceEventId: "evt-runtime-dedupe",
        spaceId: "space-1",
        taskId: "task-runtime-second",
        triggerMode: "mention_only",
      }),
    });

    expect(firstInvoke).toHaveBeenCalledTimes(1);
    expect(secondInvoke).not.toHaveBeenCalled();
    expect(secondResult.deduped).toBe(true);
    expect(secondResult.dispatchResult).toEqual({
      dispatched: false,
      reason: "deduped",
    });
  });

  it("allows a recovery redrive to bypass pre-adapter dedupe", async () => {
    const paths = await createTempLedgerPaths(
      "openMeldDaemon-g2-dedupe-recovery-"
    );
    createdDirs.add(paths.rootDirPath);
    const io = createNodeLedgerFileIo();

    const firstInvoke = vi.fn().mockResolvedValue({ output: "first-output" });
    const recoveryInvoke = vi
      .fn()
      .mockResolvedValue({ output: "recovered-output" });

    await runRuntimeTask({
      adapter: createCodexAdapter({ invoke: firstInvoke }),
      io,
      nowMs: Date.UTC(2026, 1, 25, 16, 0, 0),
      paths,
      task: createRuntimeTask({
        agentId: "agent-codex",
        bindingKey: "space-1|agent-codex",
        mentioned: true,
        prompt: "first",
        sequence: 1,
        sourceEventId: "evt-runtime-recovery",
        spaceId: "space-1",
        taskId: "task-runtime-recovery-first",
        triggerMode: "mention_only",
      }),
    });

    const recoveryResult = await runRuntimeTask({
      adapter: createCodexAdapter({ invoke: recoveryInvoke }),
      io,
      nowMs: Date.UTC(2026, 1, 25, 16, 1, 0),
      paths,
      task: createRuntimeTask({
        agentId: "agent-codex",
        attemptId: "attempt-runtime-recovery-redrive",
        bindingKey: "space-1|agent-codex",
        deliveryRecoveryReason: "connection_replaced",
        mentioned: true,
        prompt: "recover",
        sequence: 2,
        sourceEventId: "evt-runtime-recovery",
        spaceId: "space-1",
        taskId: "task-runtime-recovery-second",
        triggerMode: "mention_only",
      }),
    });

    expect(firstInvoke).toHaveBeenCalledTimes(1);
    expect(recoveryInvoke).toHaveBeenCalledTimes(1);
    expect(recoveryResult.deduped).toBe(false);
    expect(recoveryResult.dispatchResult).toMatchObject({
      dispatched: true,
    });
  });
});
