import { describe, expect, it, vi } from "vitest";
import { executePluginRuntime } from "../connectors/plugin-runtime";
import capturedActions from "./fixtures/openconnector-runtime-actions.json";

describe("shared plugin runtime", () => {
  it.each([
    ["posthog.list_projects", ["posthog.list_projects"]],
    ["posthog.create_dashboard", []],
    ["posthog.missing", []],
  ])("filters exact metadata from an older producer for %s", async (actionId, expected) => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json(capturedActions)
    );
    const result = await executePluginRuntime(
      { operation: "list", service: "posthog", actionId },
      {
        baseUrl: "https://connector.example",
        runtimeToken: "test-runtime-token",
        fetch: transport,
      }
    );
    expect(result.status).toBe("catalog");
    if (result.status !== "catalog") {
      throw new Error("Expected catalog");
    }
    expect(result.actions.map((action) => action.id)).toEqual(expected);
    expect(transport.mock.calls[0]?.[0]).toBe(
      `https://connector.example/v1/actions?service=posthog&actionId=${actionId}`
    );
  });
  it.each([
    [
      "wrong action identity",
      {
        actionId: "github.delete_issue",
        auditPersisted: true,
        executionId: "provider-execution-1",
      },
      { type: "object" },
    ],
    [
      "missing execution identity",
      { actionId: "github.create_issue_comment", auditPersisted: true },
      { type: "object" },
    ],
    [
      "invalid output schema",
      {
        actionId: "github.create_issue_comment",
        auditPersisted: true,
        executionId: "provider-execution-1",
      },
      false,
    ],
  ])("does not complete or retry a write with %s", async (_label, meta, outputSchema) => {
    const capturedAction = capturedActions.data[0];
    if (!capturedAction) {
      throw new Error("Expected a captured action");
    }
    const action = {
      ...capturedAction,
      id: "github.create_issue_comment",
      service: "github",
      operationType: "write",
      outputSchema: { type: "object" },
    };
    // Mutate only the documented pinned-producer success envelope's identity
    // or schema. An invalid receipt may follow a real completed side effect.
    const transport = vi.fn<typeof fetch>(async (request) =>
      String(request).includes("/v1/actions?service=github")
        ? Response.json({
            success: true,
            message: "OK",
            data: [action],
            meta: {},
          })
        : Response.json({
            success: true,
            message: "OK",
            data: { id: 123 },
            meta,
            outputSchema,
          })
    );
    const result = await executePluginRuntime(
      {
        operation: "execute",
        service: "github",
        actionId: action.id,
        connectionName: "org_aaaaaaaaaaaaaaaaaa__shared__github",
        input: { body: "Comment posted" },
        idempotencyKey: "operation-1",
        authorizedEffect: "write",
      },
      {
        baseUrl: "https://connector.example",
        runtimeToken: "test-runtime-token",
        fetch: transport,
      }
    );
    expect(result.status).toBe("outcome_unknown");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("returns the executable catalog from the captured provider contract", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json(capturedActions)
    );
    const result = await executePluginRuntime(
      { operation: "list", service: "posthog" },
      {
        baseUrl: "https://connector.example",
        runtimeToken: "test-runtime-token",
        fetch: transport,
      }
    );
    expect(result.status).toBe("catalog");
    if (result.status !== "catalog") {
      throw new Error("Expected catalog");
    }
    expect(result.actions.map((action) => action.id)).toEqual([
      "posthog.list_projects",
    ]);
  });

  it("does not execute when the provider cannot substantiate the admitted read permission", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json(capturedActions)
    );
    const result = await executePluginRuntime(
      {
        operation: "execute",
        service: "posthog",
        actionId: "posthog.list_projects",
        connectionName: "org_aaaaaaaaaaaaaaaaaa__shared__posthog",
        input: {},
        idempotencyKey: "operation-1",
        authorizedEffect: "read",
      },
      {
        baseUrl: "https://connector.example",
        runtimeToken: "test-runtime-token",
        fetch: transport,
      }
    );
    expect(result.status).toBe("failed");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toBe(
      "https://connector.example/v1/actions?service=posthog&actionId=posthog.list_projects"
    );
  });

  it.each([
    ["github.create_issue", true],
    ["github.update_issue", true],
    ["github.create_issue_comment", true],
    ["github.create_issue_comment", false],
  ] as const)("returns a completed %s (execution output schema present=%s)", async (actionId, includeExecutionSchema) => {
    const capturedAction = capturedActions.data[0];
    if (!capturedAction) {
      throw new Error("Expected a captured action");
    }
    const action = {
      ...capturedAction,
      operationType: "write",
      id: actionId,
      outputSchema: { type: "object" },
      service: "github",
    };
    // Execution metadata may differ from an earlier catalog read.
    const executionOutputSchema = {
      type: "object",
      properties: { id: { type: "integer" }, body: { type: "string" } },
    };
    const transport = vi.fn<typeof fetch>(async (request) =>
      String(request).includes("/v1/actions?service=github")
        ? Response.json({
            success: true,
            message: "OK",
            data: [action],
            meta: {},
          })
        : Response.json({
            success: true,
            message: "OK",
            data: { id: 123, body: "Comment posted" },
            ...(includeExecutionSchema
              ? { outputSchema: executionOutputSchema }
              : {}),
            meta: {
              actionId: action.id,
              auditPersisted: true,
              executionId: "provider-execution-1",
            },
          })
    );
    const result = await executePluginRuntime(
      {
        operation: "execute",
        service: "github",
        actionId: action.id,
        connectionName: "org_aaaaaaaaaaaaaaaaaa__shared__github",
        input: { body: "Comment posted" },
        idempotencyKey: "operation-1",
        authorizedEffect: "write",
      },
      {
        baseUrl: "https://connector.example",
        runtimeToken: "test-runtime-token",
        fetch: transport,
      }
    );
    expect(result).toMatchObject({
      status: "completed",
      data: { id: 123, body: "Comment posted" },
      outputSchema: includeExecutionSchema
        ? executionOutputSchema
        : action.outputSchema,
      providerExecutionId: "provider-execution-1",
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
