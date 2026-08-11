import { z } from "zod/v4";
import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "../daemon/agent-controller-ref";

export const HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID =
  "hosted:center-agent" as const;

export const hostedCenterAgentRuntimeIdentitySchema = z.strictObject({
  kind: z.literal("hosted_center_agent"),
  authority: z.literal("core_logical_runtime"),
  agentControllerRef: z.literal(HOSTED_CENTER_AGENT_CONTROLLER_REF),
  logicalRuntimeId: z.literal(HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID),
  platform: z.literal("cloudflare_think"),
});

export const HOSTED_CENTER_AGENT_RUNTIME_IDENTITY = {
  kind: "hosted_center_agent",
  authority: "core_logical_runtime",
  agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
  logicalRuntimeId: HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  platform: "cloudflare_think",
} as const satisfies z.infer<typeof hostedCenterAgentRuntimeIdentitySchema>;
