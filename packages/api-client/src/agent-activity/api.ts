import {
  agentActivitySessionInventoryQuerySchema,
  agentActivitySessionInventoryResponseSchema,
  agentActivitySnapshotQuerySchema,
  agentActivitySnapshotResponseSchema,
  agentActivityStatsQuerySchema,
  agentActivityStatsResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildAgentActivitySessionsPath,
  buildAgentActivitySnapshotPath,
  buildAgentActivityStatsPath,
} from "./routes";
import type {
  AgentActivityRequestInput,
  CreateAgentActivityApi,
} from "./types";

export const createAgentActivityApi: CreateAgentActivityApi = (
  client: OpenMeldApiClientFoundation
) => ({
  readSessions: async (input = {}) => {
    const query = requireValidInput(
      agentActivitySessionInventoryQuerySchema,
      {
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.memberUserId === undefined
          ? {}
          : { memberUserId: input.memberUserId }),
        ...(input.nativeSessionId === undefined
          ? {}
          : { nativeSessionId: input.nativeSessionId }),
        ...(input.origin === undefined ? {} : { origin: input.origin }),
        ...(input.projectId === undefined
          ? {}
          : { projectId: input.projectId }),
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.status === undefined ? {} : { status: input.status }),
      },
      "Agent Activity Session Inventory request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Agent Activity Session Inventory response",
      method: "GET",
      operation: "agent_activity.sessions.read",
      schema: agentActivitySessionInventoryResponseSchema,
      url: buildAgentActivitySessionsPath(query),
    });
  },
  readSnapshot: async (input = {}) => {
    const query = requireValidInput(
      agentActivitySnapshotQuerySchema,
      {
        ...(input.includeProviderMetadata === true
          ? { includeProviderMetadata: true }
          : {}),
        ...(input.memberUserId === undefined
          ? {}
          : { memberUserId: input.memberUserId }),
        ...(input.projectId === undefined
          ? {}
          : { projectId: input.projectId }),
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.status === undefined ? {} : { status: input.status }),
      },
      "Agent Activity snapshot request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Agent Activity snapshot response",
      method: "GET",
      operation: "agent_activity.snapshot.read",
      schema: agentActivitySnapshotResponseSchema,
      url: buildAgentActivitySnapshotPath(query),
    });
  },
  readStats: async (input = {}) => {
    const query = requireValidInput(
      agentActivityStatsQuerySchema,
      {
        ...(input.projectId === undefined
          ? {}
          : { projectId: input.projectId }),
      },
      "Agent Activity stats request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Agent Activity stats response",
      method: "GET",
      operation: "agent_activity.stats.read",
      schema: agentActivityStatsResponseSchema,
      url: buildAgentActivityStatsPath(query),
    });
  },
});

function requestOptions(input: AgentActivityRequestInput): {
  requestContext?: AgentActivityRequestInput["requestContext"];
  signal?: AbortSignal;
  timeoutMs?: number;
} {
  return {
    ...(input.requestContext === undefined
      ? {}
      : { requestContext: input.requestContext }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

function requireValidInput<T>(
  schema: {
    safeParse(
      value: unknown
    ):
      | { data: T; success: true }
      | { error: { issues: Array<{ message: string }> }; success: false };
  },
  value: unknown,
  message: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${message} ${parsed.error.issues[0]?.message ?? "Invalid input."}`
    );
  }
  return parsed.data;
}
