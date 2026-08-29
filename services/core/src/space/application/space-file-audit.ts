import { spaceFileAuditEventSchema } from "@openmeld/schemas";
import type {
  SpaceFileAuditEvent,
  SpaceFileAuditOperation,
} from "@openmeld/schemas/types";
import {
  getSpaceAccessRequestContext,
  getSpaceAccessRequestId,
  type SpaceAccessContext,
} from "@openmeld/space";

export function buildSpaceFileAuditEvent(input: {
  entryId: string;
  errorCode: string | null;
  occurredAtMs: number;
  operation: SpaceFileAuditOperation;
  operationId: string;
  organizationId: string;
  representedHumanProfileId?: string | null;
  result: "succeeded" | "failed";
  revisionId: string | null;
  spaceAccess: SpaceAccessContext;
  spaceId: string;
}): SpaceFileAuditEvent {
  const requestId = getSpaceAccessRequestId(input.spaceAccess);
  return spaceFileAuditEventSchema.parse({
    actorKind: input.spaceAccess.actor.kind,
    actorProfileId: resolveSpaceFileAuditActorProfileId(input.spaceAccess),
    entryId: input.entryId,
    errorCode: input.errorCode,
    eventId: buildSpaceFileAuditEventId({
      operation: input.operation,
      operationId: input.operationId,
      requestId,
    }),
    occurredAtMs: input.occurredAtMs,
    operation: input.operation,
    operationId: input.operationId,
    organizationId: input.organizationId,
    representedHumanProfileId: input.representedHumanProfileId ?? null,
    requestId,
    result: input.result,
    revisionId: input.revisionId,
    spaceId: input.spaceId,
  });
}

function buildSpaceFileAuditEventId(input: {
  operation: SpaceFileAuditOperation;
  operationId: string;
  requestId: string;
}): string {
  return [
    "v2",
    encodeAuditIdentityPart(input.operation),
    encodeAuditIdentityPart(input.requestId),
    encodeAuditIdentityPart(input.operationId),
  ].join(":");
}

function encodeAuditIdentityPart(value: string): string {
  return `${value.length}:${value}`;
}

function resolveSpaceFileAuditActorProfileId(
  spaceAccess: SpaceAccessContext
): string | null {
  if (spaceAccess.actor.kind === "anonymous_viewer") {
    return null;
  }
  if (spaceAccess.actor.kind === "dispatch_continuation") {
    return spaceAccess.actor.targetProfileId;
  }
  return (
    getSpaceAccessRequestContext(spaceAccess)?.actorContext.openMeldProfileId ??
    null
  );
}
