import crypto from "node:crypto";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import type { OpenMeldProfile } from "./openmeld-profiles-api";

export type OpenMeldRequestContextProfileIdentity = {
  openMeldProfileId: string;
  profileKind?: "human" | "agent" | "system";
  kind?: "human" | "agent";
  profileHandle?: string;
  profileName: string;
  ownerUserId?: string;
  ownerName?: string;
  agentControllerConversationId?: string;
};

export function buildOpenMeldRequestContextFromProfile(input: {
  openMeldProfile: OpenMeldProfile;
  requestId?: string;
  agentControllerConversationId?: string;
}): OpenMeldRequestContext {
  const requestId =
    normalizeOptionalText(input.requestId) ?? crypto.randomUUID();
  const agentControllerConversationId = normalizeOptionalText(
    input.agentControllerConversationId
  );
  const ownerName = normalizeOptionalText(input.openMeldProfile.ownerName);

  return {
    actorContext: {
      requestId,
      openMeldProfileId: input.openMeldProfile.openMeldProfileId,
      profileKind: input.openMeldProfile.profileKind,
      profileHandle: input.openMeldProfile.profileHandle,
      profileName: input.openMeldProfile.profileName,
      ownerUserId: input.openMeldProfile.ownerUserId,
      ...(ownerName ? { ownerName } : {}),
    },
    ...(agentControllerConversationId ? { agentControllerConversationId } : {}),
  };
}

export function buildOpenMeldRequestContextFromProfileIdentity(input: {
  profileIdentity: OpenMeldRequestContextProfileIdentity;
  requestId?: string;
}): OpenMeldRequestContext {
  const requestId =
    normalizeOptionalText(input.requestId) ?? crypto.randomUUID();
  const profileHandle = normalizeOptionalText(
    input.profileIdentity.profileHandle
  );
  const ownerUserId = normalizeOptionalText(input.profileIdentity.ownerUserId);
  const ownerName = normalizeOptionalText(input.profileIdentity.ownerName);
  const agentControllerConversationId = normalizeOptionalText(
    input.profileIdentity.agentControllerConversationId
  );
  const profileKind =
    input.profileIdentity.profileKind ??
    (input.profileIdentity.kind === "human" ||
    input.profileIdentity.kind === "agent"
      ? input.profileIdentity.kind
      : "system");

  return {
    actorContext: {
      requestId,
      openMeldProfileId: input.profileIdentity.openMeldProfileId,
      profileKind,
      ...(profileHandle ? { profileHandle } : {}),
      profileName: input.profileIdentity.profileName,
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(ownerName ? { ownerName } : {}),
    },
    ...(agentControllerConversationId ? { agentControllerConversationId } : {}),
  };
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
