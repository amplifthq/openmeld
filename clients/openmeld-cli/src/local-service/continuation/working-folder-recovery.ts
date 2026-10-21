import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename } from "node:path";
import type { AdapterInteractionCallback } from "@openmeld/adapter-core";
import {
  buildWorkingFolderRecoveryQuestion,
  WORKING_FOLDER_RECOVERY_DECLINED,
  WORKING_FOLDER_RECOVERY_QUESTION_ID,
} from "@openmeld/schemas";
import type {
  ComputerFileAccessPolicy,
  ConversationExecutionState,
} from "@openmeld/schemas/types";
import {
  readOpenCodeSessionRows,
  resolveOpenCodeDatabasePath,
} from "../../agent-activity/opencode-storage";
import { DaemonServiceRunError } from "../core/types";
import { assertComputerFileAccessWorkingDirectoryAllowed } from "../file-access/computer-file-access-admission";

type FolderChoice = { workingDirectory: string; startNewConversation: boolean };

/**
 * Whether the task may move to its conversation's earlier folder once the owner
 * answers, so its working folder is not known before it starts.
 */
export function mayRecoverWorkingFolder(input: {
  agentControllerRef: string;
  nativeSessionId: string | null;
  hasExecutionContext?: boolean;
}): boolean {
  return (
    !input.hasExecutionContext &&
    input.agentControllerRef === "builtin:opencode" &&
    Boolean(input.nativeSessionId)
  );
}

/** Admission asks the owner before any prompt, attachment, or bootstrap uses a folder. */
export async function resolveWorkingFolderRecovery(input: {
  agentControllerRef: string;
  nativeSessionId: string | null;
  workingDirectory: string;
  policy: ComputerFileAccessPolicy;
  onInteractionRequest: AdapterInteractionCallback;
  inspectSession?: (
    nativeSessionId: string
  ) => Promise<{ directory: string; sessionId: string }>;
  hasExecutionContext?: boolean;
}): Promise<FolderChoice> {
  const unchanged = {
    workingDirectory: input.workingDirectory,
    startNewConversation: false,
  };
  const nativeSessionId = input.nativeSessionId;
  if (!(nativeSessionId && mayRecoverWorkingFolder(input))) {
    return unchanged;
  }
  const inspect = () =>
    (input.inspectSession ?? inspectRetainedOpenCodeSession)(nativeSessionId);
  const session = await inspect();
  const selectedFolder = await realpath(input.workingDirectory);
  const previousFolder = await realpath(session.directory).catch(() => null);
  if (selectedFolder === previousFolder) {
    return unchanged;
  }
  let previousFolderAllowed = previousFolder !== null;
  if (previousFolder && input.policy.mode !== "local_agent_settings") {
    try {
      await assertComputerFileAccessWorkingDirectoryAllowed({
        boundary: input.policy,
        providerRuntimeWorkingDirectory: previousFolder,
      });
    } catch {
      previousFolderAllowed = false;
    }
  }
  const previousFolderStatus = previousFolder ? "restricted" : "missing";
  const response = await input.onInteractionRequest(
    buildWorkingFolderRecoveryQuestion({
      previousFolder: previousFolderAllowed
        ? "available"
        : previousFolderStatus,
      previousFolderLabel: basename(session.directory),
      selectedFolderLabel: basename(selectedFolder),
    })
  );
  const choice =
    response.kind === "question" &&
    response.answers.length === 1 &&
    response.answers[0]?.questionId === WORKING_FOLDER_RECOVERY_QUESTION_ID &&
    response.answers[0].values.length === 1
      ? response.answers[0].values[0]
      : null;
  if (choice === "leave_task") {
    throw failure(
      WORKING_FOLDER_RECOVERY_DECLINED,
      "The Computer owner stopped this task before the Agent started. The previous conversation is saved."
    );
  }
  if (
    choice !== "start_new_conversation" &&
    !(choice === "use_previous_folder" && previousFolderAllowed)
  ) {
    throw failure(
      "context.workspace_recovery_unanswered",
      "This task did not start because no folder choice was confirmed. Send it again when you’re ready."
    );
  }
  // The owner may be away for hours. Re-read the exact native association and
  // both filesystem identities; an old answer must not authorize a moved path.
  const latest = await inspect();
  if (
    latest.sessionId !== session.sessionId ||
    latest.directory !== session.directory ||
    (await realpath(input.workingDirectory).catch(() => null)) !==
      selectedFolder ||
    (previousFolder &&
      (await realpath(session.directory).catch(() => null)) !== previousFolder)
  ) {
    throw failure(
      "context.workspace_recovery_changed",
      "The conversation or folder changed while waiting. Send this task again to review the current choices."
    );
  }
  return {
    workingDirectory:
      choice === "use_previous_folder" && previousFolder
        ? previousFolder
        : selectedFolder,
    startNewConversation: choice === "start_new_conversation",
  };
}

export function resolveRecoveredLedgerConversation(input: {
  startNewConversation: boolean;
  bindingConversationId: string | null;
  existingContextId: string | null;
  currentExecutionState: ConversationExecutionState | null;
}) {
  return input.startNewConversation
    ? {
        bindingConversationId: null,
        existingContextId: null,
        currentExecutionState: null,
      }
    : input;
}

function failure(
  code: string,
  message: string,
  cause?: unknown
): DaemonServiceRunError {
  const error = new DaemonServiceRunError({ code, message });
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
}

async function inspectRetainedOpenCodeSession(
  nativeSessionId: string
): Promise<{ directory: string; sessionId: string }> {
  try {
    const rows = await readOpenCodeSessionRows(
      resolveOpenCodeDatabasePath({ homeDir: homedir() }),
      nativeSessionId
    );
    const session = rows[0];
    if (
      rows.length === 1 &&
      session?.id === nativeSessionId &&
      typeof session.directory === "string" &&
      session.directory.trim()
    ) {
      return { directory: session.directory, sessionId: nativeSessionId };
    }
  } catch (cause) {
    // This is only a preflight read. Never repair or create the provider's store.
    throw failure(
      "context.workspace_verification_unavailable",
      "OpenMeld could not read this conversation’s folder. Open the conversation in OpenCode, then try this task again.",
      cause
    );
  }
  throw failure(
    "context.workspace_verification_unavailable",
    "OpenMeld could not read this conversation’s folder. Open the conversation in OpenCode, then try this task again."
  );
}
