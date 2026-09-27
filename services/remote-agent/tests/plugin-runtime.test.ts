import { describe, expect, it, vi } from "vitest";
import { executePluginRuntime } from "../connectors/plugin-runtime";
import capturedActions from "./fixtures/openconnector-runtime-actions.json";

describe("shared plugin runtime", () => {
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
      "https://connector.example/v1/actions?service=posthog"
    );
  });

  it("returns a completed write from the pinned OpenConnector execution envelope", async () => {
    const capturedAction = capturedActions.data[0];
    if (!capturedAction) {
      throw new Error("Expected a captured action");
    }
    const action = {
      ...capturedAction,
      operationType: "write",
      id: "github.create_issue_comment",
      outputSchema: { type: "object" },
      service: "github",
    };
    const transport = vi.fn<typeof fetch>(async (request) =>
      String(request).endsWith("/v1/actions?service=github")
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
      outputSchema: action.outputSchema,
      providerExecutionId: "provider-execution-1",
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
