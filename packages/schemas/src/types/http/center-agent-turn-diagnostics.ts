import type { z } from "zod/v4";

type CenterAgentReadTurnDiagnosticsRpcInputSchema =
  typeof import("../../schemas/http/center-agent-turn-diagnostics")["centerAgentReadTurnDiagnosticsRpcInputSchema"];
type CenterAgentReadTurnDiagnosticsResponseSchema =
  typeof import("../../schemas/http/center-agent-turn-diagnostics")["centerAgentReadTurnDiagnosticsResponseSchema"];
type CenterAgentTurnDiagnosticSchema =
  typeof import("../../schemas/http/center-agent-turn-diagnostics")["centerAgentTurnDiagnosticSchema"];
type CenterAgentTurnDiagnosticPublicationStateSchema =
  typeof import("../../schemas/http/center-agent-turn-diagnostics")["centerAgentTurnDiagnosticPublicationStateSchema"];
type CenterAgentTurnDiagnosticStatusSchema =
  typeof import("../../schemas/http/center-agent-turn-diagnostics")["centerAgentTurnDiagnosticStatusSchema"];

export type CenterAgentReadTurnDiagnosticsRpcInput =
  z.infer<CenterAgentReadTurnDiagnosticsRpcInputSchema>;
export type CenterAgentReadTurnDiagnosticsResponse =
  z.infer<CenterAgentReadTurnDiagnosticsResponseSchema>;
export type CenterAgentTurnDiagnostic =
  z.infer<CenterAgentTurnDiagnosticSchema>;
export type CenterAgentTurnDiagnosticPublicationState =
  z.infer<CenterAgentTurnDiagnosticPublicationStateSchema>;
export type CenterAgentTurnDiagnosticStatus =
  z.infer<CenterAgentTurnDiagnosticStatusSchema>;
