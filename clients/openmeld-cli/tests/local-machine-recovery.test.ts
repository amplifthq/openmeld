import { describe, expect, it } from "vitest";
import {
  assessLocalMachineFailure,
  isLocalMachineFailureError,
  toLocalMachineFailureError,
  toRecognizedLocalMachineFailureError,
} from "../src/system/local-machine-recovery";

function systemError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

describe("assessLocalMachineFailure", () => {
  it("reports exhausted storage with one retry action", () => {
    const issue = assessLocalMachineFailure({
      operation: "create_lock",
      error: systemError("ENOSPC", "no space left on device"),
    });

    expect(issue).toEqual({
      schemaVersion: 1,
      code: "local_machine.storage.exhausted",
      operation: "create_lock",
      recoveryPolicy: "user_action",
      summary:
        "Your computer is out of storage space. OpenMeld can't save the local files it needs.",
      primaryAction: "Free up storage, then try again.",
      diagnostics: {
        systemCode: "ENOSPC",
        detail: "no space left on device",
      },
    });
  });

  it("reports an unwritable OpenMeld data location without suggesting repair", () => {
    const issue = assessLocalMachineFailure({
      operation: "write_local_state",
      error: systemError("EROFS", "read-only file system"),
    });

    expect(issue.code).toBe("local_machine.storage.not_writable");
    expect(issue.recoveryPolicy).toBe("user_action");
    expect(issue.summary).toBe(
      "OpenMeld can't write to its local data folder."
    );
    expect(issue.primaryAction).toBe(
      "Make sure the folder is writable, then try again."
    );
    expect(issue.primaryAction).not.toContain("repair");
  });

  it("reports a read-only file system as unwritable regardless of the interrupted operation", () => {
    const issue = assessLocalMachineFailure({
      operation: "unknown",
      error: systemError("EROFS", "read-only file system"),
    });

    expect(issue.code).toBe("local_machine.storage.not_writable");
    expect(issue.primaryAction).toBe(
      "Make sure the folder is writable, then try again."
    );
  });

  it("reports exhausted computer resources with a bounded user action", () => {
    const issue = assessLocalMachineFailure({
      operation: "start_process",
      error: systemError("EMFILE", "too many open files"),
    });

    expect(issue.code).toBe("local_machine.resources.exhausted");
    expect(issue.recoveryPolicy).toBe("user_action");
    expect(issue.summary).toBe(
      "Your computer doesn't have enough available system resources for OpenMeld to continue."
    );
    expect(issue.primaryAction).toBe("Restart your computer, then try again.");
  });

  it("reports a general setup permission block without pretending it is Service drift", () => {
    const issue = assessLocalMachineFailure({
      operation: "unknown",
      error: systemError("EACCES", "permission denied"),
    });

    expect(issue.code).toBe("local_machine.permission.denied");
    expect(issue.recoveryPolicy).toBe("user_action");
    expect(issue.summary).toBe(
      "OpenMeld doesn't have permission to complete local setup on this computer."
    );
    expect(issue.primaryAction).toBe(
      "Allow OpenMeld to access its local files and background services, then try again."
    );
  });

  it("wraps the system failure without losing its original cause", () => {
    const cause = systemError("ENOSPC", "no space left on device");

    const error = toLocalMachineFailureError({
      operation: "create_lock",
      error: cause,
    });

    expect(isLocalMachineFailureError(error)).toBe(true);
    expect(error.code).toBe("local_machine.storage.exhausted");
    expect(error.issue.diagnostics.systemCode).toBe("ENOSPC");
    expect(error.cause).toBe(cause);
    expect(error.message).toBe(
      "Your computer is out of storage space. OpenMeld can't save the local files it needs. Free up storage, then try again."
    );
  });

  it("does not relabel an unrecognized application error as a computer problem", () => {
    const error = Object.assign(new Error("invalid state"), { code: "EINVAL" });

    expect(
      toRecognizedLocalMachineFailureError({
        operation: "unknown",
        error,
      })
    ).toBeNull();
  });
});
