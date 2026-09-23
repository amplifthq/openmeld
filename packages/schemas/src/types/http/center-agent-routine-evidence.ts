import type { z } from "zod/v4";

type Schemas =
  typeof import("../../schemas/http/center-agent-routine-evidence");
export type CenterAgentListRoutineRunsToolRpcInput = z.infer<
  Schemas["centerAgentListRoutineRunsToolRpcInputSchema"]
>;
export type CenterAgentListRoutineRunsToolResponse = z.infer<
  Schemas["centerAgentListRoutineRunsToolResponseSchema"]
>;
export type CenterAgentReadRoutineRunDiagnosticsRpcInput = z.infer<
  Schemas["centerAgentReadRoutineRunDiagnosticsRpcInputSchema"]
>;
export type CenterAgentReadRoutineRunDiagnosticsResponse = z.infer<
  Schemas["centerAgentReadRoutineRunDiagnosticsResponseSchema"]
>;
export type CenterAgentRoutineRunEvidence = z.infer<
  Schemas["centerAgentRoutineRunEvidenceSchema"]
>;
