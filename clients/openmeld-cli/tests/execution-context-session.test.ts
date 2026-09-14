import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionContextTask } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureExecutionContextCompletion,
  executionContextFileAccessBoundary,
  executionContextWorkingDirectory,
} from "../src/local-service/dispatch/execution-context-session";
import { runAgentSessionForkOperation } from "../src/local-service/session-control/session-fork-operation-store";

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

  it("narrows the existing Computer policy and rejects both parent and descendant exclusions", () => {
    const policy = {
      mode: "only_selected_folders" as const,
      folders: ["/projects"],
      revision: 1,
      updatedAtMs: 1,
    };
    expect(
      executionContextFileAccessBoundary({
        context,
        workingDirectory: "/projects/task",
        policy,
      })
    ).toMatchObject({
      folders: ["/projects/task"],
      executionContextAccess: "workspace",
    });
    expect(() =>
      executionContextFileAccessBoundary({
        context,
        workingDirectory: "/other",
        policy,
      })
    ).toThrow("outside_computer_policy");
    for (const folder of ["/projects", "/projects/task/private"]) {
      expect(() =>
        executionContextFileAccessBoundary({
          context,
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
});
