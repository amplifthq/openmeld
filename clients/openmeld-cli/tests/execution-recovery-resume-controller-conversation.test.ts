import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeAdapter } from "@openmeld/adapter-core";
import { createLocalAdapterContainer } from "@openmeld/local-service";
import type { RuntimeTransportResumeControllerConversationFramePayload } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { resumeExactControllerConversation } from "../src/local-service/execution-recovery/resume-controller-conversation";
import { runResumeControllerConversationOperation } from "../src/local-service/execution-recovery/resume-controller-conversation-operation-store";
import { updateComputerFileAccessPolicy } from "../src/local-service/file-access/computer-file-access-store";

const request: RuntimeTransportResumeControllerConversationFramePayload = {
  destination: {
    spaceId: "space-1",
    surface: "space",
    threadId: "thread-1",
  },
  identity: {
    agentControllerConversationId: "conversation-1",
    agentControllerRef: "builtin:codex",
    attemptId: "attempt-1",
    dispatchId: "dispatch-1",
    resultRef: null,
    runtimeCoordinatorExecutionId: "execution-1",
    spaceId: "space-1",
    targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
    taskId: "task-1",
  },
  operationId: "operation-1",
  providerRuntimeWorkingDirectory: "/tmp/project",
  requestId: "request-1",
  sourceEventId: "signal-1",
  transportMode: "local-cli",
};

