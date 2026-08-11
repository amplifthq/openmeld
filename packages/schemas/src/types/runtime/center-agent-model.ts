import type { z } from "zod/v4";

type CenterAgentModelChoiceSchema =
  typeof import("../../schemas/runtime/center-agent-model")["centerAgentModelChoiceSchema"];
type CenterAgentModelPreferenceSchema =
  typeof import("../../schemas/runtime/center-agent-model")["centerAgentModelPreferenceSchema"];
type CenterAgentModelRouteSchema =
  typeof import("../../schemas/runtime/center-agent-model")["centerAgentModelRouteSchema"];
type CenterAgentModelSummarySchema =
  typeof import("../../schemas/runtime/center-agent-model")["centerAgentModelSummarySchema"];

export type CenterAgentModelChoice = z.infer<CenterAgentModelChoiceSchema>;
export type CenterAgentModelPreference =
  z.infer<CenterAgentModelPreferenceSchema>;
export type CenterAgentModelRoute = z.infer<CenterAgentModelRouteSchema>;
export type CenterAgentModelSummary = z.infer<CenterAgentModelSummarySchema>;
