import { describe, expect, it } from "vitest";
import { DaemonServiceRunError } from "../src/local-service/core/types";
import { buildFailedTaskResultPayload } from "../src/local-service/dispatch/send-dispatch-result";
import { toTaskExecutionError } from "../src/local-service/execution/task-execution-error";
import { ComputerFileAccessStoreError } from "../src/local-service/file-access/computer-file-access-store";

describe("Default Project failure trace", () => {
  it("preserves Project identity without exposing a local path", () => {
    const typedError = toTaskExecutionError(
      new DaemonServiceRunError({
        code: "project.local_connection.folder_missing",
        message: "project.local_connection.folder_missing",
        projectFailureContext: {
          bindingGeneration: "binding-1",
          projectId: "project-1",
        },
      })
    );
    const result = buildFailedTaskResultPayload({
      agentControllerRef: "builtin:codex",
      attemptId: "attempt-1",
      errorCode: typedError.errorCode,
      errorMessage: typedError.message,
      errorType: typedError.errorType,
      projectFailureContext: typedError.projectFailureContext,
      sourceEventId: "event-1",
      targetProfileId: "agent-1",
      taskId: "task-1",
    });

    expect(result.projectFailureContext).toEqual({
      bindingGeneration: "binding-1",
      projectId: "project-1",
    });
    expect(JSON.stringify(result)).not.toContain("/private/");
  });

  it("preserves a safe Computer file access error without publishing diagnostics", () => {
    const storePath = "/private/openmeld/computer-file-access-v1.json";
    const typedError = toTaskExecutionError(
      new ComputerFileAccessStoreError(
        "computer.file_access.invalid_response",
        "Computer file access store is incompatible. Repair or update OpenMeld Service before trying again.",
        {
          localDiagnosticContext: {
            reason: "malformed_json",
            storePath,
          },
        }
      )
    );

    expect(typedError).toMatchObject({
      errorCode: "computer.file_access.invalid_response",
      errorType: "config",
    });
    expect(JSON.stringify(typedError)).not.toContain(storePath);
  });
});
