import { normalizeSpacePasswordText } from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";

export type SpaceAccessProof =
  | { kind: "none" }
  | { kind: "space_password"; password: string };

export type SpaceAccessActor =
  | { kind: "authenticated"; requestContext: OpenMeldRequestContext }
  | { kind: "anonymous_viewer"; requestId: string }
  | {
      kind: "dispatch_continuation";
      requestContext: OpenMeldRequestContext;
      dispatchId: string;
      sourceSignalId: string;
      targetProfileId: string;
      attemptId?: string;
    };

export type SpaceAccessContext = {
  spaceId: string;
  actor: SpaceAccessActor;
  proof: SpaceAccessProof;
};

export type SpaceAccessAuditFields = {
  actorKind: SpaceAccessActor["kind"];
  hasSpacePasswordProof: boolean;
  proofKind: SpaceAccessProof["kind"];
  spaceId: string;
};

export function createAuthenticatedSpaceAccessContext(input: {
  password?: string | null;
  requestContext: OpenMeldRequestContext;
  spaceId: string;
}): SpaceAccessContext {
  return {
    spaceId: input.spaceId,
    actor: {
      kind: "authenticated",
      requestContext: input.requestContext,
    },
    proof: createSpaceAccessProof(input.password),
  };
}

export function createAnonymousViewerSpaceAccessContext(input: {
  password?: string | null;
  requestId: string;
  spaceId: string;
}): SpaceAccessContext {
  return {
    spaceId: input.spaceId,
    actor: {
      kind: "anonymous_viewer",
      requestId: input.requestId,
    },
    proof: createSpaceAccessProof(input.password),
  };
}

export function createDispatchContinuationSpaceAccessContext(input: {
  attemptId?: string | null;
  dispatchId: string;
  password?: string | null;
  requestContext: OpenMeldRequestContext;
  sourceSignalId: string;
  spaceId: string;
  targetProfileId: string;
}): SpaceAccessContext {
  return {
    spaceId: input.spaceId,
    actor: {
      kind: "dispatch_continuation",
      requestContext: input.requestContext,
      dispatchId: input.dispatchId,
      sourceSignalId: input.sourceSignalId,
      targetProfileId: input.targetProfileId,
      ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    },
    proof: createSpaceAccessProof(input.password),
  };
}

export function getSpaceAccessRequestContext(
  spaceAccess: SpaceAccessContext
): OpenMeldRequestContext | null {
  switch (spaceAccess.actor.kind) {
    case "authenticated":
    case "dispatch_continuation":
      return spaceAccess.actor.requestContext;
    case "anonymous_viewer":
      return null;
    default:
      return assertNever(spaceAccess.actor);
  }
}

export function getSpaceAccessRequestId(
  spaceAccess: SpaceAccessContext
): string {
  switch (spaceAccess.actor.kind) {
    case "authenticated":
    case "dispatch_continuation":
      return spaceAccess.actor.requestContext.actorContext.requestId;
    case "anonymous_viewer":
      return spaceAccess.actor.requestId;
    default:
      return assertNever(spaceAccess.actor);
  }
}

export function getSpaceAccessPassword(
  spaceAccess: SpaceAccessContext
): string | undefined {
  switch (spaceAccess.proof.kind) {
    case "none":
      return undefined;
    case "space_password":
      return spaceAccess.proof.password;
    default:
      return assertNever(spaceAccess.proof);
  }
}

export function toSpaceAccessAuditFields(
  spaceAccess: SpaceAccessContext
): SpaceAccessAuditFields {
  return {
    actorKind: spaceAccess.actor.kind,
    hasSpacePasswordProof: spaceAccess.proof.kind === "space_password",
    proofKind: spaceAccess.proof.kind,
    spaceId: spaceAccess.spaceId,
  };
}

function createSpaceAccessProof(password: string | null | undefined) {
  if (password === undefined || password === null) {
    return { kind: "none" } as const;
  }
  const normalizedPassword = normalizeSpacePasswordText(password);
  if (normalizedPassword.length === 0) {
    return { kind: "none" } as const;
  }
  return { kind: "space_password", password: normalizedPassword } as const;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Space access variant: ${String(value)}`);
}
