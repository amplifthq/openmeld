import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import {
  getSpaceAccessPassword,
  getSpaceAccessRequestContext,
  getSpaceAccessRequestId,
  resolveSpaceAccess,
  type SpaceAccessContext,
} from "@openmeld/space";
import { createCoreRpcHttpError } from "../../rpc/errors";
import type { SpaceMemberRecord } from "../infrastructure/sql/space-member-repo";
import type { SpaceMetaRecord } from "../infrastructure/sql/space-meta-repo";
import { normalizeOwnerUserId } from "../rules/access/space-creator-identity";
import type { PasswordAuthorizationResult } from "./types";

export type SpaceAccessViewerIdentity = {
  viewerOwnerUserId: string | null;
  viewerProfileId: string | null;
};

export function assertSpaceAccessMatchesSpace(input: {
  spaceAccess?: SpaceAccessContext;
  spaceId: string;
}): void {
  if (
    input.spaceAccess &&
    input.spaceAccess.spaceId.trim() !== input.spaceId.trim()
  ) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "space.access.space_mismatch",
      reason: "space access context does not match target space",
    });
  }
}

export async function authorizeSpaceAccessProof(input: {
  authorizeSpacePasswordAccess: (input: {
    context?: OpenMeldRequestContext;
    requestId: string;
    spacePassword?: string;
  }) => Promise<PasswordAuthorizationResult>;
  spaceAccess: SpaceAccessContext;
}): Promise<PasswordAuthorizationResult> {
  return await input.authorizeSpacePasswordAccess({
    context: getSpaceAccessRequestContext(input.spaceAccess) ?? undefined,
    requestId: getSpaceAccessRequestId(input.spaceAccess),
    spacePassword: getSpaceAccessPassword(input.spaceAccess),
  });
}

export type ProtectedSpaceAccessGrantReason =
  | "unprotected_space"
  | "valid_password"
  | "active_member_profile"
  | "same_owner_active_member";

export type ProtectedSpaceAccessAuthorizationResult =
  | { ok: true; reason: ProtectedSpaceAccessGrantReason }
  | {
      ok: false;
      code:
        | "space.membership_required"
        | "space.password_required"
        | "space.password_invalid";
    };

export async function authorizeProtectedSpaceAccess(input: {
  context?: OpenMeldRequestContext;
  hasActiveMemberForOwnerUserId: (ownerUserId: string) => boolean;
  meta: SpaceMetaRecord;
  readMemberByProfileId: (profileId: string) => SpaceMemberRecord | null;
  spacePassword?: string;
  verifySpacePasswordProof: (
    password: string,
    proof: NonNullable<SpaceMetaRecord["passwordProof"]>
  ) => Promise<boolean>;
}): Promise<ProtectedSpaceAccessAuthorizationResult> {
  if (input.meta.accessMode === "members_only") {
    return authorizeMembersOnlySpaceAccess(input);
  }
  if (
    resolveSpaceAccess({
      visibility: input.meta.visibility,
      accessMode: input.meta.accessMode,
      organizationMember: false,
      activeMember: false,
      password: "missing",
    }).canRead
  ) {
    return { ok: true, reason: "unprotected_space" };
  }
  if (!input.meta.passwordProof) {
    return { ok: false, code: "space.password_required" };
  }

  return await authorizeSpacePasswordGate(input);
}

export async function authorizeSpaceJoinAccess(input: {
  context?: OpenMeldRequestContext;
  hasActiveMemberForOwnerUserId: (ownerUserId: string) => boolean;
  meta: SpaceMetaRecord;
  readMemberByProfileId: (profileId: string) => SpaceMemberRecord | null;
  spacePassword?: string;
  verifySpacePasswordProof: (
    password: string,
    proof: NonNullable<SpaceMetaRecord["passwordProof"]>
  ) => Promise<boolean>;
}): Promise<ProtectedSpaceAccessAuthorizationResult> {
  if (input.meta.accessMode === "members_only") {
    return authorizeMembersOnlySpaceAccess(input);
  }
  if (
    resolveSpaceAccess({
      visibility: input.meta.visibility,
      accessMode: input.meta.accessMode,
      organizationMember: false,
      activeMember: false,
      password: "missing",
    }).canJoin
  ) {
    return { ok: true, reason: "unprotected_space" };
  }
  if (!input.meta.passwordProof) {
    return { ok: false, code: "space.password_required" };
  }

  return await authorizeSpacePasswordGate(input);
}

