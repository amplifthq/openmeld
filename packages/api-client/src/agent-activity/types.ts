import type {
  AgentActivitySessionInventoryQuery,
  AgentActivitySessionInventoryResponse,
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
export type ReadAgentActivitySessionsInput = AgentActivityRequestInput &
  Omit<AgentActivitySessionInventoryQuery, "limit"> & {
    limit?: AgentActivitySessionInventoryQuery["limit"];
  };
export type ReadAgentActivityStatsInput = AgentActivityRequestInput &
  AgentActivityStatsQuery;

export type AgentActivityApi = {
  readSessions: (
    input?: ReadAgentActivitySessionsInput
  ) => Promise<AgentActivitySessionInventoryResponse>;
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
