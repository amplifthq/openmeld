import {
  applyOpenMeldRequestContextHeaders,
  decodeOpenMeldHeaderText,
  OPENMELD_EXPECTED_FORWARDED_BY,
  OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID,
  OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID,
  OPENMELD_HEADER_AGENT_CONTROLLER_REF,
  OPENMELD_HEADER_AUTO_RELAY_DEPTH,
  OPENMELD_HEADER_DISPATCH_CHAIN_ID,
  OPENMELD_HEADER_FORWARDED_BY,
  OPENMELD_HEADER_OWNER_NAME,
  OPENMELD_HEADER_OWNER_USER_ID,
  OPENMELD_HEADER_PROFILE_HANDLE,
  OPENMELD_HEADER_PROFILE_ID,
  OPENMELD_HEADER_PROFILE_KIND,
  OPENMELD_HEADER_PROFILE_NAME,
  OPENMELD_HEADER_REQUEST_ID,
  OPENMELD_HEADER_SPACE_PASSWORD,
  OPENMELD_HEADER_VISITED_PROFILE_IDS,
  OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH,
  readOpenMeldRequestContext,
} from "@openmeld/gateway-contract";
import type { Profile, SpaceCreator } from "@openmeld/protocol";
import { normalizeSpacePasswordText } from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";

export {
  OPENMELD_EXPECTED_FORWARDED_BY,
  OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID,
  OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID,
  OPENMELD_HEADER_AGENT_CONTROLLER_REF,
  OPENMELD_HEADER_AUTO_RELAY_DEPTH,
  OPENMELD_HEADER_DISPATCH_CHAIN_ID,
  OPENMELD_HEADER_FORWARDED_BY,
  OPENMELD_HEADER_OWNER_NAME,
  OPENMELD_HEADER_OWNER_USER_ID,
  OPENMELD_HEADER_PROFILE_HANDLE,
  OPENMELD_HEADER_PROFILE_ID,
  OPENMELD_HEADER_PROFILE_KIND,
  OPENMELD_HEADER_PROFILE_NAME,
  OPENMELD_HEADER_REQUEST_ID,
  OPENMELD_HEADER_SPACE_PASSWORD,
  OPENMELD_HEADER_VISITED_PROFILE_IDS,
  OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH,
};

export type ReadResolvedOpenMeldContextResult =
  | {
      ok: true;
      context: OpenMeldRequestContext;
      spacePassword?: string;
    }
  | {
      ok: false;
      requestId: string;
      message: string;
    };

export function readResolvedOpenMeldContext(
  headers: Headers,
  fallbackRequestId: string
): ReadResolvedOpenMeldContextResult {
  const requestId = readRequestId(headers, fallbackRequestId);
  const forwardedBy = normalizeHeaderText(
    headers.get(OPENMELD_HEADER_FORWARDED_BY)
  );
  if (forwardedBy !== OPENMELD_EXPECTED_FORWARDED_BY) {
    return {
      ok: false,
      requestId,
      message: "authentication required",
    };
  }

  const requestContext = readOpenMeldRequestContext(headers, fallbackRequestId);
  if (!requestContext) {
    return {
      ok: false,
      requestId,
      message: "authentication required",
    };
  }

  const spacePassword = readRawSpacePasswordHeader(headers);
  return {
    ok: true,
    context: requestContext,
    ...(spacePassword === undefined ? {} : { spacePassword }),
  };
}

export function applyResolvedOpenMeldContextHeaders(
  target: Headers,
  input: {
    context: OpenMeldRequestContext;
    spacePassword?: string;
  }
): Headers {
  return applyOpenMeldRequestContextHeaders(target, {
    requestContext: input.context,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
  });
}

export function toProtocolProfile(context: OpenMeldRequestContext): Profile {
  const actorContext = context.actorContext;
  return {
    kind: actorContext.profileKind,
    profileId: actorContext.openMeldProfileId,
    ...(actorContext.profileHandle
      ? { profileHandle: actorContext.profileHandle }
      : {}),
    ...(actorContext.profileName
      ? { profileName: actorContext.profileName }
      : {}),
    ...(actorContext.avatarUrl ? { avatarUrl: actorContext.avatarUrl } : {}),
    ...(actorContext.profileKind === "agent" && actorContext.ownerUserId
      ? { owner: actorContext.ownerUserId }
      : {}),
    ...(actorContext.profileKind === "agent" && actorContext.ownerName
      ? { ownerName: actorContext.ownerName }
      : {}),
    ...(actorContext.profileKind === "agent" && actorContext.agentControllerRef
      ? { agentControllerRef: actorContext.agentControllerRef }
      : {}),
    ...(actorContext.profileKind === "agent" &&
    context.agentControllerConversationId
      ? { agentControllerConversationId: context.agentControllerConversationId }
      : {}),
  };
}

export function toSpaceCreator(context: OpenMeldRequestContext): SpaceCreator {
  const actorContext = context.actorContext;
  return {
    profileId: actorContext.openMeldProfileId,
    ...(actorContext.profileName
      ? { profileName: actorContext.profileName }
      : {}),
    kind: actorContext.profileKind,
    ...(actorContext.ownerUserId
      ? { ownerUserId: actorContext.ownerUserId }
      : {}),
    ...(actorContext.ownerName ? { ownerName: actorContext.ownerName } : {}),
  };
}

function readRequestId(headers: Headers, fallbackRequestId: string): string {
  return (
    normalizeHeaderText(headers.get(OPENMELD_HEADER_REQUEST_ID)) ??
    fallbackRequestId
  );
}

function readRawSpacePasswordHeader(headers: Headers): string | undefined {
  const value = headers.get(OPENMELD_HEADER_SPACE_PASSWORD);
  if (value === null) {
    return undefined;
  }
  const spacePassword = normalizeSpacePasswordText(
    decodeOpenMeldHeaderText(value.trim())
  );
  return spacePassword.length > 0 ? spacePassword : undefined;
}

function normalizeHeaderText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
