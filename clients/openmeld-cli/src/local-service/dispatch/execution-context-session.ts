import { readFileSync, realpathSync, statSync } from "node:fs";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  forkSession,
  getSessionInfo,
  getSessionMessages,
} from "@anthropic-ai/claude-agent-sdk";
import {
  forkCodexAppServerThread,
  resolveCodexAppServerCompletedTurn,
} from "@openmeld/adapter-codex";
import type {
  AdapterComputerFileAccessBoundary,
  AdapterRuntimeEventCallback,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import { buildRuntimeWorkspaceFingerprint } from "@openmeld/local-execution";
import type { LocalExecutionResourceClaim } from "@openmeld/local-service";
import type {
  ComputerFileAccessPolicy,
  ExecutionContextCompletion,
  ExecutionContextTask,
} from "@openmeld/schemas/types";
import { isSameOrDescendantPath } from "../../lib/path-containment";
import type { DaemonProfileRouteConfig } from "../core/types";
import { runAgentSessionForkOperation } from "../session-control/session-fork-operation-store";
import {
  type ExecutionContextWorkspace,
  readExecutionContextWorkspace,
} from "./execution-context-workspace";

export function executionContextLedgerPolicy(context?: ExecutionContextTask) {
  return context ? ("throw" as const) : ("backup_and_reset" as const);
}

/**
 * The shared roots of the Profile's effective working folder from the current
 * route, or null when that folder is not known yet.
 */
export function resolveQueuedFolderRoots(
  route: DaemonProfileRouteConfig | null | undefined
): string[] | null {
  const runtime = route?.workingFolderRuntime;
  if (runtime?.status !== "ready") {
    return null;
  }
  try {
    return resolveFolderResourceRoots(
      realpathSync.native(
        runtime.runtimeContext.providerRuntimeWorkingDirectory
      )
    );
  } catch {
    return null;
  }
}

/**
 * The canonical roots a task in `folder` shares with other local work.
 *
 * Every folder inside one Git checkout shares its files, index, and HEAD, so
 * the claim covers the whole checkout, found the way Git finds it from the
 * nearest `.git`. The claim also covers the repository's common Git directory:
 * linked worktrees share its refs, stash, and configuration with each other and
 * with the main checkout. A folder outside any checkout claims only itself.
 * Git metadata that cannot be read throws, so callers treat the roots as unknown.
 */
export function resolveFolderResourceRoots(folder: string): string[] {
  for (let directory = folder; ; directory = dirname(directory)) {
    const marker = join(directory, ".git");
    const markerInfo = statIfPresent(marker);
    if (markerInfo) {
      const gitDirectory = markerInfo.isDirectory()
        ? realpathSync.native(marker)
        : readGitDirectoryPointer(directory, marker);
      const commonDirectory = readGitCommonDirectory(gitDirectory);
      return isSameOrDescendantPath(commonDirectory, directory)
        ? [directory]
        : [directory, commonDirectory];
    }
    if (dirname(directory) === directory) {
      return [folder];
    }
  }
}

function statIfPresent(path: string) {
  try {
    return statSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function readGitDirectoryPointer(directory: string, marker: string): string {
  const pointer = readFileSync(marker, "utf8").trim();
  if (!pointer.startsWith("gitdir: ") || pointer.length > 4096) {
    throw new Error("execution_context.git_metadata_unreadable");
  }
  return realpathSync.native(
    resolve(directory, pointer.slice("gitdir: ".length))
  );
}

function readGitCommonDirectory(gitDirectory: string): string {
  const pointerPath = join(gitDirectory, "commondir");
  if (!statIfPresent(pointerPath)) {
    return gitDirectory;
  }
  return realpathSync.native(
    resolve(gitDirectory, readFileSync(pointerPath, "utf8").trim())
  );
}

/**
 * The local files a delivered Wake may touch, claimed before it is admitted.
 *
 * `currentFolderRoots` are the shared roots of the Profile's working folder,
 * or null when they are not known. A selected Project folder is resolved only
 * during preparation, so its roots stay unknown here and overlap every shared
 * root.
 */
export function executionContextResourceClaim(input: {
  context?: ExecutionContextTask;
  currentFolderRoots: string[] | null;
}): LocalExecutionResourceClaim {
  const { context } = input;
  if (!context) {
    return {
      kind: "shared",
      access: "write",
      legacy: true,
      roots: input.currentFolderRoots,
    };
  }
  if (context.access === "space_context" || context.workspace === "isolated") {
    return { kind: "private" };
  }
  return {
    kind: "shared",
    access: context.access === "workspace" ? "write" : "read",
    roots: context.projectWork ? null : input.currentFolderRoots,
  };
}

export function executionContextFileAccessBoundary(input: {
  context: ExecutionContextTask;
  workingDirectory: string;
  policy: ComputerFileAccessPolicy;
  taskWorkspace?: ExecutionContextWorkspace;
  workingCopyId?: string;
}): AdapterComputerFileAccessBoundary {
  const within = isSameOrDescendantPath;
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
    folders: [
      input.context.access === "space_context" && input.workingCopyId
        ? input.workingDirectory
        : (input.taskWorkspace?.boundaryRoot ?? input.workingDirectory),
    ],
    revision: policy.revision,
    updatedAtMs: policy.updatedAtMs,
    executionContextAccess: input.context.access,
    ...(input.taskWorkspace?.gitMetadata
      ? { gitMetadata: input.taskWorkspace.gitMetadata }
      : {}),
    ...(input.context.access === "space_context" && input.workingCopyId
      ? { workingCopyId: input.workingCopyId }
      : {}),
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
  /** Set when a fork continues in another folder than its source. */
  forkSourceWorkingDirectory?: string;
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
        ? (input.forkSourceWorkingDirectory ?? input.currentWorkingDirectory)
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
  // A frozen checkpoint is authoritative when Core assigned one. Otherwise the
  // boundary is resolved under the fork journal lock: the source may be a
  // thread OpenMeld never finished a turn on, and reading its settled turns
  // names a cutoff that is verified now rather than assumed. That read takes no
  // writer lock, so it works while another App Server holds the thread. The
  // journal records the exact boundary it forked at, so a lost response
  // or subsequent replay restores that recorded cutoff instead of re-reading
  // an advanced source history.
  const result = await runAgentSessionForkOperation({
    ledgerRootPath: input.ledgerRootPath,
    request: {
      kind: "execution_context",
      operationId: input.context.id,
      sourceNativeSessionId: source.nativeConversationId,
      ...(source.completedHistoryId
        ? { completedHistoryId: source.completedHistoryId }
        : {}),
      workingDirectory: input.workingDirectory,
    },
    resolveCompletedHistoryId: async () => {
      if (
        input.agentControllerRef === "builtin:codex" &&
        input.launchContract
      ) {
        const completed = await resolveCodexAppServerCompletedTurn({
          codexTimeoutMs: 30_000,
          codexWorkdir: sourceDirectory,
          launchContract: input.launchContract,
          threadId: source.nativeConversationId,
        });
        return completed.completedTurnId;
      }
      throw new Error("execution_context.fork_checkpoint_unavailable");
    },
    execute: async (forkInput) => {
      const completedHistoryId = forkInput?.completedHistoryId;
      if (!completedHistoryId) {
        throw new Error("execution_context.fork_checkpoint_unavailable");
      }
      if (input.agentControllerRef === "builtin:claude-code") {
        const messages = await readBoundedClaudeHistory(
          source.nativeConversationId
        );
        const boundary = messages.find(
          (message) =>
            message.uuid === completedHistoryId &&
            isCompletedAssistantMessage(message)
        );
        if (!boundary) {
          throw new Error("execution_context.fork_checkpoint_unavailable");
        }
        const child = await forkSession(source.nativeConversationId, {
          upToMessageId: completedHistoryId,
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
          sourceCompletedTurnId: completedHistoryId,
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
  /** The Service chose the workspace from Core's workspaceDefault. */
  reportWorkspace?: boolean;
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
    ...(input.reportWorkspace ? { workspace: input.context.workspace } : {}),
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
