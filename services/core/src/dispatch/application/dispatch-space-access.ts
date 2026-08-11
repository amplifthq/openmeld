import { normalizeSpacePasswordText } from "@openmeld/schemas";
import type {
  OpenMeldDaemonDispatchQueueMessage,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import {
  createDispatchContinuationSpaceAccessContext,
  type SpaceAccessContext,
} from "@openmeld/space";
import {
  DISPATCH_HINT_SYSTEM_PROFILE_ID,
  DISPATCH_HINT_SYSTEM_PROFILE_NAME,
} from "../rules/dispatch-hint-policy";

export function buildDispatchContinuationSpaceAccess(input: {
  attemptId?: string | null;
  message: OpenMeldDaemonDispatchQueueMessage;
  requestContext: OpenMeldRequestContext;
}): SpaceAccessContext {
  return createDispatchContinuationSpaceAccessContext({
    attemptId: input.attemptId,
    dispatchId: input.message.dispatchId,
    password: input.message.spacePassword,
    requestContext: input.requestContext,
    sourceSignalId: input.message.sourceEventId,
    spaceId: input.message.spaceId,
    targetProfileId: input.message.targetProfileId,
  });
}

export function buildDispatchSystemSpaceAccess(input: {
  message: OpenMeldDaemonDispatchQueueMessage;
  requestIdPrefix: string;
}): SpaceAccessContext {
  return buildDispatchContinuationSpaceAccess({
    message: input.message,
    requestContext: buildDispatchSystemRequestContext(input),
  });
}

export function buildDispatchSystemRequestContext(input: {
  message: OpenMeldDaemonDispatchQueueMessage;
  requestIdPrefix: string;
}): OpenMeldRequestContext {
  return {
    actorContext: {
      requestId: `${input.requestIdPrefix}-${input.message.dispatchId}`,
      openMeldProfileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
      profileKind: "system",
      profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
      dispatchChainId: input.message.dispatchChainId,
      autoRelayDepth: input.message.autoRelayDepth,
      visitedProfileIds: input.message.visitedProfileIds,
      visitedProfileIdsHash: input.message.visitedProfileIdsHash,
    },
  };
}

export function isDispatchMessageProtectedSpace(
  message: OpenMeldDaemonDispatchQueueMessage
): boolean {
  return (
    typeof message.spacePassword === "string" &&
    normalizeSpacePasswordText(message.spacePassword).length > 0
  );
}
