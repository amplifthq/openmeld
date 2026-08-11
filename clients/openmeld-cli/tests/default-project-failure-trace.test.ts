import { describe, expect, it } from "vitest";
import { DaemonServiceRunError } from "../src/local-service/core/types";
import { buildFailedTaskResultPayload } from "../src/local-service/dispatch/send-dispatch-result";
import { toTaskExecutionError } from "../src/local-service/execution/task-execution-error";

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
});
