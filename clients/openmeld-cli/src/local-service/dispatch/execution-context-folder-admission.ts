import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { buildRuntimeWorkspaceFingerprint } from "@openmeld/local-execution";
import type { ExecutionContextTask } from "@openmeld/schemas/types";
import { DaemonServiceRunError } from "../core/types";
import { resolveFolderResourceRoots } from "./execution-context-session";

// A stalled filesystem read must not hold later deliveries in admission order.
const FOLDER_ADMISSION_TIMEOUT_MS = 10_000;

/**
 * The folder facts a task is admitted with (design-plans/member-agent-program.md
 * §4.9). The local execution slots claim `folderRoots` to schedule only tasks
 * with overlapping roots against each other, so the task must later run in
 * exactly this folder (`folderKey`): `assertExecutionContextAdmittedFolder`
 * fails closed otherwise.
 */
export type ExecutionContextFolderAdmission = {
  /** The task as it runs: a workspaceDefault is resolved and removed. */
  context: ExecutionContextTask | undefined;
  /** Absent: the folder is unknown or the task has no user folder. */
  folderKey?: string;
  /** The shared roots of the admitted folder; absent or null when unknown. */
  folderRoots?: string[] | null;
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
  const folder = await resolveAdmissionFolder(input.resolveFolder);
  const folderLabel = executionContextFolderLabel(context);
  if (!folder) {
    // A pending default stays undecided: the run then fails closed instead of
    // falling back to direct edit when the folder resolves later.
    return {
      context,
      folderLabel,
      workspaceChosen: workspaceDefault === "isolated_if_git",
    };
  }
  const folderKey = executionContextFolderKey(folder);
  const folderRoots = resolveAdmittedFolderRoots(folder);
  if (workspaceDefault !== "isolated_if_git") {
    return {
      context,
      folderKey,
      folderLabel,
      folderRoots,
      workspaceChosen: false,
    };
  }
  return {
    context: {
      ...context,
      workspace: (await isGitRepositoryFolder(folder)) ? "isolated" : "current",
    },
    folderKey,
    folderLabel,
    folderRoots,
    workspaceChosen: true,
  };
}

function resolveAdmittedFolderRoots(folder: string): string[] | null {
  try {
    return resolveFolderResourceRoots(folder);
  } catch {
    // Unreadable Git metadata: unknown roots overlap every shared root.
    return null;
  }
}

async function resolveAdmissionFolder(
  resolveFolder: () => Promise<string>
): Promise<string | null> {
  try {
    return await realpath(
      await withTimeout(resolveFolder(), FOLDER_ADMISSION_TIMEOUT_MS)
    );
  } catch {
    // The run resolves the folder again and reports the failure there.
    return null;
  }
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
}): Promise<string> {
  const admission = input.admission;
  if (
    !(admission && input.context) ||
    input.context.access === "space_context" ||
    (admission.folderKey === undefined && !admission.workspaceChosen)
  ) {
    return input.workingDirectory;
  }
  // Errors carry no path: this text reaches Core-bound failure payloads.
  const folder = await realpath(input.workingDirectory).catch(() => null);
  if (!folder || executionContextFolderKey(folder) !== admission.folderKey) {
    throw new DaemonServiceRunError({
      code: "execution_context.folder_changed_while_queued",
      message:
        "execution_context.folder_changed_while_queued: this task's working folder changed or became unavailable while it waited to start. Send the request again.",
    });
  }
  // The run continues in the canonical folder it was admitted with, so a
  // later symlink change cannot move it into another folder.
  return folder;
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

/**
 * Whether the folder is a git repository root (a `.git` entry). A repository
 * whose isolated copy then fails (for example, no commit yet) fails visibly;
 * it never falls back to direct edit. Unreadable state counts as git.
 */
async function isGitRepositoryFolder(folder: string): Promise<boolean> {
  try {
    await lstat(join(folder, ".git"));
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("execution_context.folder_admission_timeout")),
        ms
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
