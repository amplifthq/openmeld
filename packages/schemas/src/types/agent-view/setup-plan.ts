import type { z } from "zod/v4";

type SetupPlanAgentViewPayloadSchema =
  typeof import("../../schemas/agent-view/setup-plan")["setupPlanAgentViewPayloadSchema"];
type SetupPlanAgentViewEventSchema =
  typeof import("../../schemas/agent-view/setup-plan")["setupPlanAgentViewEventSchema"];

export type SetupPlanAgentViewPayload =
  z.infer<SetupPlanAgentViewPayloadSchema>;
export type SetupPlanAgentViewEvent = z.infer<SetupPlanAgentViewEventSchema>;
