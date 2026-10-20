import type {
  ExecutionContextRequest,
  OpenMeldDaemonDispatchQueueMessage,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { resolveContextWorkspaceDefault } from "../src/dispatch/application/accepted-dispatch-snapshot";
import {
  prepareExecutionContextAssignment,
  recordExecutionContextCompletion,
  resolveExecutionContextTask,
} from "../src/runtime-transport/application/execution-context-authority";
import type { RuntimeCoordinatorHeadLifecycleRecord } from "../src/runtime-transport/application/runtime-coordinator-authority";

// design-plans/member-agent-program.md §4.9: a non-owner root defaults to an
// isolated copy of a git folder; Core marks the default, the Service chooses.

function createStorage() {
  const records = new Map<string, unknown>();
  const storage = {
    get: (key: string) => Promise.resolve(records.get(key)),
    list: (options: { prefix: string; limit?: number }) =>
      Promise.resolve(
        new Map(
          [...records.entries()]
            .filter(([key]) => key.startsWith(options.prefix))
            .slice(0, options.limit)
        )
      ),
    put: (entries: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(entries)) {
        records.set(key, value);
      }
      return Promise.resolve();
    },
    transaction: async <T>(run: (transaction: unknown) => Promise<T>) =>
      await run(storage),
  };
  return storage;
}

function buildRecord(input: {
  request: Partial<ExecutionContextRequest> &
    Pick<ExecutionContextRequest, "selection">;
  wakeId?: string;
}): RuntimeCoordinatorHeadLifecycleRecord {
  const wakeId = input.wakeId ?? "wake-1";
  return {
    acceptedDispatchSnapshot: {
      contextRequest: {
        required: true,
        scope: {
          organizationId: "org",
          requesterProfileId: "human-colleague",
          spaceId: "space",
          targetProfileId: "agent",
          threadId: "thread",
        },
        ...input.request,
      },
      controllerSnapshot: {
        bindingId: "binding",
        configurationRevision: 1,
        targetBindingState: "bound",
        targetBindingEnabled: true,
        agentControllerRef: "builtin:codex",
      },
      openMeldServiceRuntimeId: "runtime",
      payloadFingerprint: `sha256:${"a".repeat(64)}`,
      runtimeKind: "openmeld_service",
    },
    createdAtMs: 1,
    ownerUserId: "owner",
    primaryDispatchId: `dispatch-${wakeId}`,
    runtimeCoordinatorExecutionId: `execution-${wakeId}`,
    targetWakeLifecycleId: wakeId,
    targetWakeLifecycleIdentity: {
      targetWakeLifecycleId: wakeId,
      spaceId: "space",
      targetProfileId: "agent",
    },
  } as unknown as RuntimeCoordinatorHeadLifecycleRecord;
}

async function assign(
  storage: ReturnType<typeof createStorage>,
  record: RuntimeCoordinatorHeadLifecycleRecord
) {
  const plan = await prepareExecutionContextAssignment({
    contextModeActive: true,
    record,
    storage: storage as never,
  });
  await storage.put(plan.writes);
  const assignment = plan.record.acceptedDispatchSnapshot?.executionContext;
  if (!assignment) {
    throw new Error("expected an assignment");
  }
  return assignment;
}

