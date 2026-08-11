import {
  formatLocalMachineIssueMessage,
  type LocalMachineIssue,
  type LocalMachineOperation,
} from "@openmeld/schemas";

type LocalMachineFailureInput = {
  operation: LocalMachineOperation;
  error: unknown;
};

export class LocalMachineFailureError extends Error {
  readonly code: LocalMachineIssue["code"];
  readonly issue: LocalMachineIssue;

  constructor(input: { issue: LocalMachineIssue; cause?: unknown }) {
    super(formatLocalMachineIssueMessage(input.issue), {
      cause: input.cause,
    });
    this.name = "LocalMachineFailureError";
    this.code = input.issue.code;
    this.issue = input.issue;
  }
}

export function isLocalMachineFailureError(
  error: unknown
): error is LocalMachineFailureError {
  return error instanceof LocalMachineFailureError;
}

export function toLocalMachineFailureError(
  input: LocalMachineFailureInput
): LocalMachineFailureError {
  if (isLocalMachineFailureError(input.error)) {
    return input.error;
  }
  return new LocalMachineFailureError({
    issue: assessLocalMachineFailure(input),
    cause: input.error,
  });
}

export function toRecognizedLocalMachineFailureError(
  input: LocalMachineFailureInput
): LocalMachineFailureError | null {
  if (isLocalMachineFailureError(input.error)) {
    return input.error;
  }
  const issue = assessLocalMachineFailure(input);
  return issue.code === "local_machine.failure.unknown"
    ? null
    : new LocalMachineFailureError({
        issue,
        cause: input.error,
      });
}

export function assessLocalMachineFailure(
  input: LocalMachineFailureInput
): LocalMachineIssue {
  const systemCode = readSystemErrorCode(input.error);
  const detail = readErrorMessage(input.error);

  if (systemCode === "ENOSPC" || systemCode === "EDQUOT") {
    return {
      schemaVersion: 1,
      code: "local_machine.storage.exhausted",
      operation: input.operation,
      recoveryPolicy: "user_action",
      summary:
        "Your computer is out of storage space. OpenMeld can't save the local files it needs.",
      primaryAction: "Free up storage, then try again.",
      diagnostics: {
        systemCode,
        detail,
      },
    };
  }

  if (
    systemCode === "EROFS" ||
    ((input.operation === "create_lock" ||
      input.operation === "write_local_state") &&
      (systemCode === "EACCES" || systemCode === "EPERM"))
  ) {
    return {
      schemaVersion: 1,
      code: "local_machine.storage.not_writable",
      operation: input.operation,
      recoveryPolicy: "user_action",
      summary: "OpenMeld can't write to its local data folder.",
      primaryAction: "Make sure the folder is writable, then try again.",
      diagnostics: {
        systemCode,
        detail,
      },
    };
  }

  if (
    systemCode === "EACCES" ||
    systemCode === "EPERM" ||
    systemCode === "EROFS"
  ) {
    return {
      schemaVersion: 1,
      code: "local_machine.permission.denied",
      operation: input.operation,
      recoveryPolicy: "user_action",
      summary:
        "OpenMeld doesn't have permission to complete local setup on this computer.",
      primaryAction:
        "Allow OpenMeld to access its local files and background services, then try again.",
      diagnostics: {
        systemCode,
        detail,
      },
    };
  }

  if (
    systemCode === "EMFILE" ||
    systemCode === "ENFILE" ||
    systemCode === "ENOMEM"
  ) {
    return {
      schemaVersion: 1,
      code: "local_machine.resources.exhausted",
      operation: input.operation,
      recoveryPolicy: "user_action",
      summary:
        "Your computer doesn't have enough available system resources for OpenMeld to continue.",
      primaryAction: "Restart your computer, then try again.",
      diagnostics: {
        systemCode,
        detail,
      },
    };
  }

  return {
    schemaVersion: 1,
    code: "local_machine.failure.unknown",
    operation: input.operation,
    recoveryPolicy: "diagnostics",
    summary: "OpenMeld couldn't complete a required action on this computer.",
    primaryAction: "Try again. If it still fails, open diagnostics.",
    diagnostics: {
      systemCode,
      detail,
    },
  };
}

export function createBackgroundExecutionBlockedIssue(input: {
  detail?: string | null;
}): LocalMachineIssue {
  return {
    schemaVersion: 1,
    code: "local_machine.background_execution.blocked",
    operation: "start_background_service",
    recoveryPolicy: "user_action",
    summary: "macOS blocked OpenMeld Service from running in the background.",
    primaryAction:
      "Open System Settings > General > Login Items & Extensions, enable OpenMeld, then try again.",
    diagnostics: {
      systemCode: "BACKGROUND_EXECUTION_BLOCKED",
      detail: input.detail?.trim().slice(0, 2048) || null,
    },
  };
}

export function createActiveSetupConcurrencyIssue(input: {
  detail?: string | null;
  primaryAction: string;
}): LocalMachineIssue {
  return {
    schemaVersion: 1,
    code: "local_machine.concurrency.active",
    operation: "create_lock",
    recoveryPolicy: "user_action",
    summary: "Another OpenMeld setup is already running on this computer.",
    primaryAction: input.primaryAction,
    diagnostics: {
      systemCode: "OPENMELD_LOCK_ACTIVE",
      detail: input.detail?.trim().slice(0, 2048) || null,
    },
  };
}

export function createOrphanedSetupConcurrencyIssue(input: {
  detail?: string | null;
  primaryAction: string;
}): LocalMachineIssue {
  return createOrphanedLocalConcurrencyIssue({
    ...input,
    summary: "OpenMeld found a setup lock left by an older version.",
  });
}

export function createOrphanedLocalConcurrencyIssue(input: {
  detail?: string | null;
  primaryAction: string;
  summary: string;
}): LocalMachineIssue {
  return {
    schemaVersion: 1,
    code: "local_machine.concurrency.orphaned",
    operation: "create_lock",
    recoveryPolicy: "user_action",
    summary: input.summary,
    primaryAction: input.primaryAction,
    diagnostics: {
      systemCode: "OPENMELD_LOCK_ORPHANED",
      detail: input.detail?.trim().slice(0, 2048) || null,
    },
  };
}

function readSystemErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim().length > 0 ? code : null;
}

function readErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 2048);
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim().slice(0, 2048);
  }
  return null;
}
