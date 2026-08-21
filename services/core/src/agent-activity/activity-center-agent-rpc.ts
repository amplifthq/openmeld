import {
  centerAgentListAgentActivitySessionsToolRpcInputSchema,
  centerAgentReadAgentActivityToolRpcInputSchema,
} from "@openmeld/schemas";
import type {
  AgentActivitySessionInventoryResponse,
  AgentActivitySnapshotResponse,
  CenterAgentListAgentActivitySessionsToolRpcInput,
  CenterAgentReadAgentActivityToolRpcInput,
} from "@openmeld/schemas/types";
import { prepareCenterAgentOrganizationMemberRequest } from "../center-agent/application/anonymous-member-request";
import { agentActivityDb, type CoreBindings } from "../lib/bindings";
import { createProjectService } from "../projects/project-service";
import { createCoreRpcHttpError } from "../rpc/errors";
import { readAgentActivitySessionInventory } from "./activity-session-inventory-repository";
import { readAgentActivitySnapshotForAuthority } from "./activity-snapshot-rpc";

export async function rpcCenterAgentReadAgentActivity(
  env: CoreBindings,
  input: CenterAgentReadAgentActivityToolRpcInput
): Promise<AgentActivitySnapshotResponse> {
  const parsed =
    centerAgentReadAgentActivityToolRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Center Agent Activity request is invalid.",
      status: 400,
    });
  }
  const { context, speakerMember, ...query } = parsed.data;
  const prepared = await prepareCenterAgentOrganizationMemberRequest(
    env,
    context,
    speakerMember
  );
  const db = agentActivityDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "agent_activity.store_unavailable",
      reason: "Agent Activity storage is unavailable.",
      status: 503,
    });
  }
  const sourceNativeDeliveryId = prepared.member.sourceNativeDeliveryId;
  if (!(prepared.member.userId || sourceNativeDeliveryId)) {
    throw createCoreRpcHttpError({
      code: "agent_activity.member_actor_required",
      reason: "An active Organization member is required.",
      status: 403,
    });
  }
  return await readAgentActivitySnapshotForAuthority({
    authority: {
      organizationId: prepared.authorization.activeOrganization.organizationId,
      role: prepared.member.role,
      userId: prepared.member.userId,
    },
    env,
    query,
    service: createProjectService({ db }),
  });
}

export async function rpcCenterAgentListAgentActivitySessions(
  env: CoreBindings,
  input: CenterAgentListAgentActivitySessionsToolRpcInput
): Promise<AgentActivitySessionInventoryResponse> {
  const parsed =
    centerAgentListAgentActivitySessionsToolRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Center Agent Session Inventory request is invalid.",
      status: 400,
    });
  }
  const { context, speakerMember, ...query } = parsed.data;
  const prepared = await prepareCenterAgentOrganizationMemberRequest(
    env,
    context,
    speakerMember
  );
  const db = agentActivityDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "agent_activity.store_unavailable",
      reason: "Agent Activity storage is unavailable.",
      status: 503,
    });
  }
  const sourceNativeDeliveryId = prepared.member.sourceNativeDeliveryId;
  if (!(prepared.member.userId || sourceNativeDeliveryId)) {
    throw createCoreRpcHttpError({
      code: "agent_activity.member_actor_required",
      reason: "An active Organization member is required.",
      status: 403,
    });
  }
  try {
    return await readAgentActivitySessionInventory({
      db,
      nowMs: Date.now(),
      organizationId: prepared.authorization.activeOrganization.organizationId,
      query,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("cursor is invalid")) {
      throw createCoreRpcHttpError({
        code: "invalid_payload",
        reason: error.message,
        status: 400,
      });
    }
    throw error;
  }
}
