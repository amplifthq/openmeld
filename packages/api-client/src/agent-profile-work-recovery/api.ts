import {
  agentProfileWorkRecoveryRouteParamsSchema,
  executeAgentProfileWorkRecoveryBodySchema,
  executeAgentProfileWorkRecoveryResponseSchema,
  openMeldRequestContextSchema,
} from "@openmeld/schemas";
import { buildAgentProfileWorkRecoveryRoute } from "./routes";
import type { CreateAgentProfileWorkRecoveryApi } from "./types";

const executeAgentProfileWorkRecoveryInputSchema =
  agentProfileWorkRecoveryRouteParamsSchema
    .extend({ requestContext: openMeldRequestContextSchema.optional() })
    .and(executeAgentProfileWorkRecoveryBodySchema);

export const createAgentProfileWorkRecoveryApi: CreateAgentProfileWorkRecoveryApi =
  (client) => ({
    execute: async (input) => {
      const parsed =
        executeAgentProfileWorkRecoveryInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues[0]?.message ??
            "Invalid Agent Profile work recovery request."
        );
      }
      const { agentProfileId, requestContext, ...body } = parsed.data;
      return await client.requestJson({
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        invalidMessage: "Invalid Agent Profile work recovery response.",
        method: "POST",
        operation: "agent_profile_work_recovery.execute",
        requestContext,
        schema: executeAgentProfileWorkRecoveryResponseSchema,
        url: buildAgentProfileWorkRecoveryRoute(agentProfileId),
      });
    },
  });
