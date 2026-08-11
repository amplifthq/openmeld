import {
  openMeldActorContextSchema,
  openMeldProfileIdSchema,
  openMeldRequestContextSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldActorContext,
  OpenMeldRequestContext,
  ResolvedOpenMeldProfile,
} from "@openmeld/schemas/types";
import type { GatewayIngressForwardingContext } from "./ingress-forwarding-context";

export function buildGatewayActorContext(input: {
  callerPrincipalId?: string;
  ingressContext: GatewayIngressForwardingContext;
  requestId: string;
  resolvedProfile: ResolvedOpenMeldProfile;
}): OpenMeldActorContext {
  const visitedProfileIds = parseCanonicalVisitedProfileIds(
    input.ingressContext.visitedProfileIds
  );
  const visitedProfileIdsHash = resolveCanonicalVisitedProfileIdsHash({
    originalVisitedProfileIds: input.ingressContext.visitedProfileIds,
    canonicalVisitedProfileIds: visitedProfileIds,
    visitedProfileIdsHash: input.ingressContext.visitedProfileIdsHash,
  });

  const parsed = openMeldActorContextSchema.safeParse({
    requestId: input.requestId,
    ...(input.callerPrincipalId
      ? { callerPrincipalId: input.callerPrincipalId }
      : {}),
    openMeldProfileId: input.resolvedProfile.openMeldProfileId,
    profileKind: input.resolvedProfile.profileKind,
    ...(input.resolvedProfile.profileHandle
      ? { profileHandle: input.resolvedProfile.profileHandle }
      : {}),
    profileName: input.resolvedProfile.profileName,
    ownerUserId: input.resolvedProfile.ownerUserId,
    ...(input.resolvedProfile.ownerName
      ? { ownerName: input.resolvedProfile.ownerName }
      : {}),
    ...(input.resolvedProfile.avatarUrl
      ? { avatarUrl: input.resolvedProfile.avatarUrl }
      : {}),
    ...(input.resolvedProfile.agentControllerRef
      ? { agentControllerRef: input.resolvedProfile.agentControllerRef }
      : {}),
    ...(input.ingressContext.dispatchChainId
      ? { dispatchChainId: input.ingressContext.dispatchChainId }
      : {}),
    ...(typeof input.ingressContext.autoRelayDepth === "number"
      ? { autoRelayDepth: input.ingressContext.autoRelayDepth }
      : {}),
    ...(visitedProfileIds ? { visitedProfileIds } : {}),
    ...(visitedProfileIdsHash ? { visitedProfileIdsHash } : {}),
  });
  if (!parsed.success) {
    throw new TypeError(
      "gateway actor context must satisfy openMeldActorContextSchema before leaving the canonical boundary"
    );
  }
  return parsed.data;
}

export function buildOpenMeldRequestContext(input: {
  activeOrganizationId?: string;
  callerPrincipalId?: string;
  ingressContext: GatewayIngressForwardingContext;
  requestId: string;
  resolvedProfile: ResolvedOpenMeldProfile;
}): OpenMeldRequestContext {
  const parsed = openMeldRequestContextSchema.safeParse({
    actorContext: buildGatewayActorContext(input),
    ...(input.activeOrganizationId
      ? { activeOrganizationId: input.activeOrganizationId }
      : {}),
    ...(input.ingressContext.agentControllerConversationId
      ? {
          agentControllerConversationId:
            input.ingressContext.agentControllerConversationId,
        }
      : {}),
  });
  if (!parsed.success) {
    throw new TypeError(
      "gateway request context must satisfy openMeldRequestContextSchema after authentication"
    );
  }
  return parsed.data;
}

function parseCanonicalVisitedProfileIds(
  visitedProfileIds: GatewayIngressForwardingContext["visitedProfileIds"]
): OpenMeldActorContext["visitedProfileIds"] | undefined {
  if (!visitedProfileIds?.length) {
    return undefined;
  }
  for (const profileId of visitedProfileIds) {
    if (!openMeldProfileIdSchema.safeParse(profileId).success) {
      return undefined;
    }
  }
  return visitedProfileIds;
}

function resolveCanonicalVisitedProfileIdsHash(input: {
  originalVisitedProfileIds: GatewayIngressForwardingContext["visitedProfileIds"];
  canonicalVisitedProfileIds:
    | OpenMeldActorContext["visitedProfileIds"]
    | undefined;
  visitedProfileIdsHash: GatewayIngressForwardingContext["visitedProfileIdsHash"];
}): OpenMeldActorContext["visitedProfileIdsHash"] | undefined {
  if (!input.visitedProfileIdsHash) {
    return undefined;
  }
  if (
    input.originalVisitedProfileIds?.length &&
    input.canonicalVisitedProfileIds === undefined
  ) {
    return undefined;
  }
  return input.visitedProfileIdsHash;
}
