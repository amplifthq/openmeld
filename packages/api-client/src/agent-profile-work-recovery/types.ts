import type {
  AgentProfileWorkRecoveryRouteParams,
  ExecuteAgentProfileWorkRecoveryBody,
  ExecuteAgentProfileWorkRecoveryResponse,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type ExecuteAgentProfileWorkRecoveryInput =
  AgentProfileWorkRecoveryRouteParams &
    ExecuteAgentProfileWorkRecoveryBody & {
      requestContext?: OpenMeldRequestContext;
    };

export type CreateAgentProfileWorkRecoveryApi = (
  client: OpenMeldApiClientFoundation
) => {
  execute: (
    input: ExecuteAgentProfileWorkRecoveryInput
  ) => Promise<ExecuteAgentProfileWorkRecoveryResponse>;
};
