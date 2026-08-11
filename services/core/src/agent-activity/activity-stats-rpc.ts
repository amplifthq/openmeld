import {
  agentActivityStatsResponseSchema,
  agentActivityStatsRpcInputSchema,
} from "@openmeld/schemas";
import type {
  AgentActivityStatsResponse,
  AgentActivityStatsRpcInput,
} from "@openmeld/schemas/types";
import { agentActivityDb, type CoreBindings } from "../lib/bindings";
import { prepareHumanProjectRequest } from "../projects/project-request-preparation";
import { createCoreRpcHttpError } from "../rpc/errors";
import { readAgentActivityStats } from "./activity-stats-repository";

export async function rpcReadAgentActivityStats(
  env: CoreBindings,
  input: AgentActivityStatsRpcInput
): Promise<AgentActivityStatsResponse> {
  const parsed = agentActivityStatsRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Agent Activity stats request is invalid.",
      status: 400,
    });
  }
  const { authority } = await prepareHumanProjectRequest(
    env,
    parsed.data.context
  );
  const db = agentActivityDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "agent_activity.store_unavailable",
      reason: "Agent Activity storage is unavailable.",
      status: 503,
    });
  }
  const response = agentActivityStatsResponseSchema.safeParse(
    await readAgentActivityStats({
      db,
      organizationId: authority.organizationId,
      ...(parsed.data.projectId === undefined
        ? {}
        : { projectId: parsed.data.projectId }),
    })
  );
  if (!response.success) {
    throw new Error("Failed to build valid Agent Activity stats.", {
      cause: response.error,
    });
  }
  return response.data;
}
