import type { ExecutionContextSelection } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  prepareExecutionContextAssignment,
  recordExecutionContextCompletion,
  resolveExecutionContextTask,
} from "../src/runtime-transport/application/execution-context-authority";
import type { RuntimeCoordinatorHeadLifecycleRecord } from "../src/runtime-transport/application/runtime-coordinator-authority";

// Smoke R5-01: a Session keeps its folder. After Working folder repair changed
// the Agent's default folder, the old Session's next Wake still resumes the
// old folder (the Service then refuses it with
// execution_context.workspace_changed). "Continue in <default folder>" sends
// a `new` selection without a folder id in the same chat, which must start a
// fresh Session that the Service runs in the current default folder.

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
  createdAtMs: number;
  selection: ExecutionContextSelection;
  wakeId: string;
}): RuntimeCoordinatorHeadLifecycleRecord {
  const wakeId = input.wakeId;
  return {
    acceptedDispatchSnapshot: {
      contextRequest: {
        required: input.selection.mode !== "auto",
        scope: {
          organizationId: "org",
          requesterProfileId: "human-owner",
          spaceId: "space",
          targetProfileId: "agent",
          threadId: "thread",
        },
        selection: input.selection,
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
    createdAtMs: input.createdAtMs,
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

async function wake(
  storage: ReturnType<typeof createStorage>,
  input: Parameters<typeof buildRecord>[0]
) {
  const plan = await prepareExecutionContextAssignment({
    contextModeActive: true,
    record: buildRecord(input),
    storage: storage as never,
  });
  await storage.put(plan.writes);
  const assignment = plan.record.acceptedDispatchSnapshot?.executionContext;
  if (!assignment) {
    throw new Error("expected an assignment");
  }
  return {
    assignment,
    task: await resolveExecutionContextTask(storage as never, assignment, {
      resolvesWorkspaceDefault: true,
    }),
  };
}

describe("continue a chat in the repaired default folder (smoke R5-01)", () => {
  it("starts a new Session in the default folder and leaves the old Session where it was", async () => {
    const storage = createStorage();
    // The chat's first request ran in folder-two.
    const first = await wake(storage, {
      createdAtMs: 1,
      selection: { mode: "auto" },
      wakeId: "wake-1",
    });
    await recordExecutionContextCompletion({
      storage: storage as never,
      headId: "wake-1",
      dispatchId: "dispatch-wake-1",
      runtimeCoordinatorExecutionId: "execution-wake-1",
      contextId: first.assignment.id,
      completion: {
        contextId: first.assignment.id,
        nativeConversationId: "native-folder-two",
        runtimeWorkspaceFingerprint: "sha256:folder-two",
      },
    });

    // folder-two is removed and repair makes folder-one the default. The next
    // plain message in the same chat resumes the old Session unchanged: Core
    // never moves it, and the Service refuses the changed folder.
    const resumed = await wake(storage, {
      createdAtMs: 2,
      selection: { mode: "auto" },
      wakeId: "wake-2",
    });
    expect(resumed.assignment.id).toBe(first.assignment.id);
    expect(resumed.task).toMatchObject({
      nativeConversationId: "native-folder-two",
      runtimeWorkspaceFingerprint: "sha256:folder-two",
    });

    // One click on "Continue in folder-one" sends a `new` selection without a
    // folder id: a fresh Session with no recorded folder, so the Service runs
    // it in the Agent's current default folder.
    const continued = await wake(storage, {
      createdAtMs: 3,
      selection: { mode: "new" },
      wakeId: "wake-3",
    });
    expect(continued.assignment.id).not.toBe(first.assignment.id);
    expect(continued.assignment).not.toHaveProperty("folderId");
    expect(continued.task).not.toHaveProperty("folderId");
    expect(continued.task.nativeConversationId ?? null).toBeNull();
    expect(continued.task.runtimeWorkspaceFingerprint ?? null).toBeNull();
    await recordExecutionContextCompletion({
      storage: storage as never,
      headId: "wake-3",
      dispatchId: "dispatch-wake-3",
      runtimeCoordinatorExecutionId: "execution-wake-3",
      contextId: continued.assignment.id,
      completion: {
        contextId: continued.assignment.id,
        nativeConversationId: "native-folder-one",
        runtimeWorkspaceFingerprint: "sha256:folder-one",
      },
    });

    // Later plain messages in the chat follow the new Session in folder-one.
    const next = await wake(storage, {
      createdAtMs: 4,
      selection: { mode: "auto" },
      wakeId: "wake-4",
    });
    expect(next.assignment.id).toBe(continued.assignment.id);
    expect(next.task.runtimeWorkspaceFingerprint).toBe("sha256:folder-one");
  });
});
