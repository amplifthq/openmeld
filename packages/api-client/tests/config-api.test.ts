import { describe, expect, it, vi } from "vitest";
import { createConfigApi, createOpenMeldApiClient } from "../src";

const VALID_MODEL_CATALOG = {
  schemaVersion: 1,
  updatedAt: "2026-06-18T00:00:00.000Z",
  agentControllers: {
    codex: {
      defaultModelId: "gpt-5.5",
      models: [
        {
          id: "gpt-5.5",
          displayName: "GPT-5.5",
          unavailable: false,
          supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
          minCliVersion: null,
        },
      ],
    },
  },
};

describe("api-client config api", () => {
  it("reads the model catalog through the shared API client", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(VALID_MODEL_CATALOG), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    const api = createConfigApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getModelCatalog();

    expect(result.agentControllers.codex?.defaultModelId).toBe("gpt-5.5");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/config/model-catalog",
        operation: "config.model_catalog.read",
        init: expect.objectContaining({
          method: "GET",
        }),
      })
    );
  });
});
