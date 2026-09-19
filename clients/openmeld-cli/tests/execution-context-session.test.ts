import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRuntimeWorkspaceFingerprint } from "@openmeld/local-execution";
import type {
  ExecutionContextTask,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureExecutionContextCompletion,
  executionContextFileAccessBoundary,
  executionContextWorkingDirectory,
  prepareExecutionContextConversation,
} from "../src/local-service/dispatch/execution-context-session";
import { runAgentSessionForkOperation } from "../src/local-service/session-control/session-fork-operation-store";

const forkCodexAppServerThread = vi.fn(async () => ({
  threadId: "child-thread",
}));
const resolveCodexAppServerCompletedTurn = vi.fn(async () => ({
  completedTurnId: "settled-turn-7",
}));
vi.mock("@openmeld/adapter-codex", () => ({
  forkCodexAppServerThread: (
    ...args: Parameters<typeof forkCodexAppServerThread>
  ) => forkCodexAppServerThread(...args),
  resolveCodexAppServerCompletedTurn: (
    ...args: Parameters<typeof resolveCodexAppServerCompletedTurn>
  ) => resolveCodexAppServerCompletedTurn(...args),
}));

const launchContract: RuntimeAgentControllerLaunchContract = {
  kind: "executable",
  commandPath: "/usr/bin/true",
};

