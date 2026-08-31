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
      return await client.requestJson({
        body: JSON.stringify(
          parsed.data.action === "skip_interrupted_work"
            ? {
                action: parsed.data.action,
                expectedInterruptedTargetWakeLifecycleId:
                  parsed.data.expectedInterruptedTargetWakeLifecycleId,
              }
            : { action: parsed.data.action }
        ),
        headers: { "content-type": "application/json" },
        invalidMessage: "Invalid Agent Profile work recovery response.",
        method: "POST",
        operation: "agent_profile_work_recovery.execute",
        requestContext: parsed.data.requestContext,
        schema: executeAgentProfileWorkRecoveryResponseSchema,
        url: buildAgentProfileWorkRecoveryRoute(parsed.data.agentProfileId),
      });
    },
  });
