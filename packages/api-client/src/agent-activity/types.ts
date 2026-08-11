import type {
  AgentActivitySnapshotQuery,
  AgentActivitySnapshotResponse,
  AgentActivityStatsQuery,
  AgentActivityStatsResponse,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type AgentActivityRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ReadAgentActivitySnapshotInput = AgentActivityRequestInput &
  AgentActivitySnapshotQuery;
export type ReadAgentActivityStatsInput = AgentActivityRequestInput &
  AgentActivityStatsQuery;

export type AgentActivityApi = {
  readSnapshot: (
    input?: ReadAgentActivitySnapshotInput
  ) => Promise<AgentActivitySnapshotResponse>;
  readStats: (
    input?: ReadAgentActivityStatsInput
  ) => Promise<AgentActivityStatsResponse>;
};

export type CreateAgentActivityApi = (
  client: OpenMeldApiClientFoundation
) => AgentActivityApi;
