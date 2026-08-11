import {
  decodeOpenMeldHeaderText,
  OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID,
  OPENMELD_HEADER_AUTO_RELAY_DEPTH,
  OPENMELD_HEADER_DISPATCH_CHAIN_ID,
  OPENMELD_HEADER_REQUEST_ID,
  OPENMELD_HEADER_VISITED_PROFILE_IDS,
  OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH,
} from "@openmeld/gateway-contract";
import type { OpenMeldActorContext } from "@openmeld/schemas/types";

export type GatewayIngressForwardingContext = {
  requestId: string;
  agentControllerConversationId?: string;
  dispatchChainId?: OpenMeldActorContext["dispatchChainId"];
  autoRelayDepth?: OpenMeldActorContext["autoRelayDepth"];
  visitedProfileIds?: OpenMeldActorContext["visitedProfileIds"];
  visitedProfileIdsHash?: OpenMeldActorContext["visitedProfileIdsHash"];
};

export function readGatewayIngressForwardingContext(
  headers: Headers,
  fallbackRequestId: string
): GatewayIngressForwardingContext {
  const requestId =
    normalizeOptionalHeaderText(headers.get(OPENMELD_HEADER_REQUEST_ID)) ??
    fallbackRequestId;
  const agentControllerConversationId = normalizeOptionalHeaderText(
    headers.get(OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID)
  );
  const dispatchChainId = normalizeOptionalHeaderText(
    headers.get(OPENMELD_HEADER_DISPATCH_CHAIN_ID)
  );
  const autoRelayDepth = parseOptionalNonNegativeIntHeader(
    headers.get(OPENMELD_HEADER_AUTO_RELAY_DEPTH)
  );
  const visitedProfileIds = parseOptionalHeaderList(
    headers.get(OPENMELD_HEADER_VISITED_PROFILE_IDS)
  );
  const visitedProfileIdsHash = normalizeOptionalHeaderText(
    headers.get(OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH)
  );

  return {
    requestId,
    ...(agentControllerConversationId ? { agentControllerConversationId } : {}),
    ...(dispatchChainId ? { dispatchChainId } : {}),
    ...(typeof autoRelayDepth === "number" ? { autoRelayDepth } : {}),
    ...(visitedProfileIds.length > 0 ? { visitedProfileIds } : {}),
    ...(visitedProfileIdsHash ? { visitedProfileIdsHash } : {}),
  };
}

function parseOptionalNonNegativeIntHeader(
  value: string | null
): number | null {
  const normalized = normalizeOptionalHeaderText(value);
  if (!normalized) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseOptionalHeaderList(value: string | null): string[] {
  const normalized = normalizeOptionalHeaderText(value);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(",")
    .map((entry) => normalizeOptionalHeaderText(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeOptionalHeaderText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  if (normalized.length === 0) {
    return null;
  }
  const decoded = decodeOpenMeldHeaderText(normalized).trim();
  return decoded.length > 0 ? decoded : null;
}
