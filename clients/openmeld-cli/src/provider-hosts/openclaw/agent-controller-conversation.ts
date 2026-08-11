import {
  normalizeOpenClawSpaceIdPrefix,
  slugifyOpenClawNamePart,
} from "./naming";

const OPENCLAW_SPACE_SESSION_KEY_RE =
  /^agent:(?<agentId>[a-z0-9-]+):openmeld-space:(?<spaceSlug>[a-z0-9-]+)--(?<spaceIdPrefix>[a-z0-9]{8})$/u;

export type OpenClawAgentControllerConversationClassification =
  | "missing"
  | "canonical_owned"
  | "legacy"
  | "foreign";

export type ParsedOpenClawSpaceSessionKey = {
  agentId: string;
  spaceIdPrefix: string;
  spaceSlug: string;
};

export function parseOpenClawSpaceSessionKey(
  value: string
): ParsedOpenClawSpaceSessionKey | null {
  const match = OPENCLAW_SPACE_SESSION_KEY_RE.exec(String(value ?? "").trim());
  if (!match?.groups) {
    return null;
  }
  const agentId = normalizeOptionalText(match.groups.agentId);
  const spaceIdPrefix = normalizeOptionalText(match.groups.spaceIdPrefix);
  const spaceSlug = normalizeOptionalText(match.groups.spaceSlug);
  if (!(agentId && spaceIdPrefix && spaceSlug)) {
    return null;
  }
  return {
    agentId,
    spaceIdPrefix,
    spaceSlug,
  };
}

export function matchesOwnedOpenClawSpaceSessionKey(input: {
  openClawBootstrapAgentId: string | null;
  sessionKey: string;
  spaceId: string;
}): boolean {
  const parsed = parseOpenClawSpaceSessionKey(input.sessionKey);
  if (!parsed) {
    return false;
  }
  const normalizedAgentId = normalizeOptionalText(
    input.openClawBootstrapAgentId
  );
  if (!normalizedAgentId) {
    return false;
  }
  return (
    parsed.agentId === slugifyOpenClawNamePart(normalizedAgentId, "agent") &&
    parsed.spaceIdPrefix === normalizeOpenClawSpaceIdPrefix(input.spaceId)
  );
}

export function classifyOpenClawAgentControllerConversation(input: {
  agentControllerConversationId: string | null;
  openClawBootstrapAgentId: string | null;
  spaceId: string;
}): OpenClawAgentControllerConversationClassification {
  const agentControllerConversationId = normalizeOptionalText(
    input.agentControllerConversationId
  );
  if (!agentControllerConversationId) {
    return "missing";
  }
  return matchesOwnedOpenClawSpaceSessionKey({
    openClawBootstrapAgentId: input.openClawBootstrapAgentId,
    sessionKey: agentControllerConversationId,
    spaceId: input.spaceId,
  })
    ? "canonical_owned"
    : "legacy";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
