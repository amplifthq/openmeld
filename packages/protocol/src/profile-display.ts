import type { Profile } from "./types";

export type ProfileDisplayInput = {
  openMeldProfileId?: string;
  profileId?: string;
  profileName?: string | null;
  profileKind: "human" | "agent" | "system";
  ownerUserId?: string | null;
  ownerName?: string | null;
  agentControllerRef?: string | null;
  agentControllerConversationId?: string | null;
};

export function buildProfileDisplay(input: ProfileDisplayInput): Profile {
  const profileId = normalizeOptionalText(
    input.openMeldProfileId ?? input.profileId
  );
  if (!profileId) {
    throw new TypeError("profile display requires openMeldProfileId");
  }

  const profileName = normalizeOptionalText(input.profileName);
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  const ownerName = normalizeOptionalText(input.ownerName);
  const agentControllerRef = resolveAgentControllerRef(input);
  const agentControllerConversationId = normalizeOptionalText(
    input.agentControllerConversationId
  );

  return {
    kind: input.profileKind,
    profileId,
    ...(profileName ? { profileName } : {}),
    ...(input.profileKind === "agent" && ownerUserId
      ? { owner: ownerUserId }
      : {}),
    ...(input.profileKind === "agent" && ownerName ? { ownerName } : {}),
    ...(input.profileKind === "agent" && agentControllerRef
      ? { agentControllerRef }
      : {}),
    ...(input.profileKind === "agent" && agentControllerConversationId
      ? { agentControllerConversationId }
      : {}),
  };
}

function resolveAgentControllerRef(input: ProfileDisplayInput): string | null {
  return normalizeOptionalText(input.agentControllerRef);
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
