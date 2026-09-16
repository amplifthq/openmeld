import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import {
  forkSession,
  getSessionInfo,
  getSessionMessages,
} from "@anthropic-ai/claude-agent-sdk";
import { forkCodexAppServerThread } from "@openmeld/adapter-codex";
import type {
  AdapterComputerFileAccessBoundary,
  AdapterRuntimeEventCallback,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import { buildRuntimeWorkspaceFingerprint } from "@openmeld/local-execution";
import type {
  ComputerFileAccessPolicy,
  ExecutionContextCompletion,
  ExecutionContextTask,
} from "@openmeld/schemas/types";
import { runAgentSessionForkOperation } from "../session-control/session-fork-operation-store";
import {
  type ExecutionContextWorkspace,
  readExecutionContextWorkspace,
} from "./execution-context-workspace";

export function executionContextLedgerPolicy(context?: ExecutionContextTask) {
  return context ? ("throw" as const) : ("backup_and_reset" as const);
}

export function executionContextResourceScope(context?: ExecutionContextTask) {
  if (!context) {
    return undefined;
  }
  if (context.access === "space_context") {
    return "none" as const;
  }
  if (context.workspace === "isolated") {
    return context.access === "workspace"
      ? ("isolated" as const)
      : ("isolated_read" as const);
  }
  return context.access === "workspace"
    ? ("exclusive" as const)
    : ("read_only" as const);
}

export function executionContextFileAccessBoundary(input: {
  context: ExecutionContextTask;
  workingDirectory: string;
  policy: ComputerFileAccessPolicy;
  taskWorkspace?: ExecutionContextWorkspace;
}): AdapterComputerFileAccessBoundary {
  const within = (child: string, parent: string) => {
    const path = relative(parent, child);
    return (
      path === "" ||
      (path !== ".." && !path.startsWith("../") && !isAbsolute(path))
    );
  };
  const policy = input.policy;
  // Space-only work has no user-folder source. The native boundary still names
  // only its Service-owned scratch root, regardless of the user's folder policy.
  if (input.context.access !== "space_context") {
    const policySource =
      input.taskWorkspace?.sourceWorkingDirectory ?? input.workingDirectory;
    if (
      policy.mode === "only_selected_folders" &&
      !policy.folders.some((folder) => within(policySource, folder))
    ) {
      throw new Error("execution_context.workspace_outside_computer_policy");
    }
    if (
      policy.mode === "block_selected_folders" &&
      policy.folders.some(
        (folder) => within(policySource, folder) || within(folder, policySource)
      )
    ) {
      throw new Error("execution_context.workspace_overlaps_blocked_folder");
    }
  }
  return {
    mode: "only_selected_folders",
    folders: [input.taskWorkspace?.boundaryRoot ?? input.workingDirectory],
    revision: policy.revision,
    updatedAtMs: policy.updatedAtMs,
    executionContextAccess: input.context.access,
  };
}

export async function executionContextWorkingDirectory(input: {
  context?: Pick<ExecutionContextTask, "id" | "workspace">;
  ledgerRootPath: string;
  currentWorkingDirectory: string;
}): Promise<string> {
  if (!input.context) {
    return input.currentWorkingDirectory;
  }
  if (input.context.workspace === "current") {
    return await realpath(input.currentWorkingDirectory);
  }
  await mkdir(input.ledgerRootPath, { recursive: true, mode: 0o700 });
  const root = join(
    await realpath(input.ledgerRootPath),
    "execution-context-workspaces"
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink()) {
    throw new Error("execution_context.workspace_is_symlink");
  }
  const path = join(root, input.context.id);
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((await lstat(path)).isSymbolicLink()) {
    throw new Error("execution_context.workspace_is_symlink");
  }
  return await realpath(path);
}

export async function prepareExecutionContextConversation(input: {
  computerFileAccessBoundary?: AdapterComputerFileAccessBoundary | null;
  context?: ExecutionContextTask;
  unscopedNativeConversationId: string | null;
  currentWorkingDirectory: string;
  workingDirectory: string;
  existingNativeConversationId: string | null;
  ledgerRootPath: string;
  agentControllerRef: string;
  launchContract?: RuntimeAgentControllerLaunchContract | null;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  processSupervisionId?: string;
}): Promise<string | null> {
  if (!input.context) {
    return input.unscopedNativeConversationId;
  }
  const nativeId = input.context.nativeConversationId;
  if (
    input.context.runtimeWorkspaceFingerprint &&
    input.context.runtimeWorkspaceFingerprint !==
      buildRuntimeWorkspaceFingerprint(input.workingDirectory)
  ) {
    throw new Error("execution_context.workspace_changed");
  }
  if (
    nativeId &&
    input.existingNativeConversationId &&
    nativeId !== input.existingNativeConversationId
  ) {
    throw new Error("execution_context.native_identity_mismatch");
  }
  if (nativeId || input.existingNativeConversationId) {
    return nativeId ?? input.existingNativeConversationId;
  }
  const source = input.context.forkSource;
  if (!source) {
    return null;
  }
  const sourceWorkspace =
    source.workspace === "isolated"
      ? await readExecutionContextWorkspace({
          ledgerRootPath: input.ledgerRootPath,
          contextId: source.contextId,
        })
      : null;
  const sourceDirectory =
    sourceWorkspace?.workingDirectory ??
    (await realpath(
      source.workspace === "current"
        ? input.currentWorkingDirectory
        : (sourceWorkspace?.workingDirectory ??
            join(
              input.ledgerRootPath,
              "execution-context-workspaces",
              source.contextId
            ))
    ));
  if (
    buildRuntimeWorkspaceFingerprint(sourceDirectory) !==
    source.runtimeWorkspaceFingerprint
  ) {
    throw new Error("execution_context.fork_source_workspace_changed");
  }
  const result = await runAgentSessionForkOperation({
    ledgerRootPath: input.ledgerRootPath,
    request: {
      kind: "execution_context",
      operationId: input.context.id,
      sourceNativeSessionId: source.nativeConversationId,
      completedHistoryId: source.completedHistoryId,
      workingDirectory: input.workingDirectory,
    },
    execute: async () => {
      if (input.agentControllerRef === "builtin:claude-code") {
        const messages = await readBoundedClaudeHistory(
          source.nativeConversationId
        );
        const boundary = messages.find(
          (message) =>
            message.uuid === source.completedHistoryId &&
            isCompletedAssistantMessage(message)
        );
        if (!boundary) {
          throw new Error("execution_context.fork_checkpoint_unavailable");
        }
        const child = await forkSession(source.nativeConversationId, {
          upToMessageId: source.completedHistoryId,
        });
        return { childNativeSessionId: child.sessionId };
      }
      if (
        input.agentControllerRef === "builtin:codex" &&
        input.launchContract
      ) {
        const child = await forkCodexAppServerThread({
          computerFileAccessBoundary:
            input.computerFileAccessBoundary ?? undefined,
          codexTimeoutMs: 30_000,
          codexWorkdir: sourceDirectory,
          launchContract: input.launchContract,
          sourceThreadId: source.nativeConversationId,
          sourceCompletedTurnId: source.completedHistoryId,
          targetWorkingDirectory: input.workingDirectory,
          onRuntimeEvent: input.onRuntimeEvent,
          env: { OPENMELD_PROCESS_SUPERVISION_ID: input.processSupervisionId },
        });
        return { childNativeSessionId: child.threadId };
      }
      throw new Error("execution_context.fork_unsupported");
    },
  });
  if (result.status !== "completed") {
    throw new Error(`${result.reasonCode}: ${result.message}`);
  }
  return result.childNativeSessionId;
}

export async function captureExecutionContextCompletion(input: {
  context?: ExecutionContextTask;
  nativeConversationId: string | null;
  agentControllerRef: string;
  workingDirectory: string;
  completedTurnId: string | null;
  providerSucceeded: boolean;
}): Promise<ExecutionContextCompletion | undefined> {
  if (!(input.context && input.nativeConversationId)) {
    return undefined;
  }
  const completion: ExecutionContextCompletion = {
    contextId: input.context.id,
    nativeConversationId: input.nativeConversationId,
    runtimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
      input.workingDirectory
    ),
  };
  if (!input.providerSucceeded) {
    return completion;
  }
  if (input.agentControllerRef === "builtin:codex") {
    return {
      ...completion,
      ...(input.completedTurnId
        ? { completedHistoryId: input.completedTurnId }
        : {}),
    };
  }
  if (input.agentControllerRef === "builtin:claude-code") {
    try {
      const messages = await readBoundedClaudeHistory(
        input.nativeConversationId
      );
      const completed = messages.findLast(isCompletedAssistantMessage);
      if (completed) {
        return { ...completion, completedHistoryId: completed.uuid };
      }
    } catch {
      // Native completion remains known; no unverified fork boundary is emitted.
      console.warn("[execution_context.checkpoint_unavailable]", {
        contextId: input.context.id,
      });
    }
  }
  return completion;
}

async function readBoundedClaudeHistory(sessionId: string) {
  // A fork may execute in a different folder from its native history file.
  // The SDK resolves this exact authorized ID; the Service does not scan sessions.
  const info = await getSessionInfo(sessionId);
  if (!info || info.fileSize === undefined || info.fileSize > 8 * 1024 * 1024) {
    throw new Error("execution_context.history_unavailable_or_too_large");
  }
  return await getSessionMessages(sessionId);
}

function isCompletedAssistantMessage(
  value: Awaited<ReturnType<typeof getSessionMessages>>[number]
): boolean {
  return (
    value.type === "assistant" &&
    typeof value.message === "object" &&
    value.message !== null &&
    "stop_reason" in value.message &&
    value.message.stop_reason === "end_turn"
  );
}
