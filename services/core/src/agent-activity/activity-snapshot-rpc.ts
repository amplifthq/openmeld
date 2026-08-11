import {
  agentActivitySnapshotResponseSchema,
  agentActivitySnapshotRpcInputSchema,
} from "@openmeld/schemas";
import type {
  AgentActivitySnapshotQuery,
  AgentActivitySnapshotResponse,
  AgentActivitySnapshotRpcInput,
} from "@openmeld/schemas/types";
import { agentActivityDb, type CoreBindings } from "../lib/bindings";
import type { ProjectReadAuthority } from "../projects/project-authority";
import { prepareHumanProjectRequest } from "../projects/project-request-preparation";
import type { createProjectService } from "../projects/project-service";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  AGENT_ACTIVITY_STALENESS_THRESHOLD_MS,
  readAgentActivityPublicDigests,
  readAgentActivityPublicEvents,
  readAgentActivityPublicSessions,
} from "./activity-snapshot-repository";

export async function rpcReadAgentActivitySnapshot(
  env: CoreBindings,
  input: AgentActivitySnapshotRpcInput
): Promise<AgentActivitySnapshotResponse> {
  const parsed = agentActivitySnapshotRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Agent Activity snapshot request is invalid.",
      status: 400,
    });
  }
  const { context, ...query } = parsed.data;
  const { authority, service } = await prepareHumanProjectRequest(env, context);
  return await readAgentActivitySnapshotForAuthority({
    authority,
    env,
    query,
    service,
  });
}

export async function readAgentActivitySnapshotForAuthority(input: {
  authority: ProjectReadAuthority;
  env: CoreBindings;
  query: AgentActivitySnapshotQuery;
  service: ReturnType<typeof createProjectService>;
}): Promise<AgentActivitySnapshotResponse> {
  const projectsResponse = await input.service.listForActivitySnapshot(
    input.authority
  );
  const nowMs = Date.now();
  const db = agentActivityDb(input.env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "agent_activity.store_unavailable",
      reason: "Agent Activity storage is unavailable.",
      status: 503,
    });
  }
  const [digestResult, recentEvents, sessionResult] = await Promise.all([
    readAgentActivityPublicDigests({
      db,
      organizationId: input.authority.organizationId,
      query: input.query,
    }),
    readAgentActivityPublicEvents({
      db,
      organizationId: input.authority.organizationId,
      query: input.query,
    }),
    readAgentActivityPublicSessions({
      db,
      nowMs,
      organizationId: input.authority.organizationId,
      query: input.query,
    }),
  ]);
  const response = agentActivitySnapshotResponseSchema.safeParse({
    asOfMs: nowMs,
    digests: digestResult.digests,
    digestsTruncated: digestResult.truncated,
    organizationId: input.authority.organizationId,
    projects: projectsResponse.projects,
    recentEvents,
    sessions: sessionResult.sessions,
    sessionsTruncated: sessionResult.truncated,
    stalenessThresholdMs: AGENT_ACTIVITY_STALENESS_THRESHOLD_MS,
  });
  if (!response.success) {
    throw new Error("Failed to build a valid Agent Activity snapshot.");
  }
  return response.data;
}
