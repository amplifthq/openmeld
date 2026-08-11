import type { CenterAgentInteractionSource } from "@openmeld/schemas/types";
import { insertCenterAgentAuditJournalEntryIfMissing } from "../center-agent-repository";

export async function recordCenterAgentLocalAgentRequest(input: {
  actorProfileId: string;
  db: D1Database;
  deliveryId: string;
  nowMs: number;
  organizationId: string;
  representedMember: {
    displayName: string;
    profileId: string;
    userId: string;
  };
  source: CenterAgentInteractionSource;
}): Promise<void> {
  await insertCenterAgentAuditJournalEntryIfMissing({
    action: "receive_local_agent_request",
    actorProfileId: input.actorProfileId,
    attribution: {
      actorProfileId: input.actorProfileId,
      onBehalfOf: {
        displayName: input.representedMember.displayName,
        profileId: input.representedMember.profileId,
        userId: input.representedMember.userId,
      },
    },
    db: input.db,
    id: `local-agent-request:${input.deliveryId}`,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    resource: {
      id: input.source.client,
      type: "local_agent_client",
    },
    sourceNativeDeliveryId: input.deliveryId,
  });
}