describe("exact controller conversation recovery", () => {
  it("replays the durable command result after restart without a second provider call", async () => {
    const ledgerRootPath = mkdtempSync(
      join(tmpdir(), "openmeld-execution-recovery-")
    );
    const execute = vi.fn(async () => ({
      agentControllerConversationId: "conversation-1",
      destination: request.destination,
      identity: request.identity,
      operationId: request.operationId,
      output: "Already completed result",
      status: "completed" as const,
    }));

    const first = await runResumeControllerConversationOperation({
      execute,
      ledgerRootPath,
      request,
    });
    const afterRestartExecute = vi.fn(() =>
      Promise.reject(new Error("provider must not run twice"))
    );
    const replayed = await runResumeControllerConversationOperation({
      execute: afterRestartExecute,
      ledgerRootPath,
      request,
    });

    expect(replayed).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(afterRestartExecute).not.toHaveBeenCalled();
  });

  it("keeps a command outcome unknown after the provider call throws", async () => {
    const ledgerRootPath = mkdtempSync(
      join(tmpdir(), "openmeld-execution-recovery-")
    );
    const execute = vi.fn(() =>
      Promise.reject(new Error("response lost after provider invocation"))
    );

    const first = await runResumeControllerConversationOperation({
      execute,
      ledgerRootPath,
      request,
    });
    const retryExecute = vi.fn(() =>
      Promise.reject(
        new Error("provider must not run while outcome is unknown")
      )
    );
    const retry = await runResumeControllerConversationOperation({
      execute: retryExecute,
      ledgerRootPath,
      request,
    });

    expect(first).toMatchObject({
      reasonCode: "execution_recovery.controller_outcome_unknown",
      status: "outcome_unknown",
    });
    expect(retry).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(retryExecute).not.toHaveBeenCalled();
  });

  it("rejects a conflicting command identity before provider I/O", async () => {
    const ledgerRootPath = mkdtempSync(
      join(tmpdir(), "openmeld-execution-recovery-")
    );
    await runResumeControllerConversationOperation({
      execute: async () => ({
        agentControllerConversationId: "conversation-1",
        destination: request.destination,
        identity: request.identity,
        operationId: request.operationId,
        output: "Already completed result",
        status: "completed",
      }),
      ledgerRootPath,
      request,
    });
    const execute = vi.fn();
    const conflict = await runResumeControllerConversationOperation({
      execute,
      ledgerRootPath,
      request: {
        ...request,
        identity: {
          ...request.identity,
          dispatchId: "different-dispatch",
        },
      },
    });

    expect(conflict).toMatchObject({
      reasonCode: "execution_recovery.operation_identity_conflict",
      status: "rejected",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed without changing a corrupt operation store", async () => {
    const ledgerRootPath = mkdtempSync(
      join(tmpdir(), "openmeld-execution-recovery-")
    );
    const storePath = join(
      ledgerRootPath,
      "execution-recovery-operations.json"
    );
    const original = "{not valid json";
    writeFileSync(storePath, original);
    const execute = vi.fn();

    const result = await runResumeControllerConversationOperation({
      execute,
      ledgerRootPath,
      request,
    });

    expect(result).toMatchObject({
      reasonCode: "execution_recovery.operation_store_invalid",
      status: "rejected",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(readFileSync(storePath, "utf8")).toBe(original);
  });

  it("requires an update for an unknown operation store version", async () => {
    const ledgerRootPath = mkdtempSync(
      join(tmpdir(), "openmeld-execution-recovery-")
    );
    const storePath = join(
      ledgerRootPath,
      "execution-recovery-operations.json"
    );
    const original = JSON.stringify({
      records: [],
      schema: "openmeld-daemon-execution-recovery-operation-store-v2",
      updatedAtMs: 100,
      v: 2,
    });
    writeFileSync(storePath, original);
    const execute = vi.fn();

    const result = await runResumeControllerConversationOperation({
      execute,
      ledgerRootPath,
      request,
    });

    expect(result).toMatchObject({
      reasonCode: "execution_recovery.operation_store_update_required",
      status: "rejected",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(readFileSync(storePath, "utf8")).toBe(original);
  });

  it("fails closed when a matching operation record is incomplete", async () => {
    const ledgerRootPath = mkdtempSync(
      join(tmpdir(), "openmeld-execution-recovery-")
    );
    const storePath = join(
      ledgerRootPath,
      "execution-recovery-operations.json"
    );
    const original = JSON.stringify({
      records: [
        {
          operationId: request.operationId,
          schema: "openmeld-daemon-execution-recovery-operation-record-v1",
        },
      ],
      schema: "openmeld-daemon-execution-recovery-operation-store-v1",
      updatedAtMs: 100,
      v: 1,
    });
    writeFileSync(storePath, original);
    const execute = vi.fn();

    const result = await runResumeControllerConversationOperation({
      execute,
      ledgerRootPath,
      request,
    });

    expect(result).toMatchObject({
      reasonCode: "execution_recovery.operation_store_invalid",
      status: "rejected",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(readFileSync(storePath, "utf8")).toBe(original);
  });

  it("uses the exact conversation and recovery-only execution mode", async () => {
    const dispatch = vi.fn<RuntimeAdapter["dispatch"]>().mockResolvedValue({
      contextDelta: {
        agentControllerConversationId: "conversation-1",
      },
      output: "Already completed result",
      status: "success",
    });
    const result = await resumeExactControllerConversation({
      computerFileAccessStorePath:
        "/tmp/openmeld-test-missing-computer-file-access-policy.json",
      localAdapterContainer: createLocalAdapterContainer([
        {
          adapter: {
            adapterId: "codex",
            dispatch,
            interrupt: vi.fn(),
          },
          adapterId: "codex",
          transportModes: ["local-cli"],
        },
      ]),
      request,
    });

    expect(result).toMatchObject({
      agentControllerConversationId: "conversation-1",
      operationId: "operation-1",
      output: "Already completed result",
      status: "completed",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agentControllerConversationId: "conversation-1",
        dispatchId: "dispatch-1",
        executionMode: "repair",
        runtimeContext: {
          providerRuntimeWorkingDirectory: "/tmp/project",
        },
        streamingMode: "final",
        transportMode: "local-cli",
      })
    );
  });

  it("keeps exact-conversation recovery inside an active Computer boundary", async () => {
    const root = mkdtempSync(join(tmpdir(), "openmeld-recovery-boundary-"));
    const workingDirectory = join(root, "project");
    mkdirSync(workingDirectory);
    const computerFileAccessStorePath = join(root, "file-access.json");
    await updateComputerFileAccessPolicy({
      expectedRevision: 1,
      idempotencyKey: "recovery-boundary",
      nowMs: 100,
      policy: {
        folders: [workingDirectory],
        mode: "only_selected_folders",
      },
      storePath: computerFileAccessStorePath,
    });
    const dispatch = vi.fn<RuntimeAdapter["dispatch"]>().mockResolvedValue({
      contextDelta: {
        agentControllerConversationId: "conversation-1",
      },
      output: "Already completed result",
      status: "success",
    });

    const result = await resumeExactControllerConversation({
      computerFileAccessStorePath,
      localAdapterContainer: createLocalAdapterContainer([
        {
          adapter: {
            adapterId: "codex",
            dispatch,
            interrupt: vi.fn(),
          },
          adapterId: "codex",
          transportModes: ["local-cli"],
        },
      ]),
      request: {
        ...request,
        providerRuntimeWorkingDirectory: workingDirectory,
      },
    });

    expect(result.status).toBe("completed");
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        computerFileAccessBoundary: expect.objectContaining({
          folders: [realpathSync(workingDirectory)],
          mode: "only_selected_folders",
        }),
        prompt: expect.stringContaining(
          "Stay within the file access available to this OpenMeld run."
        ),
      })
    );
  });

  it("fails closed before provider I/O for an unsupported controller", async () => {
    const dispatch = vi.fn<RuntimeAdapter["dispatch"]>();
    const result = await resumeExactControllerConversation({
      computerFileAccessStorePath:
        "/tmp/openmeld-test-missing-computer-file-access-policy.json",
      localAdapterContainer: createLocalAdapterContainer([]),
      request: {
        ...request,
        identity: {
          ...request.identity,
          agentControllerRef: "malformed",
        },
      },
    });

    expect(result.status).toBe("rejected");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("keeps a provider conversation mismatch as outcome unknown", async () => {
    const dispatch = vi.fn<RuntimeAdapter["dispatch"]>().mockResolvedValue({
      contextDelta: {
        agentControllerConversationId: "different-conversation",
      },
      output: "Result",
      status: "success",
    });
    const result = await resumeExactControllerConversation({
      computerFileAccessStorePath:
        "/tmp/openmeld-test-missing-computer-file-access-policy.json",
      localAdapterContainer: createLocalAdapterContainer([
        {
          adapter: {
            adapterId: "codex",
            dispatch,
            interrupt: vi.fn(),
          },
          adapterId: "codex",
          transportModes: ["local-cli"],
        },
      ]),
      request,
    });

    expect(result).toMatchObject({
      reasonCode: "execution_recovery.controller_conversation_mismatch",
      status: "outcome_unknown",
    });
  });
});
