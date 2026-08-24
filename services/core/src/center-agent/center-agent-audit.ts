import type {
  CenterAgentAction,
  CenterAgentAttribution,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  insertCenterAgentAuditJournalEntry,
  resolveCenterAgentAttribution,
} from "./center-agent-repository";
import type { CurrentDesignatedCenterAgentAuthorization } from "./current-designated-center-agent";

export async function writeCenterAgentAuditEntry(input: {
  action: CenterAgentAction;
  authorization: CurrentDesignatedCenterAgentAuthorization;
  onBehalfOfProfileId: string | null;
  resource: { id: string; type: string } | null;
  sourceNativeDeliveryId?: string | null;
  sourceSpaceId?: string | null;
}): Promise<CenterAgentAttribution> {
  const attribution = await resolveCenterAgentAuditAttribution({
    authorization: input.authorization,
    onBehalfOfProfileId: input.onBehalfOfProfileId,
  });
  await insertCenterAgentAuditJournalEntry({
    action: input.action,
    actorProfileId: input.authorization.actorProfileId,
    attribution,
    db: input.authorization.db,
    id: crypto.randomUUID(),
    nowMs: Date.now(),
    organizationId: input.authorization.activeOrganization.organizationId,
    resource: input.resource,
    sourceNativeDeliveryId: input.sourceNativeDeliveryId,
    sourceSpaceId: input.sourceSpaceId ?? null,
  });
  return attribution;
}

export async function resolveCenterAgentAuditAttribution(input: {
  authorization: CurrentDesignatedCenterAgentAuthorization;
  onBehalfOfProfileId: string | null;
}): Promise<CenterAgentAttribution> {
  return await resolveCenterAgentAttribution({
    actorProfileId: input.authorization.actorProfileId,
    db: input.authorization.db,
    onBehalfOfProfileId: input.onBehalfOfProfileId,
    organizationId: input.authorization.activeOrganization.organizationId,
  }).catch((error) => {
    throw createCoreRpcHttpError({
      status: 400,
      reason: error instanceof Error ? error.message : "Invalid attribution.",
      code: "invalid_payload",
    });
  });
}