describe("non-owner workspace default", () => {
  it("marks a new direct-edit context of a non-owner root, and only that one", async () => {
    const storage = createStorage();
    const colleague = await assign(
      storage,
      buildRecord({
        request: {
          selection: { mode: "new" },
          workspaceDefault: "isolated_if_git",
        },
      })
    );
    expect(colleague).toMatchObject({
      workspace: "current",
      workspaceDefault: "isolated_if_git",
    });

    const owner = await assign(
      createStorage(),
      buildRecord({
        request: { selection: { mode: "new" } },
      })
    );
    expect(owner.workspace).toBe("current");
    expect(owner).not.toHaveProperty("workspaceDefault");

    const explicit = await assign(
      createStorage(),
      buildRecord({
        request: {
          selection: { mode: "new", workspace: "current" },
          workspaceDefault: "isolated_if_git",
        },
      })
    );
    expect(explicit).not.toHaveProperty("workspaceDefault");
  });

  it("sends the default only to a Service that resolves it", async () => {
    const storage = createStorage();
    const assignment = await assign(
      storage,
      buildRecord({
        request: {
          selection: { mode: "new" },
          workspaceDefault: "isolated_if_git",
        },
      })
    );
    const older = await resolveExecutionContextTask(
      storage as never,
      assignment
    );
    expect(older.workspace).toBe("current");
    expect(older).not.toHaveProperty("workspaceDefault");
    expect(older).not.toHaveProperty("requestChain");
    const current = await resolveExecutionContextTask(
      storage as never,
      assignment,
      {
        resolvesWorkspaceDefault: true,
      }
    );
    expect(current).toMatchObject({
      workspace: "current",
      workspaceDefault: "isolated_if_git",
    });
  });

  it("records the Service's choice so later Wakes resume in that workspace", async () => {
    const storage = createStorage();
    const record = buildRecord({
      request: {
        selection: { mode: "new" },
        workspaceDefault: "isolated_if_git",
      },
    });
    const assignment = await assign(storage, record);
    await recordExecutionContextCompletion({
      storage: storage as never,
      headId: "wake-1",
      dispatchId: "dispatch-wake-1",
      runtimeCoordinatorExecutionId: "execution-wake-1",
      contextId: assignment.id,
      completion: {
        contextId: assignment.id,
        nativeConversationId: "native-1",
        runtimeWorkspaceFingerprint: "sha256:copy",
        workspace: "isolated",
      },
    });
    // A redelivery of the same Wake follows the recorded workspace.
    const redelivered = await resolveExecutionContextTask(
      storage as never,
      assignment,
      {
        resolvesWorkspaceDefault: true,
      }
    );
    expect(redelivered.workspace).toBe("isolated");
    expect(redelivered).not.toHaveProperty("workspaceDefault");
    // The next Wake in the Session uses the stored context.
    const next = await assign(
      storage,
      buildRecord({
        request: {
          required: false,
          selection: { mode: "auto" },
          workspaceDefault: "isolated_if_git",
        },
        wakeId: "wake-2",
      })
    );
    expect(next.id).toBe(assignment.id);
    expect(next.workspace).toBe("isolated");
    expect(next).not.toHaveProperty("workspaceDefault");
  });

  it("records the assigned workspace when an older Service ran without the default", async () => {
    const storage = createStorage();
    const assignment = await assign(
      storage,
      buildRecord({
        request: {
          selection: { mode: "new" },
          workspaceDefault: "isolated_if_git",
        },
      })
    );
    await recordExecutionContextCompletion({
      storage: storage as never,
      headId: "wake-1",
      dispatchId: "dispatch-wake-1",
      runtimeCoordinatorExecutionId: "execution-wake-1",
      contextId: assignment.id,
      completion: {
        contextId: assignment.id,
        nativeConversationId: "native-1",
        runtimeWorkspaceFingerprint: "sha256:folder",
      },
    });
    const task = await resolveExecutionContextTask(
      storage as never,
      assignment,
      {
        resolvesWorkspaceDefault: true,
      }
    );
    expect(task.workspace).toBe("current");
    expect(task).not.toHaveProperty("workspaceDefault");
  });

  it("rejects a Service-chosen workspace for a context without a default", async () => {
    const storage = createStorage();
    const assignment = await assign(
      storage,
      buildRecord({
        request: { selection: { mode: "new" } },
      })
    );
    await expect(
      recordExecutionContextCompletion({
        storage: storage as never,
        headId: "wake-1",
        dispatchId: "dispatch-wake-1",
        runtimeCoordinatorExecutionId: "execution-wake-1",
        contextId: assignment.id,
        completion: {
          contextId: assignment.id,
          nativeConversationId: "native-1",
          runtimeWorkspaceFingerprint: "sha256:copy",
          workspace: "isolated",
        },
      })
    ).rejects.toThrow("execution_context.workspace_changed");
  });
});

describe("resolveContextWorkspaceDefault", () => {
  const message = {
    dispatchId: "dispatch",
  } as unknown as OpenMeldDaemonDispatchQueueMessage;

  it("marks work whose root is not the owner, and counts missing evidence as not the owner", async () => {
    await expect(
      resolveContextWorkspaceDefault({
        isRequestedByOwner: async () => false,
        message,
        runtimeKind: "openmeld_service",
        targetOwnerUserId: "owner",
      })
    ).resolves.toBe("isolated_if_git");
    await expect(
      resolveContextWorkspaceDefault({
        isRequestedByOwner: () => Promise.reject(new Error("db unavailable")),
        message,
        runtimeKind: "openmeld_service",
        targetOwnerUserId: "owner",
      })
    ).resolves.toBe("isolated_if_git");
  });

  it("leaves the owner's work and explicit or resumed workspaces unmarked", async () => {
    const isRequestedByOwner = vi.fn(async () => true);
    await expect(
      resolveContextWorkspaceDefault({
        isRequestedByOwner,
        message,
        targetOwnerUserId: "owner",
      })
    ).resolves.toBeUndefined();
    const notOwner = vi.fn(async () => false);
    await expect(
      resolveContextWorkspaceDefault({
        contextSelection: { mode: "new", workspace: "current" },
        isRequestedByOwner: notOwner,
        message,
        runtimeKind: "openmeld_service",
        targetOwnerUserId: "owner",
      })
    ).resolves.toBeUndefined();
    await expect(
      resolveContextWorkspaceDefault({
        contextSelection: { mode: "resume", sourceWakeId: "wake" },
        isRequestedByOwner: notOwner,
        message,
        runtimeKind: "openmeld_service",
        targetOwnerUserId: "owner",
      })
    ).resolves.toBeUndefined();
    expect(notOwner).not.toHaveBeenCalled();
  });
});