function authorizeMembersOnlySpaceAccess(input: {
  context?: OpenMeldRequestContext;
  hasActiveMemberForOwnerUserId: (ownerUserId: string) => boolean;
  meta: SpaceMetaRecord;
  readMemberByProfileId: (profileId: string) => SpaceMemberRecord | null;
}): ProtectedSpaceAccessAuthorizationResult {
  const authenticatedGrant = resolveAuthenticatedProtectedSpaceAccessGrant({
    context: input.context,
    hasActiveMemberForOwnerUserId: input.hasActiveMemberForOwnerUserId,
    meta: input.meta,
    readMemberByProfileId: input.readMemberByProfileId,
  });
  return authenticatedGrant
    ? { ok: true, reason: authenticatedGrant }
    : { ok: false, code: "space.membership_required" };
}

async function authorizeSpacePasswordGate(input: {
  context?: OpenMeldRequestContext;
  hasActiveMemberForOwnerUserId: (ownerUserId: string) => boolean;
  meta: SpaceMetaRecord;
  readMemberByProfileId: (profileId: string) => SpaceMemberRecord | null;
  spacePassword?: string;
  verifySpacePasswordProof: (
    password: string,
    proof: NonNullable<SpaceMetaRecord["passwordProof"]>
  ) => Promise<boolean>;
}): Promise<ProtectedSpaceAccessAuthorizationResult> {
  const passwordProof = input.meta.passwordProof;
  if (!passwordProof) {
    return { ok: false, code: "space.password_required" };
  }

  const authenticatedGrant = resolveAuthenticatedProtectedSpaceAccessGrant({
    context: input.context,
    hasActiveMemberForOwnerUserId: input.hasActiveMemberForOwnerUserId,
    meta: input.meta,
    readMemberByProfileId: input.readMemberByProfileId,
  });
  if (authenticatedGrant) {
    return { ok: true, reason: authenticatedGrant };
  }

  if (input.spacePassword === undefined) {
    return { ok: false, code: "space.password_required" };
  }

  const valid = await input.verifySpacePasswordProof(
    input.spacePassword,
    passwordProof
  );
  if (!valid) {
    return { ok: false, code: "space.password_invalid" };
  }

  return { ok: true, reason: "valid_password" };
}

function resolveAuthenticatedProtectedSpaceAccessGrant(input: {
  context?: OpenMeldRequestContext;
  hasActiveMemberForOwnerUserId: (ownerUserId: string) => boolean;
  meta: SpaceMetaRecord;
  readMemberByProfileId: (profileId: string) => SpaceMemberRecord | null;
}): Exclude<
  ProtectedSpaceAccessGrantReason,
  "unprotected_space" | "valid_password"
> | null {
  const actorContext = input.context?.actorContext;
  if (!actorContext) {
    return null;
  }

  const viewerProfileId = normalizeProfileId(actorContext.openMeldProfileId);
  const viewerOwnerUserId = normalizeOwnerUserId(actorContext.ownerUserId);

  if (viewerProfileId) {
    const member = input.readMemberByProfileId(viewerProfileId);
    if (member?.status === "active") {
      return "active_member_profile";
    }
  }

  if (
    viewerOwnerUserId &&
    input.hasActiveMemberForOwnerUserId(viewerOwnerUserId)
  ) {
    return "same_owner_active_member";
  }

  return null;
}

function normalizeProfileId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function requireAuthenticatedSpaceActor(
  spaceAccess: SpaceAccessContext
): OpenMeldRequestContext {
  const requestContext = getSpaceAccessRequestContext(spaceAccess);
  if (!requestContext) {
    throw createCoreRpcHttpError({
      status: 401,
      code: "auth.unauthenticated",
      reason: "authentication required",
    });
  }
  return requestContext;
}

export function requireWritableSpaceActor(
  spaceAccess: SpaceAccessContext
): OpenMeldRequestContext {
  if (spaceAccess.actor.kind === "anonymous_viewer") {
    throw createCoreRpcHttpError({
      status: 403,
      code: "space.access.read_only",
      reason: "anonymous viewers can only read this space",
    });
  }
  return requireAuthenticatedSpaceActor(spaceAccess);
}

export function resolveViewerIdentity(
  spaceAccess: SpaceAccessContext
): SpaceAccessViewerIdentity {
  const requestContext = getSpaceAccessRequestContext(spaceAccess);
  if (!requestContext) {
    return {
      viewerOwnerUserId: null,
      viewerProfileId: null,
    };
  }
  return {
    viewerOwnerUserId: requestContext.actorContext.ownerUserId ?? null,
    viewerProfileId: requestContext.actorContext.openMeldProfileId,
  };
}
