import type { OpenMeldRequestContext } from "@openmeld/schemas/types";

export type MessageChannelIdentityLinkAuditRecord = {
  action:
    | "disconnect_message_channel_identity_link"
    | "replace_message_channel_identity_link";
  actorProfileId: string;
  createdAtMs: number;
  id: string;
  organizationId: string;
  resourceId: string;
};

export function buildMessageChannelIdentityReplacementAuditRecord(input: {
  context: OpenMeldRequestContext;
  nowMs: number;
  organizationId: string;
  resourceId: string;
}): MessageChannelIdentityLinkAuditRecord {
  return {
    action: "replace_message_channel_identity_link",
    actorProfileId: requireActorProfileId(input.context),
    createdAtMs: input.nowMs,
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    resourceId: input.resourceId,
  };
}

export function buildMessageChannelIdentityDisconnectAuditRecord(input: {
  context: OpenMeldRequestContext;
  nowMs: number;
  organizationId: string;
  resourceId: string;
}): MessageChannelIdentityLinkAuditRecord {
  return {
    action: "disconnect_message_channel_identity_link",
    actorProfileId: requireActorProfileId(input.context),
    createdAtMs: input.nowMs,
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    resourceId: input.resourceId,
  };
}

function requireActorProfileId(context: OpenMeldRequestContext): string {
  const profileId = context.actorContext.openMeldProfileId?.trim();
  if (!profileId) {
    throw new Error(
      "Message Channel identity-link mutation requires an actor profile for audit"
    );
  }
  return profileId;
}
