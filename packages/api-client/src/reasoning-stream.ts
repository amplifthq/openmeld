import { localAgentReasoningPreferencesSchema } from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "./client";

export function createReasoningStreamApi(client: OpenMeldApiClientFoundation) {
  return {
    get: () =>
      client.requestJson({
        method: "GET",
        url: "/v1/account/reasoning-stream",
        operation: "reasoning_stream.preferences.get",
        schema: localAgentReasoningPreferencesSchema,
        invalidMessage: "Invalid reasoning streaming preference.",
      }),
    update: (enabled: boolean) =>
      client.requestJson({
        method: "PATCH",
        url: "/v1/account/reasoning-stream",
        operation: "reasoning_stream.preferences.update",
        schema: localAgentReasoningPreferencesSchema,
        body: JSON.stringify({ enabled }),
        headers: { "content-type": "application/json" },
        invalidMessage: "Invalid reasoning streaming preference.",
      }),
  };
}
