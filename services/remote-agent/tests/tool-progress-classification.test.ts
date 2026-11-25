import { describe, expect, it } from "vitest";
import { getRemoteAgentOpenMeldToolDefinitions } from "../agent-core/tools";
import { InMemoryDurableObjectStorage } from "./storage";

describe("Remote Agent tool progress classification", () => {
  it("tracks read-only observations without inferring the same rule for effects", () => {
    const definitions = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      submissionId: "submission_progress_classification",
    });
    const byName = new Map(
      definitions.map((definition) => [definition.name, definition])
    );

    expect(byName.get("openmeld_list_app_actions")?.progressTracking).toBe(
      "observation"
    );
    expect(byName.get("openmeld_get_app_action_status")?.progressTracking).toBe(
      "observation"
    );
    expect(byName.get("github_get_pull_request")?.progressTracking).toBe(
      "observation"
    );
    expect(byName.get("openmeld_execute_app_action")?.progressTracking).toBe(
      undefined
    );
    expect(byName.get("github_create_issue")?.progressTracking).toBe(undefined);
  });

  it("ignores only replay countdowns when comparing App status progress", () => {
    const definition = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      submissionId: "submission_app_status_progress",
    }).find((tool) => tool.name === "openmeld_get_app_action_status");
    expect(definition?.progressValue).toBeDefined();
    const progress = (result: unknown) => definition?.progressValue?.(result);
    const result = {
      service: "linear",
      actionId: "linear.create_linear_issue",
      operationId: "original-operation",
      operation: {
        service: "linear",
        actionId: "linear.create_linear_issue",
        operationId: "original-operation",
        connectionName: "linear-shared",
        createdAtMs: 100,
        status: "outcome_unknown",
        replayWindowRemainingMs: 1000,
        replay: { allowed: true, remainingWindowMs: 1000, maxAttempts: 1 },
      },
      requestAuthorization: {
        requestId: "11111111-1111-4111-8111-111111111111",
        state: "approved",
        continuation: "requested",
      },
      requestAuthorizationSupported: true,
    };
    const original = structuredClone(result);
    expect(progress(result)).toEqual(
      progress({
        ...result,
        operation: {
          ...result.operation,
          replayWindowRemainingMs: 900,
          replay: { ...result.operation.replay, remainingWindowMs: 900 },
        },
      })
    );
    for (const changed of [
      { ...result, operation: { ...result.operation, status: "completed" } },
      {
        ...result,
        operation: {
          ...result.operation,
          replay: { allowed: false, reason: "window_expired" },
        },
      },
      {
        ...result,
        requestAuthorization: {
          ...result.requestAuthorization,
          state: "revoked",
        },
      },
      {
        ...result,
        requestAuthorization: {
          ...result.requestAuthorization,
          continuation: "unavailable",
        },
      },
    ]) {
      expect(progress(result)).not.toEqual(progress(changed));
    }
    const pending = { ...result, operation: null };
    expect(progress(pending)).toEqual(pending);
    expect(result).toEqual(original);
  });
});
