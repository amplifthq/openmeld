import { z } from "zod/v4";
import { onboardingFactsSchema, onboardingPlanSchema } from "../start";

export const SETUP_PLAN_AGENT_VIEW_SCHEMA_VERSION = 1 as const;
export const SETUP_PLAN_AGENT_VIEW_CODE = "setup.plan" as const;

export const setupPlanAgentViewPayloadSchema = z.strictObject({
  schemaVersion: z.literal(SETUP_PLAN_AGENT_VIEW_SCHEMA_VERSION),
  readOnly: z.boolean(),
  facts: onboardingFactsSchema,
  plan: onboardingPlanSchema,
});

export const setupPlanAgentViewEventSchema = z.strictObject({
  type: z.literal("result"),
  code: z.literal(SETUP_PLAN_AGENT_VIEW_CODE),
  payload: setupPlanAgentViewPayloadSchema,
});
