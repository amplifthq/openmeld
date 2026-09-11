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
});