const context: ExecutionContextTask = {
  version: 1,
  id: "11111111-1111-4111-8111-111111111111",
  access: "workspace",
  workspace: "isolated",
  scope: {
    organizationId: "org",
    requesterProfileId: "human",
    spaceId: "space",
    targetProfileId: "agent",
    threadId: null,
  },
  nativeConversationId: null,
  runtimeWorkspaceFingerprint: null,
};
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("Execution Context local authority", () => {
  it("creates distinct canonical task folders and refuses a symlink to another task", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-context-"));
    roots.push(root);
    const first = await executionContextWorkingDirectory({
      context,
      ledgerRootPath: root,
      currentWorkingDirectory: root,
    });
    const child = { ...context, id: "22222222-2222-4222-8222-222222222222" };
    const second = await executionContextWorkingDirectory({
      context: child,
      ledgerRootPath: root,
      currentWorkingDirectory: root,
    });
    expect(first).not.toBe(second);
    await rm(second, { recursive: true });
    await symlink(first, second);
    await expect(
      executionContextWorkingDirectory({
        context: child,
        ledgerRootPath: root,
        currentWorkingDirectory: root,
      })
    ).rejects.toThrow("workspace_is_symlink");
  });

  it.each([
    "workspace",
    "read_only",
  ] as const)("narrows the Computer policy for %s tasks and rejects parent and descendant exclusions", (access) => {
    const localContext = { ...context, access };
    const policy = {
      mode: "only_selected_folders" as const,
      folders: ["/projects"],
      revision: 1,
      updatedAtMs: 1,
    };
    expect(
      executionContextFileAccessBoundary({
        context: localContext,
        workingDirectory: "/projects/task",
        policy,
      })
    ).toMatchObject({
      folders: ["/projects/task"],
      executionContextAccess: access,
    });
    expect(() =>
      executionContextFileAccessBoundary({
        context: localContext,
        workingDirectory: "/other",
        policy,
      })
    ).toThrow("outside_computer_policy");
    for (const folder of ["/projects", "/projects/task/private"]) {
      expect(() =>
        executionContextFileAccessBoundary({
          context: localContext,
          workingDirectory: "/projects/task",
          policy: {
            ...policy,
            mode: "block_selected_folders",
            folders: [folder],
          },
        })
      ).toThrow("overlaps_blocked_folder");
    }
  });

  it.each([
    { mode: "only_selected_folders", folders: ["/projects/selected"] },
    { mode: "block_selected_folders", folders: ["/projects", "/service"] },
  ] as const)("keeps Space-only native access limited to its scratch folder under $mode", (restriction) => {
    const scratch = `/service/execution-context-workspaces/${context.id}`;
    const policy = {
      ...restriction,
      folders: [...restriction.folders],
      revision: 2,
      updatedAtMs: 10,
    };
    expect(
      executionContextFileAccessBoundary({
        context: { ...context, access: "space_context" },
        workingDirectory: scratch,
        taskWorkspace: { workingDirectory: scratch, boundaryRoot: scratch },
        policy,
      })
    ).toEqual({
      mode: "only_selected_folders",
      folders: [scratch],
      revision: 2,
      updatedAtMs: 10,
      executionContextAccess: "space_context",
    });
    const copyId = "11111111-1111-4111-8111-111111111111";
    expect(
      executionContextFileAccessBoundary({
        context: { ...context, access: "space_context" },
        workingDirectory: `${scratch}/handoff-${copyId}`,
        taskWorkspace: { workingDirectory: scratch, boundaryRoot: scratch },
        policy,
        workingCopyId: copyId,
      })
    ).toMatchObject({
      folders: [`${scratch}/handoff-${copyId}`],
      executionContextAccess: "space_context",
      workingCopyId: copyId,
    });
  });

  it("never turns a saved reply after native failure into a completed fork checkpoint", async () => {
    const result = await captureExecutionContextCompletion({
      context,
      nativeConversationId: "native",
      agentControllerRef: "builtin:codex",
      workingDirectory: "/projects/task",
      completedTurnId: "accepted-turn",
      providerSucceeded: false,
    });
    expect(result).toMatchObject({ nativeConversationId: "native" });
    expect(result).not.toHaveProperty("completedHistoryId");
  });

  it("retains a fork outcome across retries and rejects changing its cutoff", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-context-fork-"));
    roots.push(root);
    const request = {
      kind: "execution_context" as const,
      operationId: context.id,
      sourceNativeSessionId: "parent",
      completedHistoryId: "completed-1",
      workingDirectory: root,
    };
    const execute = vi.fn(async () => ({ childNativeSessionId: "child" }));
    const first = await runAgentSessionForkOperation({
      request,
      execute,
      ledgerRootPath: root,
    });
    expect(first).toMatchObject({
      status: "completed",
      childNativeSessionId: "child",
    });
    expect(
      await runAgentSessionForkOperation({
        request,
        execute,
        ledgerRootPath: root,
      })
    ).toEqual(first);
    expect(
      await runAgentSessionForkOperation({
        request: { ...request, completedHistoryId: "completed-2" },
        execute,
        ledgerRootPath: root,
      })
    ).toMatchObject({ status: "rejected" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("confirms an unfrozen fork boundary from the source's own history and journals that exact cutoff", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-context-deferred-"));
    roots.push(root);
    const sourceDirectory = await realpath(root);
    // Core assigns the source identity but no completed prefix: the occupied
    // thread never finished a turn under OpenMeld, so only the harness can say
    // where its settled history ends.
    const child = await prepareExecutionContextConversation({
      context: {
        ...context,
        workspace: "current",
        forkSource: {
          contextId: "33333333-3333-4333-8333-333333333333",
          sourceWakeId: "wake-source",
          nativeConversationId: "parent-thread",
          runtimeWorkspaceFingerprint:
            buildRuntimeWorkspaceFingerprint(sourceDirectory),
          workspace: "current",
        },
      },
      unscopedNativeConversationId: null,
      currentWorkingDirectory: root,
      workingDirectory: sourceDirectory,
      existingNativeConversationId: null,
      ledgerRootPath: root,
      agentControllerRef: "builtin:codex",
      launchContract,
    });
    expect(child).toBe("child-thread");
    expect(resolveCodexAppServerCompletedTurn).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "parent-thread" })
    );
    expect(forkCodexAppServerThread).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceThreadId: "parent-thread",
        sourceCompletedTurnId: "settled-turn-7",
      })
    );
    const execute = vi.fn(async () => ({ childNativeSessionId: "other" }));
    const journalRequest = {
      kind: "execution_context" as const,
      operationId: context.id,
      sourceNativeSessionId: "parent-thread",
      completedHistoryId: "settled-turn-7",
      workingDirectory: sourceDirectory,
    };
    // The journal has to hold the boundary the fork actually used, so a lost
    // response reconciles against that cutoff instead of a re-derived one.
    expect(
      await runAgentSessionForkOperation({
        request: journalRequest,
        execute,
        ledgerRootPath: root,
      })
    ).toMatchObject({
      status: "completed",
      childNativeSessionId: "child-thread",
    });
    expect(
      await runAgentSessionForkOperation({
        request: { ...journalRequest, completedHistoryId: "settled-turn-8" },
        execute,
        ledgerRootPath: root,
      })
    ).toMatchObject({ status: "rejected" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("restores the recorded child across replay when the parent advances, reading parent history fails, or requests run concurrently", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-context-replay-"));
    roots.push(root);
    const sourceDirectory = await realpath(root);
    const replayContext = {
      ...context,
      id: "44444444-4444-4444-8444-444444444444",
      workspace: "current" as const,
      forkSource: {
        contextId: "33333333-3333-4333-8333-333333333333",
        sourceWakeId: "wake-source",
        nativeConversationId: "parent-thread",
        runtimeWorkspaceFingerprint:
          buildRuntimeWorkspaceFingerprint(sourceDirectory),
        workspace: "current" as const,
      },
    };

    // 1. First attempt creates child at settled-turn-7
    const firstChild = await prepareExecutionContextConversation({
      context: replayContext,
      unscopedNativeConversationId: null,
      currentWorkingDirectory: root,
      workingDirectory: sourceDirectory,
      existingNativeConversationId: null,
      ledgerRootPath: root,
      agentControllerRef: "builtin:codex",
      launchContract,
    });
    expect(firstChild).toBe("child-thread");

    // 2. Parent thread advances: reading history would now return settled-turn-8
    vi.mocked(resolveCodexAppServerCompletedTurn).mockResolvedValueOnce({
      completedTurnId: "settled-turn-8",
    });

    // Replay with identical input restores the recorded child without conflict
    const replayChild = await prepareExecutionContextConversation({
      context: replayContext,
      unscopedNativeConversationId: null,
      currentWorkingDirectory: root,
      workingDirectory: sourceDirectory,
      existingNativeConversationId: null,
      ledgerRootPath: root,
      agentControllerRef: "builtin:codex",
      launchContract,
    });
    expect(replayChild).toBe("child-thread");

    // 3. Parent history read fails completely: replay still restores recorded child
    vi.mocked(resolveCodexAppServerCompletedTurn).mockRejectedValueOnce(
      new Error("parent thread unavailable")
    );
    const retryAfterFailure = await prepareExecutionContextConversation({
      context: replayContext,
      unscopedNativeConversationId: null,
      currentWorkingDirectory: root,
      workingDirectory: sourceDirectory,
      existingNativeConversationId: null,
      ledgerRootPath: root,
      agentControllerRef: "builtin:codex",
      launchContract,
    });
    expect(retryAfterFailure).toBe("child-thread");

    // 4. Truly changing source reports conflict
    const conflictContext = {
      ...replayContext,
      forkSource: {
        ...replayContext.forkSource,
        nativeConversationId: "different-parent",
      },
    };
    await expect(
      prepareExecutionContextConversation({
        context: conflictContext,
        unscopedNativeConversationId: null,
        currentWorkingDirectory: root,
        workingDirectory: sourceDirectory,
        existingNativeConversationId: null,
        ledgerRootPath: root,
        agentControllerRef: "builtin:codex",
        launchContract,
      })
    ).rejects.toThrow();
  });

  it("serializes concurrent preparation requests for the same context and restores the same child", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-context-concurrent-"));
    roots.push(root);
    const sourceDirectory = await realpath(root);
    const concurrentContext = {
      ...context,
      id: "55555555-5555-4555-8555-555555555555",
      workspace: "current" as const,
      forkSource: {
        contextId: "33333333-3333-4333-8333-333333333333",
        sourceWakeId: "wake-source",
        nativeConversationId: "parent-thread",
        runtimeWorkspaceFingerprint:
          buildRuntimeWorkspaceFingerprint(sourceDirectory),
        workspace: "current" as const,
      },
    };

    const [childA, childB] = await Promise.all([
      prepareExecutionContextConversation({
        context: concurrentContext,
        unscopedNativeConversationId: null,
        currentWorkingDirectory: root,
        workingDirectory: sourceDirectory,
        existingNativeConversationId: null,
        ledgerRootPath: root,
        agentControllerRef: "builtin:codex",
        launchContract,
      }),
      prepareExecutionContextConversation({
        context: concurrentContext,
        unscopedNativeConversationId: null,
        currentWorkingDirectory: root,
        workingDirectory: sourceDirectory,
        existingNativeConversationId: null,
        ledgerRootPath: root,
        agentControllerRef: "builtin:codex",
        launchContract,
      }),
    ]);

    expect(childA).toBe("child-thread");
    expect(childB).toBe("child-thread");
    expect(childA).toBe(childB);
  });

  it("refuses to fork a controller that cannot confirm its own boundary without a frozen checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-context-unfrozen-"));
    roots.push(root);
    const sourceDirectory = await realpath(root);
    await expect(
      prepareExecutionContextConversation({
        context: {
          ...context,
          workspace: "current",
          forkSource: {
            contextId: "44444444-4444-4444-8444-444444444444",
            sourceWakeId: "wake-source",
            nativeConversationId: "parent-session",
            runtimeWorkspaceFingerprint:
              buildRuntimeWorkspaceFingerprint(sourceDirectory),
            workspace: "current",
          },
        },
        unscopedNativeConversationId: null,
        currentWorkingDirectory: root,
        workingDirectory: sourceDirectory,
        existingNativeConversationId: null,
        ledgerRootPath: root,
        agentControllerRef: "builtin:claude-code",
      })
    ).rejects.toThrow("fork_checkpoint_unavailable");
    expect(forkCodexAppServerThread).not.toHaveBeenCalled();
  });
});
