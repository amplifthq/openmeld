import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";

export const OPENMELD_REASONING_STREAM_HEADER = "x-openmeld-reasoning-stream";
export const LOCAL_AGENT_REASONING_MAX_CHARS = 8192;
export const localAgentReasoningStateSchema = z.strictObject({
  status: z.enum(["waiting", "streaming", "disabled", "unavailable"]),
  firstOutputMs: z.number().int().nonnegative().optional(),
});
export type LocalAgentReasoningState = z.infer<
  typeof localAgentReasoningStateSchema
>;
export const localAgentReasoningPreferencesSchema = z.strictObject({
  enabled: z.boolean(),
});
export type LocalAgentReasoningPreferences = z.infer<
  typeof localAgentReasoningPreferencesSchema
>;
export const localAgentReasoningPreferencesRpcSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  enabled: z.boolean().optional(),
});
export type LocalAgentReasoningPreferencesRpc = z.infer<
  typeof localAgentReasoningPreferencesRpcSchema
>;
