import { realpath } from "node:fs/promises";
import { buildRuntimeWorkspaceFingerprint } from "@openmeld/local-execution";
import type { ExecutionContextTask } from "@openmeld/schemas/types";
import { DaemonServiceRunError } from "../core/types";
import { canIsolateExecutionContextFolder } from "./execution-context-workspace";

/**
 * The folder facts a task is admitted with (design-plans/member-agent-program.md
 * §4.9). The local execution slots compare `folderKey` to schedule only tasks
 * in one folder against each other, so the task must later run in exactly this
 * folder: `assertExecutionContextAdmittedFolder` fails closed otherwise.
 */
export type ExecutionContextFolderAdmission = {
  /** The task as it runs: a workspaceDefault is resolved and removed. */
  context: ExecutionContextTask | undefined;
  /** Absent: the folder is unknown or the task has no user folder. */
  folderKey?: string;
  /** Owner-safe name for local diagnostics; never a path. */
  folderLabel?: string;
  /** The Service chose the workspace and reports it in the completion. */
  workspaceChosen: boolean;
};

export async function resolveExecutionContextFolderAdmission(input: {
  context?: ExecutionContextTask;
  /** The task's working folder, resolved the same way the run resolves it. */
  resolveFolder: () => Promise<string>;
}): Promise<ExecutionContextFolderAdmission> {
  const original = input.context;
  if (!original) {
    return { context: undefined, workspaceChosen: false };
  }
  const { workspaceDefault, ...context } = original;
  if (context.access === "space_context") {
    return { context, workspaceChosen: false };
  }
  let folder: string | null = null;
  try {
    folder = await realpath(await input.resolveFolder());
  } catch {
    // The run resolves the folder again and reports the failure there.
  }
  const folderLabel = executionContextFolderLabel(context);
  if (!folder) {
    return { context, folderLabel, workspaceChosen: false };
  }
  const folderKey = executionContextFolderKey(folder);
  if (workspaceDefault !== "isolated_if_git") {
    return { context, folderKey, folderLabel, workspaceChosen: false };
  }
  return {
    context: {
      ...context,
      workspace: (await canIsolateExecutionContextFolder(folder))
        ? "isolated"
        : "current",
    },
    folderKey,
    folderLabel,
    workspaceChosen: true,
  };
}

/**
 * A task admitted against one folder must not run in another: two writers
 * would share a folder the slots believed separate. An unresolved folder is
 * acceptable only when the task kept the machine-wide rule and its assigned
 * workspace, since nothing was decided from the folder.
 */
export async function assertExecutionContextAdmittedFolder(input: {
  /** Absent: a direct caller that did not go through local admission. */
  admission?: Pick<
    ExecutionContextFolderAdmission,
    "folderKey" | "workspaceChosen"
  >;
  context?: ExecutionContextTask;
  workingDirectory: string;
}): Promise<void> {
  const admission = input.admission;
  if (
    !(admission && input.context) ||
    input.context.access === "space_context" ||
    (admission.folderKey === undefined && !admission.workspaceChosen)
  ) {
    return;
  }
  const folderKey = executionContextFolderKey(
    await realpath(input.workingDirectory)
  );
  if (folderKey !== admission.folderKey) {
    throw new DaemonServiceRunError({
      code: "execution_context.folder_changed_while_queued",
      message:
        "execution_context.folder_changed_while_queued: this task's working folder changed while it waited to start. Send the request again.",
    });
  }
}

export function executionContextFolderKey(canonicalFolder: string): string {
  return buildRuntimeWorkspaceFingerprint(canonicalFolder);
}

function executionContextFolderLabel(context: ExecutionContextTask): string {
  if (context.projectWork) {
    return `Project ${context.projectWork.projectId}`;
  }
  return context.folderId ? `folder ${context.folderId}` : "the default folder";
}

/** A task with no user folder: only the workspace hint is removed. */
export function resolveExecutionContextAdmissionWithoutFolder(
  context?: ExecutionContextTask
): ExecutionContextFolderAdmission {
  if (!context) {
    return { context: undefined, workspaceChosen: false };
  }
  const { workspaceDefault: _noFolder, ...withoutDefault } = context;
  return { context: withoutDefault, workspaceChosen: false };
}

export function needsExecutionContextFolderAdmission(
  context?: ExecutionContextTask
): boolean {
  return Boolean(context && context.access !== "space_context");
}

const admissionTails = new WeakMap<object, Promise<void>>();

/**
 * Keeps local admission FIFO while a task's folder is resolved: a task that
 * needs no folder still waits behind one that is being resolved.
 */
export function runInLocalAdmissionOrder<T>(input: {
  order: object;
  prepare: (() => Promise<T>) | null;
  ready: () => T;
  admit: (value: T) => void;
  onError: (error: unknown) => void;
}): void {
  const tail = admissionTails.get(input.order);
  if (!(input.prepare || tail)) {
    input.admit(input.ready());
    return;
  }
  const prepare = input.prepare ?? (() => Promise.resolve(input.ready()));
  const next = (tail ?? Promise.resolve())
    .then(prepare)
    .then(input.admit)
    .catch(input.onError);
  admissionTails.set(input.order, next);
  next.finally(() => {
    if (admissionTails.get(input.order) === next) {
      admissionTails.delete(input.order);
    }
  });
}
