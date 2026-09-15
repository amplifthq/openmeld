import {
  agentProfileExecutionModeResponseSchema,
  updateAgentProfileExecutionModeBodySchema,
} from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "./client";

export function createAgentProfileExecutionModeApi(
  client: OpenMeldApiClientFoundation
) {
  return {
    readOrUpdate(input: {
      agentProfileId: string;
      mode?: "parallel" | "serial";
      requestContext?: OpenMeldRequestContext;
    }) {
      const body =
        input.mode === undefined
          ? undefined
          : updateAgentProfileExecutionModeBodySchema.parse({
              mode: input.mode,
            });
      return client.requestJson({
        url: `/v1/agent-profiles/${encodeURIComponent(input.agentProfileId)}/execution-mode`,
        method: body ? "PATCH" : "GET",
        ...(body
          ? {
              body: JSON.stringify(body),
              headers: { "content-type": "application/json" },
            }
          : {}),
        schema: agentProfileExecutionModeResponseSchema,
        requestContext: input.requestContext,
        operation: "agent_profile.execution_mode",
        invalidMessage: "Invalid Agent Profile execution mode response.",
      });
    },
  };
}
